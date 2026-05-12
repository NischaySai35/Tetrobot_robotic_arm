import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import https from 'node:https'
import multicastDns from 'multicast-dns'

const IPV4_RE = /^\d+\.\d+\.\d+\.\d+$/
const mdns = multicastDns()

// DNS cache for .local names (expires after 60 seconds)
const dnsCache = new Map()
const inFlightResolves = new Map()
const DNS_CACHE_TTL = 60 * 1000

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
}

function cacheResolvedHost(hostname, ip) {
  if (!IPV4_RE.test(ip)) return
  dnsCache.set(normalizeHostname(hostname), { ip, timestamp: Date.now() })
}

function getCachedIp(hostname) {
  const cached = dnsCache.get(normalizeHostname(hostname))
  if (!cached) return null
  const age = Date.now() - cached.timestamp
  return { ...cached, age }
}

console.log('[DNS] mDNS resolver ready (multicast-dns)')

// Resolve .local names using in-process mDNS with caching
async function resolveHostname(hostname) {
  const normalizedHost = normalizeHostname(hostname)
  if (!normalizedHost.endsWith('.local')) return hostname

  // Check cache first
  const cached = getCachedIp(normalizedHost)
  if (cached) {
    if (cached.age < DNS_CACHE_TTL) {
      console.log(`[DNS] Cache hit for ${normalizedHost}: ${cached.ip} (${cached.age}ms old)`)
      return cached.ip
    }
  }

  // Deduplicate concurrent resolves for the same hostname
  if (inFlightResolves.has(normalizedHost)) {
    return await inFlightResolves.get(normalizedHost)
  }

  const resolver = (async () => {
    console.log(`[DNS] mDNS query ${normalizedHost}...`)
    try {
      const ip = await new Promise((resolve) => {
        let done = false
        let timeoutId = null

        const finish = (value) => {
          if (done) return
          done = true
          mdns.removeListener('response', onResponse)
          if (timeoutId) clearTimeout(timeoutId)
          resolve(value)
        }

        const onResponse = (response) => {
          try {
            const records = [...(response.answers || []), ...(response.additionals || [])]
            const answer = records.find((rec) => {
              const name = normalizeHostname(rec?.name)
              return name === normalizedHost && rec?.type === 'A' && IPV4_RE.test(String(rec?.data || ''))
            })
            if (answer) {
              finish(String(answer.data))
            }
          } catch {
            // ignore parse issues and wait for timeout
          }
        }

        mdns.on('response', onResponse)
        mdns.query({ questions: [{ name: normalizedHost, type: 'A' }] })
        timeoutId = setTimeout(() => finish(null), 3000)
      })

      if (ip && IPV4_RE.test(ip)) {
        cacheResolvedHost(normalizedHost, ip)
        console.log(`[DNS] mDNS resolved ${normalizedHost} -> ${ip}`)
        return ip
      }
    } catch (err) {
      console.log(`[DNS] mDNS error for ${normalizedHost}: ${err && err.message}`)
    }

    // If resolution failed but we have a stale cache entry, fall back to it
    if (cached && cached.ip) {
      console.log(`[DNS] Falling back to cached IP for ${normalizedHost}: ${cached.ip}`)
      dnsCache.set(normalizedHost, { ip: cached.ip, timestamp: Date.now() })
      return cached.ip
    }

    // final fallback: return original hostname
    return hostname
  })()

  inFlightResolves.set(normalizedHost, resolver)
  try {
    const res = await resolver
    return res
  } finally {
    inFlightResolves.delete(normalizedHost)
  }
}

function espProxyPlugin() {
  return {
    name: 'esp-proxy',
    configureServer(server) {
      server.middlewares.use('/esp-proxy', async (req, res) => {
        const requestUrl = new URL(req.url || '', 'http://localhost')
        const host = requestUrl.searchParams.get('host') || ''
        const path = requestUrl.searchParams.get('path') || '/'

        if (!host) {
          console.log(`[ESP Proxy] Missing host`)
          res.statusCode = 400
          res.end('Missing host')
          return
        }

        // Allow caller to pass an explicit IP to use (fallback from frontend)
        const hostIp = requestUrl.searchParams.get('hostIp') || ''
        // Try to resolve .local names (or use hostIp if provided)
        let resolvedHost = hostIp || await resolveHostname(host)
        if (!resolvedHost) resolvedHost = host
        const targetUrl = new URL(`http://${resolvedHost}${path}`)
        console.log(`[ESP Proxy] Request: ${req.url}`)
        if (hostIp) console.log(`[ESP Proxy] Using provided hostIp for ${host}: ${hostIp}`)
        console.log(`[ESP Proxy] Forwarding to: ${targetUrl.toString()}`)
        
        const client = targetUrl.protocol === 'https:' ? https : http
        const headers = Object.fromEntries(
          Object.entries({
            ...req.headers,
            host: host,
            origin: req.headers.origin,
            referer: req.headers.referer,
          }).filter(([, value]) => value !== undefined)
        )

        const proxyRequest = client.request(
          targetUrl,
          {
            method: req.method,
            headers,
            timeout: 3000,
          },
          (proxyResponse) => {
            console.log(`[ESP Proxy] Response: ${proxyResponse.statusCode}`)
            res.statusCode = proxyResponse.statusCode || 500
            for (const [key, value] of Object.entries(proxyResponse.headers)) {
              if (value !== undefined) res.setHeader(key, value)
            }
            // Expose the resolved IP to the frontend so it can cache and reuse it
            try {
              if (resolvedHost && resolvedHost.match(IPV4_RE)) {
                res.setHeader('X-Resolved-IP', resolvedHost)
              }
            } catch (e) {
              // ignore header errors
            }
            res.setHeader('Access-Control-Allow-Origin', '*')
            proxyResponse.pipe(res)
          }
        )

        proxyRequest.on('timeout', () => {
          console.log(`[ESP Proxy] Timeout: ${targetUrl.toString()}`)
          proxyRequest.destroy()
          res.statusCode = 504
          res.end('Gateway timeout')
        })

        proxyRequest.on('error', (error) => {
          console.log(`[ESP Proxy] Error: ${error.message}`)
          res.statusCode = 502
          res.end(`Proxy error: ${error.message}`)
        })

        req.pipe(proxyRequest)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    espProxyPlugin(),
  ],
})