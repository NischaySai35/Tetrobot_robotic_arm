import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDot,
  Copy,
  Download,
  Home,
  Layers3,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  SlidersHorizontal,
  Search,
  Trash2,
  Wand2,
  XCircle,
  Activity,
  Wifi,
  WifiOff,
} from "lucide-react";

const SERVO_MAX = 6;
const DEFAULT_SCRIPT = `1s30
2s40,3s70
1s60
5s45,6s45
4s120`;

const POLL_MS = 1500;
const DEFAULT_LINE_DELAY = 1000;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function nowTime() {
  return new Date().toLocaleTimeString();
}

function parseCommand(token) {
  const t = token.trim().toLowerCase();
  if (!t) return null;

  if (t === "home") {
    return { type: "home" };
  }

  if (/^(wait|pause|delay)\s*\d+$/.test(t)) {
    const ms = Number(t.replace(/[^0-9]/g, ""));
    return { type: "wait", ms: clamp(ms, 0, 999999) };
  }

  const m = t.match(/^(\d)\s*s\s*(\d{1,3})$/i);
  if (!m) return null;

  const servo = Number(m[1]) - 1;
  const angle = clamp(Number(m[2]), 0, 180);
  if (servo < 0 || servo >= SERVO_MAX) return null;
  return { type: "servo", servo, angle };
}

function parseScript(script) {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));

  return lines.map((line, index) => {
    const tokens = line.split(",").map((s) => s.trim()).filter(Boolean);
    const commands = [];
    const errors = [];

    for (const token of tokens) {
      const parsed = parseCommand(token);
      if (parsed) commands.push(parsed);
      else errors.push(token);
    }

    return {
      index,
      raw: line,
      commands,
      errors,
      isValid: errors.length === 0,
    };
  });
}

function reverseScriptText(script) {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));

  // Reverse only the line order. Keep each line exactly as-is.
  return lines.reverse().join("\n");
}

function MiniProgress({ value }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400 transition-all"
        style={{ width: `${clamp(value, 0, 100)}%` }}
      />
    </div>
  );
}

function ParsePill({ ok, text }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-rose-500/30 bg-rose-500/10 text-rose-200"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      <span>{text}</span>
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, active, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-rose-500/20 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
          : active
          ? "border-cyan-400/30 bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/18"
          : "border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90"
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-cyan-300" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

function makeBot(index) {
  return {
    id: `Bot ${index + 1}`,
    ip: "",
    script: DEFAULT_SCRIPT,
    lineDelay: DEFAULT_LINE_DELAY,
    selected: index === 0,
    sending: false,
    online: false,
    receiving: false,
    scriptRunning: false,
    waiting: false,
    waitMs: 0,
    lineIndex: 0,
    lineCount: 0,
    progress: 0,
    lastAction: "idle",
    status: "ready",
    lastSeen: "never",
    angles: [116, 92, 74, 90, 90, 90],
    targets: [116, 92, 74, 90, 90, 90],
  };
}

function BotPanel({
  title,
  bot,
  setIp,
  setScript,
  setLineDelay,
  onRun,
  onReverse,
  onHome,
  onStop,
  onClear,
  onNew,
  onCopy,
  onMirror,
  onValidate,
  parsed,
  running,
  progress,
  lastAction,
  selected,
  setSelected,
  commandCount,
  validCount,
  issueCount,
}) {
  const textareaRef = useRef(null);

  const insertSample = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? bot.script.length;
    const end = el.selectionEnd ?? bot.script.length;
    const snippet = "\n1s30\n2s40,3s70\n1s60\n";
    const next = bot.script.slice(0, start) + snippet + bot.script.slice(end);
    setScript(next);
    requestAnimationFrame(() => el.focus());
  };

  const lineCount = bot.script.trim().length ? bot.script.trim().split(/\r?\n/).length : 0;
  const statusText = bot.online
    ? bot.scriptRunning
      ? `running line ${bot.lineIndex}/${bot.lineCount || 0}`
      : bot.sending
      ? "sending script"
      : "online"
    : "offline";

  return (
    <div className={`rounded-[28px] border bg-slate-950/85 p-4 shadow-2xl shadow-black/25 backdrop-blur ${selected ? "border-cyan-400/30" : "border-slate-800"}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <Bot className="h-5 w-5 text-cyan-300" />
            {title}
          </div>
          <div className="mt-1 text-sm text-slate-400">Line-by-line script. Commands in the same row run together.</div>
        </div>
        <button
          onClick={() => setSelected(!selected)}
          className={`rounded-2xl border px-3 py-2 text-xs transition ${selected ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-slate-700 bg-slate-900 text-slate-200"}`}
        >
          {selected ? "Selected" : "Select"}
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-200">ESP32 IP</div>
            <div className="text-xs text-slate-500">leave blank for now</div>
          </div>
          <input
            value={bot.ip}
            onChange={(e) => setIp(e.target.value.trim())}
            placeholder="10.0.0.123"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
          />

          <div className="mt-4 grid grid-cols-[1fr_130px] gap-3 items-end">
            <div>
              <div className="text-xs text-slate-500">Line delay</div>
              <div className="mt-1 text-sm text-slate-300">Sent as <span className="font-mono">/script?delay=...</span></div>
            </div>
            <input
              type="number"
              min="0"
              step="10"
              value={bot.lineDelay}
              onChange={(e) => setLineDelay(Number(e.target.value))}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/50"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <ParsePill ok={!!bot.ip} text={bot.ip ? "IP set" : "IP empty"} />
            <ParsePill ok={issueCount === 0} text={issueCount === 0 ? "syntax OK" : `${issueCount} issue(s)`} />
            <ParsePill ok={lineCount > 0} text={`${lineCount} line(s)`} />
            <ParsePill ok={true} text={`${bot.lineDelay} ms delay`} />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-4">
          <div className="text-sm font-medium text-slate-200">Status</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="text-slate-500">Commands</div>
              <div className="font-semibold text-white">{commandCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-2">
              <div className="text-slate-500">Valid</div>
              <div className="font-semibold text-white">{validCount}</div>
            </div>
          </div>
          <div className="mt-3">
            <MiniProgress value={progress} />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {running ? `Running... ${Math.floor(progress)}%` : `Last action: ${lastAction || "idle"}`}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <ToolbarButton icon={Play} label="Run" onClick={onRun} active />
        <ToolbarButton icon={RotateCcw} label="Reverse" onClick={onReverse} />
        <ToolbarButton icon={Home} label="Home" onClick={onHome} />
        <ToolbarButton icon={Square} label="Stop" onClick={onStop} danger />
        <ToolbarButton icon={Trash2} label="Clear" onClick={onClear} />
        <ToolbarButton icon={Sparkles} label="New Notepad" onClick={onNew} active />
        <ToolbarButton icon={Copy} label="Copy" onClick={onCopy} />
        <ToolbarButton icon={ArrowRight} label="Mirror" onClick={onMirror} />
        <ToolbarButton icon={Search} label="Validate" onClick={onValidate} />
        <ToolbarButton icon={Download} label="Insert Samples" onClick={insertSample} />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            {bot.online ? <Wifi className="h-3.5 w-3.5 text-emerald-300" /> : <WifiOff className="h-3.5 w-3.5 text-slate-500" />}
            {bot.id} · {statusText}
          </span>
          <span className="font-mono text-slate-500">poll: {POLL_MS}ms</span>
        </div>
        <div className="mt-2 font-mono text-[11px] leading-5 text-slate-200">
          {bot.angles.map((a, i) => `${i + 1}:${a}`).join("  ")}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {bot.scriptRunning
            ? `line ${bot.lineIndex}/${bot.lineCount || 0} · wait ${bot.waitMs}ms`
            : bot.sending
            ? "uploading script..."
            : `last seen: ${bot.lastSeen}`}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[28px] border border-slate-800 bg-[#0a0d14]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs text-slate-400">
          <span>Script Workspace</span>
          <span className="font-mono">1s30 · 2s40,3s70 · 1s60</span>
        </div>
        <textarea
          ref={textareaRef}
          value={bot.script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          placeholder={`1s30\n2s40,3s70\n1s60`}
          className="min-h-[360px] w-full resize-none bg-[#0a0d14] px-4 py-4 font-mono text-[15px] leading-7 text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-800 bg-slate-950/80 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-white">Parsed Preview</div>
          <div className="text-xs text-slate-500">line-by-line execution</div>
        </div>
        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {parsed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-500">No commands yet.</div>
          ) : (
            parsed.map((line) => (
              <div key={line.index} className={`rounded-2xl border p-3 ${line.isValid ? "border-slate-800 bg-slate-900/50" : "border-rose-500/20 bg-rose-500/8"}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
                  <span>Row {line.index + 1}</span>
                  <span className="font-mono">{line.raw}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {line.commands.map((cmd, i) => (
                    <span key={i} className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-100">
                      <CircleDot className="h-3.5 w-3.5" />
                      {cmd.type === "servo" ? `${cmd.servo + 1}s${cmd.angle}` : cmd.type === "home" ? "home" : `wait ${cmd.ms}ms`}
                    </span>
                  ))}
                  {line.errors.map((bad, i) => (
                    <span key={i} className="inline-flex items-center gap-2 rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-xs text-rose-100">
                      <XCircle className="h-3.5 w-3.5" />
                      {bad}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [bots, setBots] = useState([makeBot(0), makeBot(1)]);
  const [globalLineDelay, setGlobalLineDelay] = useState(DEFAULT_LINE_DELAY);
  const [globalLog, setGlobalLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [liveHelp, setLiveHelp] = useState(true);
  const [mirrorMode, setMirrorMode] = useState("bot1-to-bot2");
  const [sentRequests, setSentRequests] = useState(0);

  const botsRef = useRef(bots);
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  const parsed = useMemo(() => bots.map((b) => parseScript(b.script)), [bots]);
  const pushLog = (msg) => {
    setGlobalLog((prev) => [{ time: nowTime(), msg }, ...prev].slice(0, 18));
  };

  const patchBot = (idx, patch) => {
    setBots((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const setSelected = (idx) => {
    setBots((prev) => prev.map((b, i) => ({ ...b, selected: i === idx })));
  };

  const currentAnglesSummary = (bot) => (bot.angles || []).map((a, i) => `${i + 1}:${a}`).join("  ");

  const effectiveDelay = (bot) => {
    const local = Number(bot?.lineDelay);
    if (Number.isFinite(local) && local >= 0) return local;
    return globalLineDelay;
  };

  async function sendStatusRequest(idx, path, label) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      pushLog(`${bot?.id || `Bot ${idx + 1}`}: IP missing`);
      return;
    }

    patchBot(idx, { sending: true, lastAction: label, status: "sending" });
    setSentRequests((n) => n + 1);

    try {
      await fetch(`http://${bot.ip}${path}`);
      pushLog(`${bot.ip}: ${label}`);
    } catch {
      pushLog(`${bot.ip}: request failed (${label})`);
      patchBot(idx, { status: "error" });
    } finally {
      patchBot(idx, { sending: false });
    }
  }

  async function sendScriptToBot(idx, reverse = false) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      pushLog(`${bot?.id || `Bot ${idx + 1}`}: IP missing`);
      return;
    }

    const body = reverse ? reverseScriptText(bot.script) : bot.script;
    if (!body.trim()) {
      pushLog(`${bot.ip}: empty script`);
      return;
    }

    const delay = effectiveDelay(bot);
    const url = `http://${bot.ip}/script?delay=${encodeURIComponent(delay)}`;

    patchBot(idx, { sending: true, lastAction: reverse ? "reverse upload" : "script upload", status: "sending" });
    setSentRequests((n) => n + 1);
    pushLog(`${bot.ip}: ${reverse ? "reverse" : "run"} script upload (${delay}ms)`);

    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      });
      patchBot(idx, { lastAction: reverse ? "reverse uploaded" : "script uploaded", status: "queued" });
    } catch {
      patchBot(idx, { status: "error" });
      pushLog(`${bot.ip}: script upload failed`);
    } finally {
      patchBot(idx, { sending: false });
    }

    console.log("SENDING TO:", url, "BODY:", body);
  }

  async function runScript(idx, reverse = false) {
    await sendScriptToBot(idx, reverse);
  }

  async function runBothSameTime(reverse = false) {
    setBusy(true);
    pushLog(`Both bots: ${reverse ? "reverse run" : "run"}`);
    await Promise.all([sendScriptToBot(0, reverse), sendScriptToBot(1, reverse)]);
    setBusy(false);
  }

  async function homeAll() {
    setBusy(true);
    pushLog("Home all");
    await Promise.all([sendStatusRequest(0, "/home", "home"), sendStatusRequest(1, "/home", "home")]);
    setBusy(false);
  }

  async function stopAll() {
    setBusy(true);
    pushLog("Stop all");
    await Promise.all([sendStatusRequest(0, "/stop", "stop"), sendStatusRequest(1, "/stop", "stop")]);
    setBusy(false);
  }

  function clearBot(idx) {
    patchBot(idx, { script: "", lastAction: "cleared", status: "ready" });
  }

  function newNotepad(idx) {
    patchBot(idx, { script: DEFAULT_SCRIPT, lastAction: "new notepad", status: "ready" });
    pushLog(`Bot ${idx + 1}: new notepad`);
  }

  function copyBot(from, to) {
    patchBot(to, { script: bots[from].script, lastAction: `copied from bot ${from + 1}` });
    pushLog(`Copied bot ${from + 1} → bot ${to + 1}`);
  }

  function mirrorScripts() {
    if (mirrorMode === "bot1-to-bot2") copyBot(0, 1);
    else copyBot(1, 0);
  }

  function exportScripts() {
    const payload = JSON.stringify({ bots, globalLineDelay }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "robot_scripts.json";
    a.click();
    URL.revokeObjectURL(url);
    pushLog("Exported scripts");
  }

  function validateAll() {
    pushLog("Validation complete");
    setLiveHelp(true);
  }

  async function pollBot(idx) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) return;

    try {
      const [statusRes, scriptRes] = await Promise.all([
        fetch(`http://${bot.ip}/statusjson`, { cache: "no-store" }),
        fetch(`http://${bot.ip}/scriptstatus`, { cache: "no-store" }),
      ]);

      const s = await statusRes.json();
      const st = await scriptRes.json();

      const angles = [s.a1, s.a2, s.a3, s.a4, s.al, s.ar].map((n) => Number(n) || 0);
      const targets = [s.t1, s.t2, s.t3, s.t4, s.tl, s.tr].map((n) => Number(n) || 0);
      const lineCount = Number(st.lineCount) || 0;
      const lineIndex = Number(st.lineIndex) || 0;
      const running = !!st.running;
      const waiting = !!st.waiting;
      const waitMs = Number(st.waitMs) || 0;
      const progress = lineCount > 0 ? Math.min(100, Math.round((lineIndex / lineCount) * 100)) : running ? 50 : 100;

      patchBot(idx, {
        online: true,
        receiving: true,
        scriptRunning: running,
        waiting,
        waitMs,
        lineIndex,
        lineCount,
        angles,
        targets,
        progress,
        lastSeen: nowTime(),
        sending: false,
        status: running ? "running" : "ready",
      });
    } catch {
      patchBot(idx, {
        online: false,
        receiving: false,
      });
    }
  }

  useEffect(() => {
    pollBot(0);
    pollBot(1);
    const id = setInterval(() => {
      pollBot(0);
      pollBot(1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const receivingCount = bots.filter((b) => b.receiving).length;
  const sendingCount = bots.filter((b) => b.sending).length;
  const workingCount = bots.filter((b) => b.scriptRunning).length;
  const allIPsSet = bots.every((b) => b.ip && b.ip.length > 0);

  const globalStatusText = useMemo(() => (allIPsSet ? "IPs ready" : "IP slots still empty"), [allIPsSet]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#152033_0%,#0a0d14_42%,#05070b_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-4 py-4 lg:px-5">
        <div className="mb-4 rounded-[28px] border border-slate-800/80 bg-slate-950/85 p-4 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/20">
                  <Layers3 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-3xl font-bold tracking-tight text-white">Dual Bot Script Studio</div>
                  <div className="mt-1 text-sm text-slate-400">Notepad-style scripting, simultaneous commas, reverse execution, and dock-ready control.</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">{globalStatusText}</div>
              <div className="rounded-full border border-slate-800 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-300">ESP line delay default {DEFAULT_LINE_DELAY}ms</div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
                <div className="text-[11px] text-slate-500">Global line delay</div>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={globalLineDelay}
                  onChange={(e) => setGlobalLineDelay(Number(e.target.value))}
                  className="mt-1 w-32 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
                />
              </div>
              <ToolbarButton icon={Play} label="Run Both" onClick={() => runBothSameTime(false)} disabled={busy} active />
              <ToolbarButton icon={RotateCcw} label="Reverse Both" onClick={() => runBothSameTime(true)} disabled={busy} />
              <ToolbarButton icon={Home} label="Home All" onClick={homeAll} disabled={busy} />
              <ToolbarButton icon={Square} label="Stop All" onClick={stopAll} disabled={busy} danger />
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <StatCard icon={Activity} label="Requests Sent" value={sentRequests} sub="script uploads + direct commands" />
            <StatCard icon={ArrowRight} label="Sending Now" value={sendingCount} sub="requests currently in flight" />
            <StatCard icon={Wifi} label="Receiving" value={receivingCount} sub="ESPs responding to polling" />
            <StatCard icon={Sparkles} label="Working" value={workingCount} sub="ESPs running script engine" />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-2">
            {bots.map((bot) => (
              <div key={bot.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{bot.id}</div>
                    <div className="text-xs text-slate-500">{bot.ip || "IP empty"}</div>
                  </div>
                  <div className={`rounded-full px-2.5 py-1 text-[11px] ${bot.online ? "bg-emerald-500/10 text-emerald-200" : "bg-slate-900 text-slate-400"}`}>
                    {bot.online ? "ONLINE" : "OFFLINE"}
                  </div>
                </div>
                <div className="mt-2 font-mono text-[11px] text-slate-200">{currentAnglesSummary(bot)}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {bot.scriptRunning ? `running line ${bot.lineIndex}/${bot.lineCount || 0} · wait ${bot.waitMs}ms` : bot.sending ? "uploading script..." : `last seen: ${bot.lastSeen}`}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400" style={{ width: `${clamp(bot.progress || 0, 0, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2">
          <BotPanel
            title="Workspace A"
            bot={bots[0]}
            setIp={(v) => patchBot(0, { ip: v })}
            setScript={(v) => patchBot(0, { script: v })}
            setLineDelay={(v) => patchBot(0, { lineDelay: Number.isFinite(v) ? v : DEFAULT_LINE_DELAY })}
            onRun={() => runScript(0, false)}
            onReverse={() => runScript(0, true)}
            onHome={() => sendStatusRequest(0, "/home", "home")}
            onStop={() => sendStatusRequest(0, "/stop", "stop")}
            onClear={() => clearBot(0)}
            onNew={() => newNotepad(0)}
            onCopy={() => copyBot(0, 1)}
            onMirror={() => mirrorScripts()}
            onValidate={validateAll}
            parsed={parsed[0]}
            running={bots[0].sending || bots[0].scriptRunning}
            progress={bots[0].progress}
            lastAction={bots[0].lastAction}
            selected={bots[0].selected}
            setSelected={() => setSelected(0)}
            commandCount={parsed[0].reduce((acc, line) => acc + line.commands.length, 0)}
            validCount={parsed[0].filter((l) => l.isValid).length}
            issueCount={parsed[0].reduce((acc, line) => acc + line.errors.length, 0)}
          />

          <BotPanel
            title="Workspace B"
            bot={bots[1]}
            setIp={(v) => patchBot(1, { ip: v })}
            setScript={(v) => patchBot(1, { script: v })}
            setLineDelay={(v) => patchBot(1, { lineDelay: Number.isFinite(v) ? v : DEFAULT_LINE_DELAY })}
            onRun={() => runScript(1, false)}
            onReverse={() => runScript(1, true)}
            onHome={() => sendStatusRequest(1, "/home", "home")}
            onStop={() => sendStatusRequest(1, "/stop", "stop")}
            onClear={() => clearBot(1)}
            onNew={() => newNotepad(1)}
            onCopy={() => copyBot(1, 0)}
            onMirror={() => mirrorScripts()}
            onValidate={validateAll}
            parsed={parsed[1]}
            running={bots[1].sending || bots[1].scriptRunning}
            progress={bots[1].progress}
            lastAction={bots[1].lastAction}
            selected={bots[1].selected}
            setSelected={() => setSelected(1)}
            commandCount={parsed[1].reduce((acc, line) => acc + line.commands.length, 0)}
            validCount={parsed[1].filter((l) => l.isValid).length}
            issueCount={parsed[1].reduce((acc, line) => acc + line.errors.length, 0)}
          />
        </div>

        <div className="mt-4 rounded-[28px] border border-slate-800 bg-slate-950/85 p-4 shadow-2xl shadow-black/25">
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-lg font-semibold text-white">
                <SlidersHorizontal className="h-5 w-5 text-cyan-300" />
                Global Tools
              </div>
              <div className="mt-1 text-sm text-slate-400">Delay, mirror, logs, reset, and project actions.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setLiveHelp((v) => !v)} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                {liveHelp ? "Hide Tips" : "Show Tips"}
              </button>
              <button onClick={exportScripts} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                <Download className="mr-2 inline-block h-4 w-4" />Export
              </button>
              <button onClick={() => patchBot(0, { script: DEFAULT_SCRIPT, lastAction: "reset" })} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                Reset A
              </button>
              <button onClick={() => patchBot(1, { script: DEFAULT_SCRIPT, lastAction: "reset" })} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                Reset B
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="rounded-[26px] border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Execution Rules</div>
                <div className="text-xs text-slate-500">rows · commas · reverse</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  "Each row runs one after another",
                  "Commas inside a row run together",
                  "Reverse = bottom to top only",
                  `Default delay = ${DEFAULT_LINE_DELAY}ms`,
                ].map((t) => (
                  <div key={t} className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                    {t}
                  </div>
                ))}
              </div>

              {liveHelp && (
                <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4 text-sm text-cyan-100">
                  <div className="mb-1 font-semibold">Quick examples</div>
                  <div className="font-mono leading-7">
                    1s80<br />
                    2s30,4s40<br />
                    wait2000<br />
                    home<br />
                    3s30
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-[26px] border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">Mirror Mode</div>
                <div className="text-xs text-slate-500">copy between workspaces</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setMirrorMode(mirrorMode === "bot1-to-bot2" ? "bot2-to-bot1" : "bot1-to-bot2")} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                  Mirror mode: {mirrorMode === "bot1-to-bot2" ? "A → B" : "B → A"}
                </button>
                <button onClick={mirrorScripts} className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-200">
                  <ArrowRight className="mr-2 inline-block h-4 w-4" />Mirror Now
                </button>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-300">
                Reverse uploads the full script body with the line order flipped. The ESP runs the timing and command parsing itself.
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-[26px] border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Global Log</div>
              <button onClick={() => setGlobalLog([])} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300">
                Clear Log
              </button>
            </div>
            <div className="max-h-[190px] space-y-2 overflow-y-auto pr-1">
              {globalLog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950 p-3 text-sm text-slate-500">No events yet.</div>
              ) : (
                globalLog.map((item, i) => (
                  <motion.div key={`${item.time}-${i}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-800 bg-slate-950 p-3 text-sm">
                    <div className="text-xs text-slate-500">{item.time}</div>
                    <div className="text-slate-200">{item.msg}</div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
