import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'node:http'
import https from 'node:https'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

// DNS cache for .local names (expires after 60 seconds)
const dnsCache = new Map()

// Resolve .local names using system DNS with caching
async function resolveHostname(hostname) {
  if (!hostname.endsWith('.local')) {
    return hostname
  }
  
  // Check cache first
  const cached = dnsCache.get(hostname)
  if (cached) {
    const age = Date.now() - cached.timestamp
    if (age < 60000) { // 60 second cache
      console.log(`[DNS] Cache hit for ${hostname}: ${cached.ip} (${age}ms old)`)
      return cached.ip
    } else {
      dnsCache.delete(hostname)
    }
  }
  
  try {
    console.log(`[DNS] Resolving ${hostname}...`)
    const { stdout } = await execAsync(`powershell -Command "([System.Net.Dns]::GetHostAddresses('${hostname}'))[0].IPAddressToString"`, { timeout: 3000 })
    const ip = stdout.trim()
    if (ip && ip.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      console.log(`[DNS] Resolved ${hostname} -> ${ip}`)
      dnsCache.set(hostname, { ip, timestamp: Date.now() })
      return ip
    }
  } catch (err) {
    console.log(`[DNS] Failed to resolve ${hostname}: ${err.message}`)
  }
  return hostname
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

        // Try to resolve .local names
        const resolvedHost = await resolveHostname(host)
        const targetUrl = new URL(`http://${resolvedHost}${path}`)
        console.log(`[ESP Proxy] Request: ${req.url}`)
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
            timeout: 800,
          },
          (proxyResponse) => {
            console.log(`[ESP Proxy] Response: ${proxyResponse.statusCode}`)
            res.statusCode = proxyResponse.statusCode || 500
            for (const [key, value] of Object.entries(proxyResponse.headers)) {
              if (value !== undefined) res.setHeader(key, value)
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