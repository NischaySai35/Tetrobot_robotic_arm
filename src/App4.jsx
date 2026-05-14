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

const SERVO_MAX = 7;
const DEFAULT_SCRIPT = `1s30
2s40,3s70
1s60
5s45,6s45
4s120`;
const POLL_MS = 1000;
// How long to consider a device "online" since last successful poll (ms)
const ONLINE_THRESHOLD_MS = 8000;
const DEFAULT_LINE_DELAY = 0;
const DEFAULT_HOSTS = ["microbot1.local", "microbot2.local"];
const DEFAULT_GRIPPER_HOST = "gripper.local";
const DEFAULT_LASER_HOST = "lazer.local";
const ESP_PROXY_PATH = "/esp-proxy";
const SYNC_START_BUFFER_MS = 1500;
const GRIPPER_MIN = 20;
const GRIPPER_MAX = 95;
const GRIPPER_HOME = 90;
const LASER_MODES = ["off", "on", "blink"];

const BOT1_LOCK_1_TO_2 = `homebody
wait1000
5s45,6s175,7s93,1s83,2s83,3s86
wait3500
1s3,2s54,3s23
wait3000
2s62,3s12
wait2000
5s90,4s45
wait3000
1s18,2s51
wait2000
1s83,2s83,3s86`;

const BOT1_LOCK_2_TO_1 = `homebody
wait1000
4s45,6s175,7s93,1s83,2s83,3s86
wait3500
1s18,2s51,3s12
wait3500
1s3,2s62
wait2000
5s45,4s90
wait3000
2s54,3s23
wait2000
1s83,2s83,3s86`;

const BOT2_LOCK_4_TO_3 = `homebody
wait1000
5s45,6s5,7s173,1s90,2s138,3s90
wait3000
1s10,2s171,3s150
wait3500
2s159,3s164
wait2800
5s90,4s45
wait2800
1s20,3s171
wait3000
1s90,2s138,3s90`;

const BOT2_LOCK_3_TO_4 = `homebody
wait1000
4s45,6s5,7s173,1s90,2s138,3s90
wait3000
1s20,2s159,3s171
wait3500
1s10,3s164
wait2800
5s45,4s90
wait2800
2s171,3s150
wait3000
1s90,2s138,3s90`;

const GRIPPER_DEMO_SCRIPT = `6s88,7s0,4s45
wait3000
1s55,2s23,3s8
wait3000
1s49
wait2000
5s135
wait2000
1s83
wait600
2s40,3s30
wait2000
//gripper functions along with bot
ghome
wait1000
6s145
wait2000
1s40
wait2000
g40
wait2000
1s83
wait2000
6s90
wait2000
1s40
wait1500
ghome
wait3000
1s83
wait2000
//end-gripper-moves
1s55,2s23,3s8
wait3000
1s49
wait2000
5s90
wait3000
1s56
wait600
2s40,3s30
wait2000
homebody`;

const LASER_DEMO_SCRIPT = `homebody
wait1000
5s135
wait3000
3s127
wait200
2s186,1s3
wait3000
1s3,2s176,3s140
wait2000
4s135
wait2000
3s127
wait200
2s186,1s3
lazon
wait2000
7s40
wait2000
2s170,3s114
wait2000
7s140
wait3000
2s186
wait1000
lazblink
6s0
wait2000
7s90
wait2000
6s90
wait2000
3s127
wait1600
1s3,2s176,3s140
wait2000
4s90
lazoff
wait2000
3s127
wait200
2s186,1s3
wait2000
homebody`;

const IMPORTANT_BOT1_SCRIPT = `homebody
wait1000
4s45,6s0
wait3000
1s80,2s76,3s11
wait3000
1s80,2s58,3s28
wait2000
5s45
wait1000
1s80
wait2000
1s90
wait2000
1s140
wait4000
6s90
wait3000
6s90
wait4000
6s180
wait3000
6s180
wait3000
6s2
wait7000
1s90
wait3000
1s80
wait2000
1s80
wait1500
5s90
wait3000
1s80,2s76,3s11
wait2500
homebody`;

const IMPORTANT_BOT2_SCRIPT = `homebody
wait1000
5s45,6s5,7s173
wait3000
1s14,2s148,3s90
wait3000
1s28,2s166,3s90
wait2000
4s135
wait1000
5s90
wait2000
1s34
wait2000
1s34
wait4000
1s34
wait3000
1s84
wait4000
1s84
wait3000
1s34
wait3000
1s34
wait7000
1s32
wait3000
1s28
wait2000
5s45
wait1500
4s90
wait3000
1s14,2s148,3s90
wait2500
homebody`;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const nowTime = () => new Date().toLocaleTimeString();
const OFFLINE_AFTER_FAILURES = 2;

function parseBotCommand(token) {
  const t = token.trim().toLowerCase();
  if (!t) return null;

  if (t === "home") return { type: "home" };
  if (t === "home-body" || t === "homebody") return { type: "home_body" };
  if (t === "home-lock" || t === "home-locks" || t === "homelock" || t === "homelocks") return { type: "home_locks" };

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

function parseGripperCommand(token) {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === "ghome" || t === "g-home" || t === "g_home") return { type: "gripper", angle: GRIPPER_HOME };
  const m = t.match(/^g\s*(\d{1,3})$/i);
  if (!m) return null;
  const angle = clamp(Number(m[1]), GRIPPER_MIN, GRIPPER_MAX);
  return { type: "gripper", angle };
}

function parseLaserCommand(token) {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === "lazon") return { type: "laser", mode: "on" };
  if (t === "lazoff") return { type: "laser", mode: "off" };
  if (t === "lazblink") return { type: "laser", mode: "blink" };
  return null;
}

function parseScript(script) {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));

  return lines.map((line, index) => {
    const tokens = line.split(",").map((s) => s.trim()).filter(Boolean);
    const commands = [];
    const gripperCommands = [];
    const laserCommands = [];
    const errors = [];

    for (const token of tokens) {
      const parsedBot = parseBotCommand(token);
      if (parsedBot) {
        commands.push(parsedBot);
        continue;
      }
      const parsedGripper = parseGripperCommand(token);
      if (parsedGripper) {
        gripperCommands.push(parsedGripper);
        continue;
      }
      const parsedLaser = parseLaserCommand(token);
      if (parsedLaser) {
        laserCommands.push(parsedLaser);
        continue;
      }
      errors.push(token);
    }

    return {
      index,
      raw: line,
      commands,
      gripperCommands,
      laserCommands,
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

  return lines.reverse().join("\n");
}

function commandToEspToken(cmd) {
  if (cmd.type === "servo") return `${cmd.servo + 1}s${cmd.angle}`;
  if (cmd.type === "home") return "home";
  if (cmd.type === "home_body") return "homebody";
  if (cmd.type === "home_locks") return "homelock";
  if (cmd.type === "wait") return `wait${cmd.ms}`;
  return "";
}

function toEspScript(script) {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"));

  return lines
    .map((line) =>
      line
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
          const parsed = parseBotCommand(token);
          if (parsed) return commandToEspToken(parsed);
          const parsedGripper = parseGripperCommand(token);
          if (parsedGripper) return "";
          const parsedLaser = parseLaserCommand(token);
          return parsedLaser ? "" : token;
        })
        .filter((token) => token.length > 0)
        .join(",")
    )
    .join("\n");
}

function getWaitMsForLine(line, fallbackDelay) {
  const waitCmd = line.commands.find((cmd) => cmd.type === "wait");
  return waitCmd ? clamp(waitCmd.ms, 0, 999999) : fallbackDelay;
}

function getScriptMeta(lines) {
  const errorCount = lines.reduce((acc, line) => acc + line.errors.length, 0);
  const hasGripper = lines.some((line) => line.gripperCommands.length > 0);
  const hasLaser = lines.some((line) => line.laserCommands.length > 0);
  return { errorCount, hasGripper, hasLaser };
}

function buildGripperEvents(lines, lineDelay, sourceOrder) {
  const events = [];
  let timeMs = 0;

  for (const line of lines) {
    if (line.gripperCommands.length > 0) {
      const tokens = line.gripperCommands.map((cmd) => `g${cmd.angle}`);
      events.push({ timeMs, tokens, order: sourceOrder + line.index * 0.001 });
    }
    timeMs += getWaitMsForLine(line, lineDelay);
  }

  return events;
}

function buildLaserEvents(lines, lineDelay, sourceOrder) {
  const events = [];
  let timeMs = 0;

  for (const line of lines) {
    if (line.laserCommands.length > 0) {
      const tokens = line.laserCommands.map((cmd) => (cmd.mode === "on" ? "lazon" : cmd.mode === "blink" ? "lazblink" : "lazoff"));
      events.push({ timeMs, tokens, order: sourceOrder + line.index * 0.001 });
    }
    timeMs += getWaitMsForLine(line, lineDelay);
  }

  return events;
}

function buildLaserScriptFromEvents(events) {
  if (events.length === 0) return "";
  const sorted = [...events].sort((a, b) => (a.timeMs === b.timeMs ? a.order - b.order : a.timeMs - b.timeMs));
  const lines = [];
  let lastTime = 0;
  for (const event of sorted) {
    const delta = Math.max(0, Math.round(event.timeMs - lastTime));
    if (delta > 0) lines.push(`wait${delta}`);
    lines.push(event.tokens.join(","));
    lastTime = event.timeMs;
  }
  return lines.join("\n");
}

function buildGripperScriptFromEvents(events) {
  if (events.length === 0) return "";
  const sorted = [...events].sort((a, b) => (a.timeMs === b.timeMs ? a.order - b.order : a.timeMs - b.timeMs));
  const lines = [];
  let lastTime = 0;
  for (const event of sorted) {
    const delta = Math.max(0, Math.round(event.timeMs - lastTime));
    if (delta > 0) lines.push(`wait${delta}`);
    lines.push(event.tokens.join(","));
    lastTime = event.timeMs;
  }
  return lines.join("\n");
}

function MiniProgress({ value }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-gradient-to-r from-sky-400 via-cyan-400 to-indigo-400 transition-all"
        style={{ width: `${clamp(value, 0, 100)}%` }}
      />
    </div>
  );
}

function ParsePill({ ok, text }) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
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
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : active
          ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ icon: Icon, label, value, sub, tint = "sky" }) {
  const tintMap = {
    sky: "from-sky-50 to-cyan-50 text-sky-700",
    violet: "from-violet-50 to-fuchsia-50 text-violet-700",
    emerald: "from-emerald-50 to-lime-50 text-emerald-700",
    amber: "from-amber-50 to-orange-50 text-amber-700",
  };
  return (
    <div className={`rounded-3xl border border-slate-200 bg-gradient-to-br ${tintMap[tint]} p-4 shadow-sm`}>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        {Icon ? <Icon className="h-4 w-4" /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

function makeBot(index) {
  return {
    id: `Bot ${index + 1}`,
    name: "",
    chipId: "",
    ip: DEFAULT_HOSTS[index] || "",
    script: DEFAULT_SCRIPT,
    lineDelay: DEFAULT_LINE_DELAY,
    selected: index === 0,
    sending: false,
    online: true,
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
    lastSeenMs: 0,
    pollFailures: 0,
    pollInFlight: false,
    angles: [83, 83, 86, 90, 90, 90, 90],
    targets: [83, 83, 86, 90, 90, 90, 90],
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
  onHomeBody,
  onHomeLocks,
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
  gripperOnline,
  gripperNeeded,
  laserOnline,
  laserNeeded,
}) {
  const textareaRef = useRef(null);

  const insertSample = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? bot.script.length;
    const end = el.selectionEnd ?? bot.script.length;
    const snippet = "\n1s30\n2s40,3s70\n1s60\n";
    setScript(bot.script.slice(0, start) + snippet + bot.script.slice(end));
    requestAnimationFrame(() => el.focus());
  };

  const lineCount = bot.script.trim().length ? bot.script.trim().split(/\r?\n/).length : 0;
  const statusText = bot.online ? (bot.scriptRunning ? `running line ${bot.lineIndex}/${bot.lineCount || 0}` : bot.sending ? "sending script" : "online") : "offline";

  return (
    <div className={`rounded-[28px] border bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)] ${selected ? "border-sky-300 ring-1 ring-sky-100" : "border-slate-200"}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Bot className="h-5 w-5 text-sky-500" />
            {title}
          </div>
          <div className="mt-1 text-sm text-slate-500">Line-by-line script. Commands in the same row run together.</div>
        </div>
        <button
          onClick={() => setSelected(!selected)}
          className={`rounded-2xl border px-3 py-2 text-xs transition ${selected ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}
        >
          {selected ? "Focus" : "Focus"}
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border-2 border-cyan-500 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-200">ESP32 Host / IP</div>
            <div className="text-xs text-slate-300">manual entry fallback</div>
          </div>
          <input
            value={bot.ip}
            onChange={(e) => setIp(e.target.value.trim())}
            placeholder="microbot1.local or 10.0.0.123"
            className="w-full rounded-2xl border border-slate-200 bg-slate-700 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300"
          />

          <div className="mt-4 grid grid-cols-[1fr_130px] gap-3 items-end">
            <div>
              <div className="text-xs text-slate-400">Line delay</div>
              <div className="mt-1 text-sm text-slate-400">Synced via <span className="font-mono">/setdelay?val=...</span></div>
            </div>
            <input
              type="number"
              min="0"
              step="10"
              value={bot.lineDelay}
              onChange={(e) => setLineDelay(Number(e.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-700 px-4 py-3 text-sm text-slate-50 outline-none focus:border-sky-300"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <ParsePill ok={!!bot.ip} text={bot.ip ? "Host set" : "Host empty"} />
            <ParsePill ok={issueCount === 0} text={issueCount === 0 ? "syntax OK" : `${issueCount} issue(s)`} />
            <ParsePill ok={lineCount > 0} text={`${lineCount} line(s)`} />
            <ParsePill ok={true} text={`${bot.lineDelay} ms delay`} />
          </div>
        </div>

        <div className="rounded-3xl border-2 border-cyan-500 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-4">
          <div className="text-sm font-medium text-slate-200">Status</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-2xl border border-slate-200 bg-slate-700 px-3 py-2">
              <div className="text-slate-50">Commands</div>
              <div className="font-semibold text-slate-200">{commandCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-700 px-3 py-2">
              <div className="text-slate-50">Valid</div>
              <div className="font-semibold text-slate-200">{validCount}</div>
            </div>
          </div>
          <div className="mt-3">
            <MiniProgress value={progress} />
          </div>
          <div className="mt-2 text-xs text-slate-300">{running ? `Running... ${Math.floor(progress)}%` : `Last action: ${lastAction || "idle"}`}</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <ToolbarButton icon={Play} label="Run" onClick={onRun} active />
        <ToolbarButton icon={RotateCcw} label="Reverse" onClick={onReverse} />
        <ToolbarButton icon={Home} label="Home" onClick={onHome} />
        <ToolbarButton icon={Layers3} label="Body" onClick={onHomeBody} />
        <ToolbarButton icon={Home} label="Locks" onClick={onHomeLocks} />
        <ToolbarButton icon={Square} label="Stop" onClick={onStop} danger />
        <ToolbarButton icon={Trash2} label="Clear" onClick={onClear} />
        <ToolbarButton icon={Sparkles} label="New Notepad" onClick={onNew} active />
        <ToolbarButton icon={Copy} label="Copy" onClick={onCopy} />
        <ToolbarButton icon={ArrowRight} label="Mirror" onClick={onMirror} />
        <ToolbarButton icon={Search} label="Validate" onClick={onValidate} />
        <ToolbarButton icon={Download} label="Insert Samples" onClick={insertSample} />
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3">
        <div className="flex items-center justify-between text-xs text-slate-300">
          <span className="inline-flex items-center gap-2">
            {bot.online ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-slate-400" />}
            {bot.id} · {statusText}
          </span>
          <span className="font-mono text-slate-400">poll: {POLL_MS}ms</span>
        </div>
        <div className="mt-2 font-mono text-[11px] leading-5 text-slate-200">{bot.angles.map((a, i) => `${i + 1}:${a}`).join("  ")}</div>
        <div className="mt-1 text-[11px] text-slate-400">
          {bot.scriptRunning ? `line ${bot.lineIndex}/${bot.lineCount || 0} · wait ${bot.waitMs}ms` : bot.sending ? "uploading script..." : `last seen: ${bot.lastSeen}`}
        </div>
        <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] ${gripperOnline ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {gripperOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          Gripper {gripperOnline ? "online" : "offline"}
          {gripperNeeded && !gripperOnline ? " · script blocked" : ""}
        </div>
        <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] ${laserOnline ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>
          {laserOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          Laser {laserOnline ? "online" : "offline"}
          {laserNeeded && !laserOnline ? " · script blocked" : ""}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[28px] border-2 border-cyan-500 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs text-slate-300">
          <span>Script Workspace</span>
          <span className="font-mono text-slate-400">1s30 · 2s40,3s70 · 1s60</span>
        </div>
        <textarea
          ref={textareaRef}
          value={bot.script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          placeholder={`1s30\n2s40,3s70\n1s60`}
          className="min-h-[360px] w-full resize-none bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-4 py-4 font-mono text-[15px] leading-7 text-slate-200 outline-none placeholder:text-slate-400"
        />
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Parsed Preview</div>
          <div className="text-xs text-slate-500">line-by-line execution</div>
        </div>
        <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
          {parsed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">No commands yet.</div>
          ) : (
            parsed.map((line) => (
              <div key={line.index} className={`rounded-2xl border p-3 ${line.isValid ? "border-slate-200 bg-slate-50" : "border-rose-200 bg-rose-50"}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>Row {line.index + 1}</span>
                  <span className="font-mono">{line.raw}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {line.commands.map((cmd, i) => (
                    <span key={i} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-700">
                      <CircleDot className="h-3.5 w-3.5" />
                      {cmd.type === "servo"
                        ? `${cmd.servo + 1}s${cmd.angle}`
                        : cmd.type === "home"
                        ? "home"
                        : cmd.type === "home_body"
                        ? "home-body"
                        : cmd.type === "home_locks"
                        ? "home-locks"
                        : `wait ${cmd.ms}ms`}
                    </span>
                  ))}
                  {line.gripperCommands.map((cmd, i) => (
                    <span key={`g-${i}`} className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                      <CircleDot className="h-3.5 w-3.5" />
                      {`g${cmd.angle}`}
                    </span>
                  ))}
                  {line.laserCommands.map((cmd, i) => (
                    <span key={`l-${i}`} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
                      <CircleDot className="h-3.5 w-3.5" />
                      {cmd.mode === "on" ? "lazon" : cmd.mode === "blink" ? "lazblink" : "lazoff"}
                    </span>
                  ))}
                  {line.errors.map((bad, i) => (
                    <span key={i} className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700">
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

function fetchWithTimeout(url, options = {}, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.log(`[Fetch] Timeout after ${timeoutMs}ms for: ${url}`);
    controller.abort();
  }, timeoutMs);
  return fetch(url, { ...options, signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
}

function buildEspProxyUrl(host, path) {
  const url = new URL(ESP_PROXY_PATH, window.location.origin);
  url.searchParams.set("host", host);
  url.searchParams.set("path", path);
  try {
    const cached = resolvedIpCacheRef.current?.[host];
    if (cached && typeof cached === "string" && cached.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      url.searchParams.set("hostIp", cached);
    }
  } catch (e) {
    // ignore
  }
  return url.toString();
}

export default function App() {
  const [bots, setBots] = useState([makeBot(0), makeBot(1)]);
  const [globalLineDelay, setGlobalLineDelay] = useState(DEFAULT_LINE_DELAY);
  const [globalLog, setGlobalLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [liveHelp, setLiveHelp] = useState(true);
  const [sentRequests, setSentRequests] = useState(0);
  const [includeGripperSync, setIncludeGripperSync] = useState(true);
  const [includeLaserSync, setIncludeLaserSync] = useState(true);
  const [gripperHost, setGripperHost] = useState(DEFAULT_GRIPPER_HOST);
  const [gripperAngle, setGripperAngle] = useState(GRIPPER_HOME);
  const [gripperTarget, setGripperTarget] = useState(GRIPPER_HOME);
  const [gripperOnline, setGripperOnline] = useState(true);
  const [gripperMoving, setGripperMoving] = useState(false);
  const [gripperLastSeen, setGripperLastSeen] = useState("never");
  const [gripperLastSeenMs, setGripperLastSeenMs] = useState(0);
  const [laserHost, setLaserHost] = useState(DEFAULT_LASER_HOST);
  const [laserMode, setLaserMode] = useState("off");
  const [laserOnline, setLaserOnline] = useState(true);
  const [laserLastSeen, setLaserLastSeen] = useState("never");
  const [laserLastSeenMs, setLaserLastSeenMs] = useState(0);
  const [forceLaserDemoAssumptions, setForceLaserDemoAssumptions] = useState(true);
  const [forceImportantDemoAssumptions, setForceImportantDemoAssumptions] = useState(true);
  const [runError, setRunError] = useState("");
  const [activeErrorScope, setActiveErrorScope] = useState("global");
  const [scopedErrors, setScopedErrors] = useState({});
  const [botLocks, setBotLocks] = useState([1, 4]);

  const botsRef = useRef(bots);
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  // Cache of resolved IPs returned by dev-server proxy (host -> ip)
  const resolvedIpCacheRef = useRef({});

  const parsed = useMemo(() => bots.map((b) => parseScript(b.script)), [bots]);
  const parsedMeta = useMemo(() => parsed.map((lines) => getScriptMeta(lines)), [parsed]);

  const pushLog = (msg) => setGlobalLog((prev) => [{ time: nowTime(), msg }, ...prev].slice(0, 18));
  const reportRunError = (msg) => {
    setRunError(msg);
    setScopedErrors((prev) => ({ ...prev, [activeErrorScope]: msg }));
    pushLog(msg);
  };
  const triggerAction = (scope, action) => {
    setActiveErrorScope(scope);
    setRunError("");
    setScopedErrors((prev) => ({ ...prev, [scope]: "" }));
    return action();
  };
  const patchBot = (idx, patch) => setBots((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  const setSelected = (idx) => setBots((prev) => prev.map((b, i) => ({ ...b, selected: i === idx })));
  const currentAnglesSummary = (bot) => (bot.angles || []).map((a, i) => `${i + 1}:${a}`).join("  ");

  const clampGripper = (value) => clamp(value, GRIPPER_MIN, GRIPPER_MAX);
  const gripperUrl = (path) => buildEspProxyUrl(gripperHost, path);
  const laserUrl = (path) => buildEspProxyUrl(laserHost, path);
  const setBotLock = (idx, lock) => setBotLocks((prev) => prev.map((v, i) => (i === idx ? lock : v)));

  const effectiveDelay = (bot) => {
    const local = Number(bot?.lineDelay);
    if (Number.isFinite(local) && local >= 0) return local;
    return globalLineDelay;
  };

  async function sendStatusRequest(idx, path, label) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      pushLog(`${bot?.id || `Bot ${idx + 1}`}: host missing`);
      return;
    }

    patchBot(idx, { sending: true, lastAction: label, status: "sending" });
    setSentRequests((n) => n + 1);

    try {
      await fetchWithTimeout(buildEspProxyUrl(bot.ip, path), {}, 1500);
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
      pushLog(`${bot?.id || `Bot ${idx + 1}`}: host missing`);
      return;
    }

    const scriptText = reverse ? reverseScriptText(bot.script) : bot.script;
    const body = toEspScript(scriptText);
    if (!body.trim()) {
      pushLog(`${bot.ip}: empty script`);
      return;
    }

    const delay = effectiveDelay(bot);
    const setDelayUrl = buildEspProxyUrl(bot.ip, `/setdelay?val=${encodeURIComponent(delay)}`);
    const runUrl = buildEspProxyUrl(bot.ip, "/run");

    patchBot(idx, { sending: true, lastAction: reverse ? "reverse upload" : "script upload", status: "sending" });
    setSentRequests((n) => n + 1);
    pushLog(`${bot.ip}: ${reverse ? "reverse" : "run"} script upload (${delay}ms)`);

    try {
      await fetchWithTimeout(setDelayUrl, {}, 1200);
      await fetchWithTimeout(runUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      }, Math.max(1500, body.length * 15));
      patchBot(idx, { lastAction: reverse ? "reverse uploaded" : "script uploaded", status: "queued" });
    } catch {
      patchBot(idx, { status: "error" });
      pushLog(`${bot.ip}: script upload failed`);
    } finally {
      patchBot(idx, { sending: false });
    }

    console.log("SENDING TO:", runUrl, "BODY:", body);
  }

  async function sendScriptBodyToBot(idx, scriptText) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      reportRunError(`${bot?.id || `Bot ${idx + 1}`}: host missing`);
      return false;
    }

    const body = toEspScript(scriptText);
    if (!body.trim()) {
      reportRunError(`${bot.ip}: empty script`);
      return false;
    }

    const delay = effectiveDelay(bot);
    const setDelayUrl = buildEspProxyUrl(bot.ip, `/setdelay?val=${encodeURIComponent(delay)}`);
    const runUrl = buildEspProxyUrl(bot.ip, "/run");

    patchBot(idx, { sending: true, lastAction: "script upload", status: "sending" });
    setSentRequests((n) => n + 1);

    try {
      await fetchWithTimeout(setDelayUrl, {}, 1200);
      await fetchWithTimeout(runUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      }, Math.max(1500, body.length * 15));
      patchBot(idx, { lastAction: "script uploaded", status: "queued" });
      return true;
    } catch {
      patchBot(idx, { status: "error" });
      reportRunError(`${bot.ip}: script upload failed`);
      return false;
    } finally {
      patchBot(idx, { sending: false });
    }
  }

  async function queueScriptBodyToBot(idx, scriptText) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      reportRunError(`${bot?.id || `Bot ${idx + 1}`}: host missing`);
      return false;
    }

    const body = toEspScript(scriptText);
    if (!body.trim()) {
      reportRunError(`${bot.ip}: empty script`);
      return false;
    }

    const delay = effectiveDelay(bot);
    const setDelayUrl = buildEspProxyUrl(bot.ip, `/setdelay?val=${encodeURIComponent(delay)}`);
    const runUrl = buildEspProxyUrl(bot.ip, "/run?mode=queue");

    patchBot(idx, { sending: true, lastAction: "script queued", status: "sending" });
    setSentRequests((n) => n + 1);

    try {
      await fetchWithTimeout(setDelayUrl, {}, 1200);
      await fetchWithTimeout(runUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      }, Math.max(1500, body.length * 15));
      patchBot(idx, { lastAction: "queued", status: "queued" });
      return true;
    } catch {
      patchBot(idx, { status: "error" });
      reportRunError(`${bot.ip}: queue failed`);
      return false;
    } finally {
      patchBot(idx, { sending: false });
    }
  }

  async function queueScriptToBot(idx, reverse = false) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) {
      pushLog(`${bot?.id || `Bot ${idx + 1}`}: host missing`);
      return;
    }

    const scriptText = reverse ? reverseScriptText(bot.script) : bot.script;
    const body = toEspScript(scriptText);
    if (!body.trim()) {
      pushLog(`${bot.ip}: empty script`);
      return;
    }

    const delay = effectiveDelay(bot);
    const setDelayUrl = buildEspProxyUrl(bot.ip, `/setdelay?val=${encodeURIComponent(delay)}`);
    const runUrl = buildEspProxyUrl(bot.ip, "/run?mode=queue");

    patchBot(idx, { sending: true, lastAction: reverse ? "reverse queued" : "script queued", status: "sending" });
    setSentRequests((n) => n + 1);
    pushLog(`${bot.ip}: queued script (${delay}ms)`);

    try {
      await fetchWithTimeout(setDelayUrl, {}, 1200);
      await fetchWithTimeout(runUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      }, Math.max(1500, body.length * 15));
      patchBot(idx, { lastAction: "queued", status: "queued" });
    } catch {
      patchBot(idx, { status: "error" });
      pushLog(`${bot.ip}: queue failed`);
    } finally {
      patchBot(idx, { sending: false });
    }
  }

  async function fetchEspEpochMs(idx) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) return null;
    const url = buildEspProxyUrl(bot.ip, "/time");
    const res = await fetchWithTimeout(url, {}, 1200);
    if (!res.ok) return null;
    const data = await res.json();
    const value = Number(data?.epochMs);
    return Number.isFinite(value) ? value : null;
  }

  async function startBotAt(idx, epochMs) {
    const bot = botsRef.current[idx];
    if (!bot?.ip) return;
    const url = buildEspProxyUrl(bot.ip, `/start?at=${encodeURIComponent(epochMs)}`);
    await fetchWithTimeout(url, {}, 1200);
  }

  async function fetchGripperEpochMs() {
    if (!gripperHost) return null;
    const url = gripperUrl("/time");
    const res = await fetchWithTimeout(url, {}, 1200);
    if (!res.ok) return null;
    const data = await res.json();
    const value = Number(data?.epochMs);
    return Number.isFinite(value) ? value : null;
  }

  async function queueGripper(angle) {
    if (!gripperHost) return;
    const clamped = clampGripper(angle);
    const url = gripperUrl(`/queue?angle=${encodeURIComponent(clamped)}`);
    await fetchWithTimeout(url, {}, 1200);
  }

  async function queueGripperScript(script) {
    if (!gripperHost) return;
    if (!script.trim()) return;
    const url = gripperUrl("/run?mode=queue");
    await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: script,
    }, Math.max(1500, script.length * 15));
  }

  async function startGripperAt(epochMs) {
    if (!gripperHost) return;
    const url = gripperUrl(`/start?at=${encodeURIComponent(epochMs)}`);
    await fetchWithTimeout(url, {}, 1200);
  }

  async function fetchLaserEpochMs() {
    if (!laserHost) return null;
    const url = laserUrl("/time");
    const res = await fetchWithTimeout(url, {}, 1200);
    if (!res.ok) return null;
    const data = await res.json();
    const value = Number(data?.epochMs);
    return Number.isFinite(value) ? value : null;
  }

  async function sendGripperAngle(angle) {
    if (!gripperHost) return;
    const clamped = clampGripper(angle);
    const url = gripperUrl(`/api?cmd=g${encodeURIComponent(clamped)}`);
    await fetchWithTimeout(url, {}, 1200);
    setGripperTarget(clamped);
  }

  async function queueLaserScript(script) {
    if (!laserHost) return;
    if (!script.trim()) return;
    const url = laserUrl("/run?mode=queue");
    await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: script,
    }, Math.max(1500, script.length * 15));
  }

  async function startLaserAt(epochMs) {
    if (!laserHost) return;
    const url = laserUrl(`/start?at=${encodeURIComponent(epochMs)}`);
    await fetchWithTimeout(url, {}, 1200);
  }

  async function sendLaserMode(mode) {
    if (!laserHost) return;
    const nextMode = LASER_MODES.includes(mode) ? mode : "off";
    const path = nextMode === "on" ? "/lazon" : nextMode === "blink" ? "/lazblink" : "/lazoff";
    const url = laserUrl(path);
    await fetchWithTimeout(url, {}, 1200);
    setLaserMode(nextMode);
  }

  async function runScriptText(
    idx,
    scriptText,
    { requiresGripper = false, requiresLaser = false, allowBotOffline = false, allowLaserOffline = false } = {}
  ) {
    setRunError("");
    const lines = parseScript(scriptText);
    const meta = getScriptMeta(lines);
    const bot = botsRef.current[idx];

    if (meta.errorCount > 0) {
      reportRunError(`Bot ${idx + 1}: fix script errors before run`);
      return false;
    }
    if (!bot?.online && !allowBotOffline) {
      reportRunError(`Bot ${idx + 1} is offline. Bring it online before running.`);
      return false;
    }
    const needsGripper = requiresGripper || meta.hasGripper;
    if (needsGripper && !gripperOnline) {
      reportRunError("Gripper offline: remove g-commands or bring gripper online.");
      return false;
    }
    const needsLaser = requiresLaser || meta.hasLaser;
    if (needsLaser && !laserOnline && !allowLaserOffline) {
      reportRunError("Laser offline: remove l-commands or bring laser online.");
      return false;
    }

    patchBot(idx, { script: scriptText });

    if (!meta.hasGripper && !meta.hasLaser) {
      return await sendScriptBodyToBot(idx, scriptText);
    }

    const gripperEvents = meta.hasGripper ? buildGripperEvents(lines, effectiveDelay(bot), idx) : [];
    const gripperScript = buildGripperScriptFromEvents(gripperEvents);
    const laserEvents = meta.hasLaser ? buildLaserEvents(lines, effectiveDelay(bot), idx) : [];
    const laserScript = buildLaserScriptFromEvents(laserEvents);
    const queued = await queueScriptBodyToBot(idx, scriptText);
    if (!queued) return false;
    if (meta.hasGripper) await queueGripperScript(gripperScript);
    if (meta.hasLaser) await queueLaserScript(laserScript);

    try {
      const timeCalls = [fetchEspEpochMs(idx)];
      if (meta.hasGripper) timeCalls.push(fetchGripperEpochMs());
      if (meta.hasLaser) timeCalls.push(fetchLaserEpochMs());
      const times = await Promise.all(timeCalls);
      const tb = times[0];
      const tg = meta.hasGripper ? times[1] : null;
      const tl = meta.hasLaser ? times[times.length - 1] : null;
      if (tb == null || (meta.hasGripper && tg == null) || (meta.hasLaser && tl == null)) {
        reportRunError("Sync start failed: time not available");
        return false;
      }
      const startAt = Math.max(tb, meta.hasGripper ? tg : 0, meta.hasLaser ? tl : 0) + SYNC_START_BUFFER_MS;
      const startCalls = [startBotAt(idx, startAt)];
      if (meta.hasGripper) startCalls.push(startGripperAt(startAt));
      if (meta.hasLaser) startCalls.push(startLaserAt(startAt));
      await Promise.all(startCalls);
      pushLog(`Sync start at ${startAt}`);
      return true;
    } catch {
      reportRunError("Sync start failed");
      return false;
    }
  }

  async function runScript(idx, reverse = false) {
    const meta = parsedMeta[idx];
    if (meta.errorCount > 0) {
      reportRunError(`Bot ${idx + 1}: fix script errors before run`);
      return;
    }
    if (!botsRef.current[idx]?.online) {
      reportRunError(`Bot ${idx + 1} is offline. Bring it online before running.`);
      return;
    }
    if (meta.hasGripper && !gripperOnline) {
      reportRunError("Gripper offline: remove g-commands or bring gripper online.");
      return;
    }
    if (meta.hasLaser && !laserOnline) {
      reportRunError("Laser offline: remove l-commands or bring laser online.");
      return;
    }
    if (!meta.hasGripper && !meta.hasLaser) {
      await sendScriptToBot(idx, reverse);
      return;
    }

    const gripperEvents = meta.hasGripper ? buildGripperEvents(parsed[idx], effectiveDelay(botsRef.current[idx]), idx) : [];
    const gripperScript = buildGripperScriptFromEvents(gripperEvents);
    const laserEvents = meta.hasLaser ? buildLaserEvents(parsed[idx], effectiveDelay(botsRef.current[idx]), idx) : [];
    const laserScript = buildLaserScriptFromEvents(laserEvents);
    await queueScriptToBot(idx, reverse);
    if (meta.hasGripper) await queueGripperScript(gripperScript);
    if (meta.hasLaser) await queueLaserScript(laserScript);

    try {
      const timeCalls = [fetchEspEpochMs(idx)];
      if (meta.hasGripper) timeCalls.push(fetchGripperEpochMs());
      if (meta.hasLaser) timeCalls.push(fetchLaserEpochMs());
      const times = await Promise.all(timeCalls);
      const tb = times[0];
      const tg = meta.hasGripper ? times[1] : null;
      const tl = meta.hasLaser ? times[times.length - 1] : null;
      if (tb == null || (meta.hasGripper && tg == null) || (meta.hasLaser && tl == null)) {
        pushLog("Sync start failed: time not available");
      } else {
        const startAt = Math.max(tb, meta.hasGripper ? tg : 0, meta.hasLaser ? tl : 0) + SYNC_START_BUFFER_MS;
        const startCalls = [startBotAt(idx, startAt)];
        if (meta.hasGripper) startCalls.push(startGripperAt(startAt));
        if (meta.hasLaser) startCalls.push(startLaserAt(startAt));
        await Promise.all(startCalls);
        pushLog(`Sync start at ${startAt}`);
      }
    } catch {
      pushLog("Sync start failed");
    }
  }

  async function runBothSameTime(reverse = false) {
    setBusy(true);
    pushLog(`All units: ${reverse ? "reverse run" : "run"}`);
    const metaA = parsedMeta[0];
    const metaB = parsedMeta[1];
    const anyErrors = metaA.errorCount > 0 || metaB.errorCount > 0;
    const anyGripper = metaA.hasGripper || metaB.hasGripper;
    const anyLaser = metaA.hasLaser || metaB.hasLaser;
    if (anyErrors) {
      reportRunError("Fix script errors before Run All.");
      setBusy(false);
      return;
    }
    const bot0Online = botsRef.current[0]?.online;
    const bot1Online = botsRef.current[1]?.online;
    if (!bot0Online || !bot1Online) {
      reportRunError("One or more bots are offline. Bring both online before Run All.");
      setBusy(false);
      return;
    }
    if (anyGripper && !gripperOnline) {
      reportRunError("Gripper offline: remove g-commands or bring gripper online.");
      setBusy(false);
      return;
    }
    if (anyLaser && !laserOnline) {
      reportRunError("Laser offline: remove l-commands or bring laser online.");
      setBusy(false);
      return;
    }

    await Promise.all([queueScriptToBot(0, reverse), queueScriptToBot(1, reverse)]);
    if (includeGripperSync && anyGripper) {
      const eventsA = buildGripperEvents(parsed[0], effectiveDelay(botsRef.current[0]), 0);
      const eventsB = buildGripperEvents(parsed[1], effectiveDelay(botsRef.current[1]), 1);
      const gripperScript = buildGripperScriptFromEvents([...eventsA, ...eventsB]);
      await queueGripperScript(gripperScript);
    }
    if (includeLaserSync && anyLaser) {
      const eventsA = buildLaserEvents(parsed[0], effectiveDelay(botsRef.current[0]), 0);
      const eventsB = buildLaserEvents(parsed[1], effectiveDelay(botsRef.current[1]), 1);
      const laserScript = buildLaserScriptFromEvents([...eventsA, ...eventsB]);
      await queueLaserScript(laserScript);
    }

    try {
      const timeCalls = [fetchEspEpochMs(0), fetchEspEpochMs(1)];
      if (includeGripperSync && anyGripper) timeCalls.push(fetchGripperEpochMs());
      if (includeLaserSync && anyLaser) timeCalls.push(fetchLaserEpochMs());
      const times = await Promise.all(timeCalls);
      const [t0, t1] = times;
      const tg = includeGripperSync && anyGripper ? times[2] : null;
      const tl = includeLaserSync && anyLaser ? times[times.length - 1] : null;
      if (t0 == null || t1 == null || (includeGripperSync && anyGripper && tg == null) || (includeLaserSync && anyLaser && tl == null)) {
        pushLog("Sync start failed: time not available");
      } else {
        const startAt = Math.max(t0, t1, includeGripperSync && anyGripper ? tg : 0, includeLaserSync && anyLaser ? tl : 0) + SYNC_START_BUFFER_MS;
        const startCalls = [startBotAt(0, startAt), startBotAt(1, startAt)];
        if (includeGripperSync && anyGripper) startCalls.push(startGripperAt(startAt));
        if (includeLaserSync && anyLaser) startCalls.push(startLaserAt(startAt));
        await Promise.all(startCalls);
        pushLog(`Sync start at ${startAt}`);
      }
    } catch {
      pushLog("Sync start failed");
    }
    setBusy(false);
  }

  async function moveBot(idx, fromLock, toLock, scriptText) {
    if (botLocks[idx] !== fromLock) {
      reportRunError(`Bot ${idx + 1} expected at Lock ${fromLock}. Current: Lock ${botLocks[idx]}.`);
      return;
    }
    const ok = await runScriptText(idx, scriptText);
    if (ok) setBotLock(idx, toLock);
  }

  async function runGripperDemo() {
    if (botLocks[0] !== 2) {
      reportRunError(`Gripper demo requires Bot 1 at Lock 2. Current: Lock ${botLocks[0]}.`);
      return false;
    }
    return await runScriptText(0, GRIPPER_DEMO_SCRIPT, { requiresGripper: true });
  }

  async function runLaserDemo() {
    const bot2Lock = botLocks[1];
    const shouldForce = forceLaserDemoAssumptions;

    if (!botsRef.current[1]?.online && !shouldForce) {
      reportRunError("Laser demo requires Bot 2 online.");
      return false;
    }
    if (!laserOnline && !shouldForce) {
      reportRunError("Laser demo requires lazer online.");
      return false;
    }
    if (bot2Lock !== 4) {
      if (!shouldForce) {
        reportRunError(`Laser demo requires Bot 2 at Lock 4. Current: Lock ${bot2Lock}.`);
        return false;
      }
      setBotLock(1, 4);
      pushLog("Laser demo: forced Bot 2 to Lock 4");
    }

    if (!botsRef.current[1]?.online && shouldForce) {
      pushLog("Laser demo: forcing Bot 2 online assumption");
    }
    if (!laserOnline && shouldForce) {
      pushLog("Laser demo: forcing laser online assumption");
    }

    return await runScriptText(1, LASER_DEMO_SCRIPT, {
      requiresLaser: true,
      allowBotOffline: shouldForce,
      allowLaserOffline: shouldForce,
    });
  }

  async function runImportantDualDemo() {
    const shouldForce = forceImportantDemoAssumptions;

    if (botLocks[0] !== 2 || botLocks[1] !== 4) {
      if (!shouldForce) {
        reportRunError(`Important demo requires Bot 1 at Lock 2 and Bot 2 at Lock 4. Current: ${botLocks[0]} / ${botLocks[1]}.`);
        return false;
      }
      setBotLock(0, 2);
      setBotLock(1, 4);
      pushLog("Important demo: forced Bot 1 to Lock 2 and Bot 2 to Lock 4");
    }

    if (!botsRef.current[0]?.online && !shouldForce) {
      reportRunError("Important demo requires Bot 1 online.");
      return false;
    }
    if (!botsRef.current[1]?.online && !shouldForce) {
      reportRunError("Important demo requires Bot 2 online.");
      return false;
    }

    const parsedA = parseScript(IMPORTANT_BOT1_SCRIPT);
    const parsedB = parseScript(IMPORTANT_BOT2_SCRIPT);
    const metaA = getScriptMeta(parsedA);
    const metaB = getScriptMeta(parsedB);
    if (metaA.errorCount > 0 || metaB.errorCount > 0) {
      reportRunError("Important demo script has errors. Fix the preset text before running.");
      return false;
    }

    setBusy(true);
    pushLog("Important demo: run both scripts together");

    try {
      const ok = await Promise.all([
        queueScriptBodyToBot(0, IMPORTANT_BOT1_SCRIPT),
        queueScriptBodyToBot(1, IMPORTANT_BOT2_SCRIPT),
      ]);
      if (!ok[0] || !ok[1]) {
        setBusy(false);
        return false;
      }

      const [t0, t1] = await Promise.all([fetchEspEpochMs(0), fetchEspEpochMs(1)]);
      if (t0 == null || t1 == null) {
        reportRunError("Important demo sync start failed: time not available");
        setBusy(false);
        return false;
      }

      const startAt = Math.max(t0, t1) + SYNC_START_BUFFER_MS;
      await Promise.all([startBotAt(0, startAt), startBotAt(1, startAt)]);
      pushLog(`Important demo sync start at ${startAt}`);
      return true;
    } catch {
      reportRunError("Important demo sync start failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function homeAll() {
    setBusy(true);
    pushLog("Home all");
    await Promise.all([sendStatusRequest(0, "/action?type=home", "home"), sendStatusRequest(1, "/action?type=home", "home")]);
    setBusy(false);
  }

  async function homeBodyAll() {
    setBusy(true);
    pushLog("Home body all");
    await Promise.all([sendStatusRequest(0, "/action?type=homebody", "home body"), sendStatusRequest(1, "/action?type=homebody", "home body")]);
    setBusy(false);
  }

  async function homeLocksAll() {
    setBusy(true);
    pushLog("Home locks all");
    await Promise.all([sendStatusRequest(0, "/action?type=homelock", "home locks"), sendStatusRequest(1, "/action?type=homelock", "home locks")]);
    setBusy(false);
  }

  async function stopAll() {
    setBusy(true);
    pushLog("Stop all");
    await Promise.all([sendStatusRequest(0, "/action?type=stop", "stop"), sendStatusRequest(1, "/action?type=stop", "stop")]);
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
    copyBot(0, 1);
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
    if (bot.pollInFlight) return;

    patchBot(idx, { pollInFlight: true });

    try {
      const url = buildEspProxyUrl(bot.ip, "/status");
      console.log(`[Poll ${idx}] Fetching: ${url}`);
      const statusRes = await fetchWithTimeout(url, {}, 2000);
      console.log(`[Poll ${idx}] ${bot.ip} - status: ${statusRes.status}, ok: ${statusRes.ok}`);

      if (!statusRes.ok) {
        const current = botsRef.current[idx];
        const nextFailures = (current?.pollFailures || 0) + 1;
        const lastMs = current?.lastSeenMs || 0;
        const stillOnline = Date.now() - lastMs <= ONLINE_THRESHOLD_MS;
        console.log(`[Poll ${idx}] Failed (${statusRes.status}) - failures: ${nextFailures}, lastSeenMs: ${lastMs}, stillOnline: ${stillOnline}`);
        patchBot(idx, {
          pollFailures: nextFailures,
          online: stillOnline,
          receiving: stillOnline ? current?.receiving ?? false : false,
        });
        return;
      }

      const s = await statusRes.json();
      try {
        const resolvedIp = statusRes.headers.get?.("x-resolved-ip");
        if (resolvedIp) resolvedIpCacheRef.current[bot.ip] = resolvedIp;
      } catch (e) {
        // ignore
      }
      console.log(`[Poll ${idx}] Success - angles: ${s.angles}, running: ${s.running}`);
      const angles = Array.isArray(s.angles) ? s.angles.map((n) => Number(n) || 0).slice(0, SERVO_MAX) : [];
      const normalizedAngles = angles.length === SERVO_MAX ? angles : [83, 83, 86, 90, 90, 90, 90];
      const running = !!s.running;

      patchBot(idx, {
        online: true,
        receiving: true,
        scriptRunning: running,
        waiting: false,
        waitMs: 0,
        lineIndex: 0,
        lineCount: 0,
        angles: normalizedAngles,
        targets: normalizedAngles,
        progress: running ? 50 : 100,
        lastSeen: nowTime(),
        lastSeenMs: Date.now(),
        sending: false,
        status: running ? "running" : "ready",
        pollFailures: 0,
      });
    } catch (err) {
      const current = botsRef.current[idx];
      const nextFailures = (current?.pollFailures || 0) + 1;
      const lastMs = current?.lastSeenMs || 0;
      const stillOnline = Date.now() - lastMs <= ONLINE_THRESHOLD_MS;
      const errMsg = err?.name === "AbortError" ? "timeout or aborted" : err?.message || "unknown error";
      console.log(`[Poll ${idx}] Exception - ${errMsg}, failures: ${nextFailures}, lastSeenMs: ${lastMs}, stillOnline: ${stillOnline}`);
      patchBot(idx, {
        pollFailures: nextFailures,
        online: stillOnline,
        receiving: stillOnline ? current?.receiving ?? false : false,
      });
    } finally {
      patchBot(idx, { pollInFlight: false });
    }
  }

  async function pollGripper() {
    if (!gripperHost) return;
    try {
      const url = gripperUrl("/status");
      const statusRes = await fetchWithTimeout(url, {}, 2000);
      if (!statusRes.ok) {
        gripperFailuresRef.current = (gripperFailuresRef.current || 0) + 1;
        const stillOnline = Date.now() - (gripperLastSeenMs || 0) <= ONLINE_THRESHOLD_MS;
        console.log(`[Poll Gripper] non-ok ${statusRes.status}, stillOnline=${stillOnline}, failures=${gripperFailuresRef.current}`);
        setGripperOnline(stillOnline);
        return;
      }
      const s = await statusRes.json();
      try {
        const resolvedIp = statusRes.headers.get?.("x-resolved-ip");
        if (resolvedIp) resolvedIpCacheRef.current[gripperHost] = resolvedIp;
      } catch (e) {
        // ignore
      }
      gripperFailuresRef.current = 0;
      const angle = clampGripper(Number(s?.angle) || GRIPPER_HOME);
      setGripperAngle(angle);
      setGripperMoving(!!s?.moving);
      setGripperOnline(true);
      setGripperLastSeen(nowTime());
      setGripperLastSeenMs(Date.now());
    } catch {
      gripperFailuresRef.current = (gripperFailuresRef.current || 0) + 1;
      const stillOnline = Date.now() - (gripperLastSeenMs || 0) <= ONLINE_THRESHOLD_MS;
      console.log(`[Poll Gripper] exception, stillOnline=${stillOnline}, failures=${gripperFailuresRef.current}`);
      setGripperOnline(stillOnline);
    }
  }

  async function pollLaser() {
    if (!laserHost) return;
    try {
      const url = laserUrl("/status");
      const statusRes = await fetchWithTimeout(url, {}, 2000);
      if (!statusRes.ok) {
        laserFailuresRef.current = (laserFailuresRef.current || 0) + 1;
        const stillOnline = Date.now() - (laserLastSeenMs || 0) <= ONLINE_THRESHOLD_MS;
        console.log(`[Poll Laser] non-ok ${statusRes.status}, stillOnline=${stillOnline}, failures=${laserFailuresRef.current}`);
        setLaserOnline(stillOnline);
        return;
      }
      const s = await statusRes.json();
      try {
        const resolvedIp = statusRes.headers.get?.("x-resolved-ip");
        if (resolvedIp) resolvedIpCacheRef.current[laserHost] = resolvedIp;
      } catch (e) {
        // ignore
      }
      laserFailuresRef.current = 0;
      const mode = typeof s?.mode === "string" ? s.mode.toLowerCase() : "off";
      setLaserMode(LASER_MODES.includes(mode) ? mode : "off");
      setLaserOnline(true);
      setLaserLastSeen(nowTime());
      setLaserLastSeenMs(Date.now());
    } catch {
      laserFailuresRef.current = (laserFailuresRef.current || 0) + 1;
      const stillOnline = Date.now() - (laserLastSeenMs || 0) <= ONLINE_THRESHOLD_MS;
      console.log(`[Poll Laser] exception, stillOnline=${stillOnline}, failures=${laserFailuresRef.current}`);
      setLaserOnline(stillOnline);
    }
  }

  useEffect(() => {
    const timers = [null, null];
    let cancelled = false;

    function scheduleBot(idx) {
      const run = async () => {
        if (cancelled) return;
        await pollBot(idx);
        if (cancelled) return;
        const failures = botsRef.current[idx]?.pollFailures || 0;
        const mult = Math.min(1 << failures, MAX_BACKOFF_MULTIPLIER);
        const jitter = Math.random() * 300;
        const delay = POLL_MS * mult + jitter;
        timers[idx] = setTimeout(run, delay);
      };
      run();
    }

    scheduleBot(0);
    scheduleBot(1);
    return () => {
      cancelled = true;
      timers.forEach((t) => t && clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await pollGripper();
      if (cancelled) return;
      const failures = gripperFailuresRef.current || 0;
      const mult = Math.min(1 << failures, MAX_BACKOFF_MULTIPLIER);
      const jitter = Math.random() * 300;
      const delay = POLL_MS * mult + jitter;
      timer = setTimeout(run, delay);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gripperHost]);

  useEffect(() => {
    let timer = null;
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await pollLaser();
      if (cancelled) return;
      const failures = laserFailuresRef.current || 0;
      const mult = Math.min(1 << failures, MAX_BACKOFF_MULTIPLIER);
      const jitter = Math.random() * 300;
      const delay = POLL_MS * mult + jitter;
      timer = setTimeout(run, delay);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [laserHost]);

  const receivingCount = bots.filter((b) => b.receiving).length;
  const sendingCount = bots.filter((b) => b.sending).length;
  const workingCount = bots.filter((b) => b.scriptRunning).length;
  const allIPsSet = bots.every((b) => b.ip && b.ip.length > 0);
  const globalStatusText = useMemo(() => (allIPsSet ? "Hosts ready" : "Host slots still empty"), [allIPsSet]);

  const gripperFailuresRef = useRef(0);
  const laserFailuresRef = useRef(0);
  const MAX_BACKOFF_MULTIPLIER = 8; // cap exponential multiplier

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#0f172a_0%,#111827_38%,#f8fafc_100%)] text-slate-900">
      <div className="fixed inset-x-0 top-0 z-50 border-b border-sky-100 bg-gradient-to-r from-white/95 via-sky-50/90 to-white/95 shadow-[0_6px_24px_rgba(2,132,199,0.12)] backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-3 px-4 py-3 lg:px-5">
          <div className="flex items-center gap-2 truncate">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
            <div className="truncate text-[15px] font-bold tracking-wide text-slate-900">TETROBOT CONTROL CENTER</div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${bots[0]?.online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {bots[0]?.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} Bot 1
            </div>
            <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${bots[1]?.online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {bots[1]?.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} Bot 2
            </div>
            <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${gripperOnline ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {gripperOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} Gripper
            </div>
            <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${laserOnline ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {laserOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} Lazer
            </div>
          </div>
        </div>
        {runError ? <div className="border-t border-rose-100 bg-rose-50 px-4 py-1.5 text-xs font-medium text-rose-700 lg:px-5">{runError}</div> : null}
      </div>

      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col px-4 py-4 pt-[86px] lg:px-5">
        <div className="mb-4 rounded-[30px] border border-slate-200 bg-white/90 p-4 shadow-[0_10px_35px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 ring-1 ring-sky-100">
                  <Layers3 className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-3xl font-bold tracking-tight text-slate-900">TETROBOT - Robotic Arm Controller</div>
                  <div className="text-xl font-bold tracking-tight text-slate-800">Made by Nischay Sai D R</div>
                  <div className="mt-1 text-sm text-slate-500">Notepad-style scripting, reverse execution, and dock-ready control.</div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">{globalStatusText}</div>
              <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">Delay default {DEFAULT_LINE_DELAY}ms</div>
              <button
                onClick={() => setIncludeGripperSync((v) => !v)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${includeGripperSync ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}
              >
                {includeGripperSync ? "Gripper sync on" : "Gripper sync off"}
              </button>
              <button
                onClick={() => setIncludeLaserSync((v) => !v)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${includeLaserSync ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}
              >
                {includeLaserSync ? "Laser sync on" : "Laser sync off"}
              </button>
              <ToolbarButton icon={Play} label="Run All" onClick={() => triggerAction("top-controls", () => runBothSameTime(false))} disabled={busy} active />
              <ToolbarButton icon={RotateCcw} label="Reverse All" onClick={() => triggerAction("top-controls", () => runBothSameTime(true))} disabled={busy} />
              <ToolbarButton icon={Home} label="Home All" onClick={() => triggerAction("top-controls", homeAll)} disabled={busy} />
              <ToolbarButton icon={Layers3} label="Body All" onClick={() => triggerAction("top-controls", homeBodyAll)} disabled={busy} />
              <ToolbarButton icon={Home} label="Locks All" onClick={() => triggerAction("top-controls", homeLocksAll)} disabled={busy} />
              <ToolbarButton icon={Square} label="Stop All" onClick={() => triggerAction("top-controls", stopAll)} disabled={busy} danger />
            </div>
          </div>

          {scopedErrors["top-controls"] ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{scopedErrors["top-controls"]}</div> : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <StatCard icon={Activity} label="Requests Sent" value={sentRequests} sub="script uploads + direct commands" />
            <StatCard icon={ArrowRight} label="Sending Now" value={sendingCount} sub="requests currently in flight" />
            <StatCard icon={Wifi} label="Receiving" value={receivingCount} sub="ESPs responding to polling" />
            <StatCard icon={Sparkles} label="Working" value={workingCount} sub="ESPs running script engine" />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-2">
            {bots.map((bot) => (
              <div key={bot.id} className="rounded-2xl border border-slate-200 bg-slate-900 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{bot.name || bot.id}</div>
                    <div className="text-xs text-slate-400">{bot.ip || "IP empty"}{bot.chipId ? ` · ${bot.chipId}` : ""}</div>
                  </div>
                  <div className={`rounded-full px-2.5 py-1 text-[16px] font-bold ${bot.online ? "bg-emerald-50 text-emerald-700" : "bg-slate-800 text-slate-500"}`}>
                    {bot.online ? "ONLINE" : "OFFLINE"}
                  </div>
                </div>
                <div className="mt-2 font-mono text-[11px] text-slate-700">{currentAnglesSummary(bot)}</div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {bot.scriptRunning ? `running line ${bot.lineIndex}/${bot.lineCount || 0} · wait ${bot.waitMs}ms` : bot.sending ? "uploading script..." : `last seen: ${bot.lastSeen}`}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-violet-400" style={{ width: `${clamp(bot.progress || 0, 0, 100)}%` }} />
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
            onHome={() => sendStatusRequest(0, "/action?type=home", "home")}
            onHomeBody={() => sendStatusRequest(0, "/action?type=homebody", "home body")}
            onHomeLocks={() => sendStatusRequest(0, "/action?type=homelock", "home locks")}
            onStop={() => sendStatusRequest(0, "/action?type=stop", "stop")}
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
            gripperOnline={gripperOnline}
            gripperNeeded={parsedMeta[0].hasGripper}
            laserOnline={laserOnline}
            laserNeeded={parsedMeta[0].hasLaser}
          />

          <BotPanel
            title="Workspace B"
            bot={bots[1]}
            setIp={(v) => patchBot(1, { ip: v })}
            setScript={(v) => patchBot(1, { script: v })}
            setLineDelay={(v) => patchBot(1, { lineDelay: Number.isFinite(v) ? v : DEFAULT_LINE_DELAY })}
            onRun={() => runScript(1, false)}
            onReverse={() => runScript(1, true)}
            onHome={() => sendStatusRequest(1, "/action?type=home", "home")}
            onHomeBody={() => sendStatusRequest(1, "/action?type=homebody", "home body")}
            onHomeLocks={() => sendStatusRequest(1, "/action?type=homelock", "home locks")}
            onStop={() => sendStatusRequest(1, "/action?type=stop", "stop")}
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
            gripperOnline={gripperOnline}
            gripperNeeded={parsedMeta[1].hasGripper}
            laserOnline={laserOnline}
            laserNeeded={parsedMeta[1].hasLaser}
          />
        </div>

        <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">Gripper + Laser</div>
              <div className="text-sm text-slate-500">Manual control + optional sync with Run All.</div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${gripperOnline ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {gripperOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                Gripper {gripperOnline ? "ONLINE" : "OFFLINE"}
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${laserOnline ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                {laserOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                Laser {laserOnline ? "ONLINE" : "OFFLINE"}
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr_0.9fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-sm font-medium text-slate-200">Gripper Host / IP</div>
              <input
                value={gripperHost}
                onChange={(e) => setGripperHost(e.target.value.trim())}
                placeholder="gripper.local or 10.0.0.201"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-sky-300"
              />
              <div className="mt-4">
                <div className="text-xs text-slate-400">Angle</div>
                <input
                  type="range"
                  min={GRIPPER_MIN}
                  max={GRIPPER_MAX}
                  value={gripperTarget}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setGripperTarget(value);
                    sendGripperAngle(value);
                  }}
                  className="mt-2 w-full"
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={GRIPPER_MIN}
                    max={GRIPPER_MAX}
                    value={gripperTarget}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setGripperTarget(value);
                      sendGripperAngle(value);
                    }}
                    className="w-24 rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-300"
                  />
                  <button
                    onClick={() => sendGripperAngle(GRIPPER_HOME)}
                    className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 shadow-sm"
                  >
                    Home
                  </button>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-sm font-medium text-slate-200">Laser Host / Mode</div>
              <input
                value={laserHost}
                onChange={(e) => setLaserHost(e.target.value.trim())}
                placeholder="lazer.local or 10.0.0.202"
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-300"
              />
              <div className="mt-4">
                <div className="text-xs text-slate-400">Mode</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LASER_MODES.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => sendLaserMode(mode)}
                      className={`rounded-2xl border px-4 py-2 text-sm shadow-sm ${
                        laserMode === mode
                          ? "border-amber-400/50 bg-amber-500/10 text-amber-200"
                          : "border-slate-700 bg-slate-800 text-slate-100"
                      }`}
                    >
                      {mode === "on" ? "On" : mode === "blink" ? "Blink" : "Off"}
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-400">Current: {laserMode} · last seen {laserLastSeen}</div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-sm font-medium text-slate-200">Sync Status</div>
              <div className="mt-2 text-sm text-slate-300">Current: {gripperAngle}°</div>
              <div className="mt-1 text-sm text-slate-300">Target: {gripperTarget}°</div>
              <div className="mt-1 text-xs text-slate-400">{gripperMoving ? "Moving" : "Idle"} · last seen {gripperLastSeen}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => queueGripper(gripperTarget)}
                  className="rounded-2xl border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-100 shadow-sm"
                >
                  Queue For Sync
                </button>
                <button
                  onClick={() => setIncludeGripperSync(true)}
                  className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-sm"
                >
                  Enable Sync
                </button>
                <button
                  onClick={() => setIncludeLaserSync(true)}
                  className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 shadow-sm"
                >
                  Laser Sync On
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <SlidersHorizontal className="h-5 w-5 text-sky-500" />
                Global Tools
              </div>
              <div className="mt-1 text-sm text-slate-500">Delay, mirror, logs, reset, and project actions.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setLiveHelp((v) => !v)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm">
                {liveHelp ? "Hide Tips" : "Show Tips"}
              </button>
              <button onClick={exportScripts} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm">
                <Download className="mr-2 inline-block h-4 w-4" />Export
              </button>
              <button onClick={() => setGlobalLineDelay(0)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm">
                Reset Delay
              </button>
              <button onClick={() => patchBot(0, { script: DEFAULT_SCRIPT, lastAction: "reset" })} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm">
                Reset A
              </button>
              <button onClick={() => patchBot(1, { script: DEFAULT_SCRIPT, lastAction: "reset" })} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm">
                Reset B
              </button>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Execution Rules</div>
                <div className="text-xs text-slate-500">rows · commas · reverse</div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {[
                  "Each row runs one after another",
                  "Commas inside a row run together",
                  "Reverse = bottom to top only",
                  `Default delay = ${DEFAULT_LINE_DELAY}ms`,
                ].map((t) => (
                  <div key={t} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm">
                    {t}
                  </div>
                ))}
              </div>

              {liveHelp && (
                <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm text-sky-800">
                  <div className="mb-1 font-semibold">Quick examples</div>
                  <div className="font-mono leading-7">
                    1s80<br />
                    2s30,4s40<br />
                    wait2000<br />
                    home<br />
                    homebody<br />
                    homelock<br />
                    g60<br />
                    lazon
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-[26px] border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Global Log</div>
              <button onClick={() => setGlobalLog([])} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
                Clear Log
              </button>
            </div>
            <div className="max-h-[190px] space-y-2 overflow-y-auto pr-1">
              {globalLog.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-3 text-sm text-slate-500">No events yet.</div>
              ) : (
                globalLog.map((item, i) => (
                  <div key={`${item.time}-${i}`} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
                    <div className="text-xs text-slate-400">{item.time}</div>
                    <div className="text-slate-700">{item.msg}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">Lock Moves</div>
              <div className="text-sm text-slate-500">Preset moves between cardboard locks.</div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-sm font-semibold text-slate-100">Bot 1 (Lock {botLocks[0]})</div>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                <span>Set lock:</span>
                <select
                  value={botLocks[0]}
                  onChange={(e) => setBotLock(0, Number(e.target.value))}
                  className="rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                >
                  {[1, 2, 3, 4].map((lock) => (
                    <option key={lock} value={lock}>Lock {lock}</option>
                  ))}
                </select>
              </div>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={() => triggerAction("lock-moves", () => moveBot(0, 1, 2, BOT1_LOCK_1_TO_2))}
                  className="rounded-3xl border border-slate-700 bg-slate-800 px-5 py-4 text-base font-semibold text-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/50 hover:shadow-lg active:scale-[0.99]"
                >
                  Move Bot 1: Lock 1 → Lock 2
                </button>
                <button
                  onClick={() => triggerAction("lock-moves", () => moveBot(0, 2, 1, BOT1_LOCK_2_TO_1))}
                  className="rounded-3xl border border-slate-700 bg-slate-800 px-5 py-4 text-base font-semibold text-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/50 hover:shadow-lg active:scale-[0.99]"
                >
                  Move Bot 1: Lock 2 → Lock 1
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-sm font-semibold text-slate-100">Bot 2 (Lock {botLocks[1]})</div>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                <span>Set lock:</span>
                <select
                  value={botLocks[1]}
                  onChange={(e) => setBotLock(1, Number(e.target.value))}
                  className="rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                >
                  {[1, 2, 3, 4].map((lock) => (
                    <option key={lock} value={lock}>Lock {lock}</option>
                  ))}
                </select>
              </div>
              <div className="mt-4 grid gap-3">
                <button
                  onClick={() => triggerAction("lock-moves", () => moveBot(1, 4, 3, BOT2_LOCK_4_TO_3))}
                  className="rounded-3xl border border-slate-700 bg-slate-800 px-5 py-4 text-base font-semibold text-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/50 hover:shadow-lg active:scale-[0.99]"
                >
                  Move Bot 2: Lock 4 → Lock 3
                </button>
                <button
                  onClick={() => triggerAction("lock-moves", () => moveBot(1, 3, 4, BOT2_LOCK_3_TO_4))}
                  className="rounded-3xl border border-slate-700 bg-slate-800 px-5 py-4 text-base font-semibold text-slate-100 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/50 hover:shadow-lg active:scale-[0.99]"
                >
                  Move Bot 2: Lock 3 → Lock 4
                </button>
              </div>
            </div>
          </div>
          {scopedErrors["lock-moves"] ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{scopedErrors["lock-moves"]}</div> : null}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold text-slate-900">Gripper Demo</div>
                <div className="text-sm text-slate-500">Requires Bot 1 at Lock 2 and gripper online.</div>
              </div>
            </div>
            <button
              onClick={() => triggerAction("gripper-demo", runGripperDemo)}
              className="w-full rounded-[26px] border border-emerald-300 bg-gradient-to-r from-emerald-100 to-lime-100 px-6 py-5 text-lg font-semibold text-emerald-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]"
            >
              Run Gripper Demo (Bot 1 + Gripper)
            </button>
            {scopedErrors["gripper-demo"] ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{scopedErrors["gripper-demo"]}</div> : null}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Laser Demo</div>
                <div className="text-sm text-slate-500">Assumes Bot 2 at Lock 4 and lazer online. Uses your exact script.</div>
              </div>
              <button
                onClick={() => setForceLaserDemoAssumptions((v) => !v)}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${forceLaserDemoAssumptions ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-600"}`}
              >
                {forceLaserDemoAssumptions ? "Force assumptions on" : "Force assumptions off"}
              </button>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs text-slate-300">
                Bot 2 must be on Lock 4. Laser commands used: lazon, lazblink, lazoff.
              </div>
              <button
                onClick={() => triggerAction("laser-demo", runLaserDemo)}
                className="mt-4 w-full rounded-[26px] border border-amber-400 bg-gradient-to-r from-amber-200 to-orange-200 px-6 py-5 text-lg font-semibold text-amber-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]"
              >
                Run Laser Demo (Bot 2 + Lazer)
              </button>
              <div className="mt-3 text-xs text-slate-400">
                {forceLaserDemoAssumptions
                  ? "Force mode will set Bot 2 lock to 4 in the UI and bypass stale online assumptions for this run."
                  : "Strict mode will stop if Bot 2 is not at Lock 4 or lazer is offline."}
              </div>
              {scopedErrors["laser-demo"] ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{scopedErrors["laser-demo"]}</div> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-slate-900">Important Dual Demo</div>
              <div className="text-sm text-slate-500">Bot 1 at Lock 2 and Bot 2 at Lock 4. Both scripts start together.</div>
            </div>
            <button
              onClick={() => setForceImportantDemoAssumptions((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${forceImportantDemoAssumptions ? "border-sky-200 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {forceImportantDemoAssumptions ? "Force assumptions on" : "Force assumptions off"}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs text-slate-300">Bot 1 script</div>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
                {IMPORTANT_BOT1_SCRIPT}
              </div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="text-xs text-slate-300">Bot 2 script</div>
              <div className="mt-2 max-h-40 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
                {IMPORTANT_BOT2_SCRIPT}
              </div>
            </div>
          </div>
          <button
            onClick={() => triggerAction("important-dual", runImportantDualDemo)}
            className="mt-4 w-full rounded-[26px] border border-sky-400 bg-gradient-to-r from-sky-200 to-cyan-200 px-6 py-5 text-lg font-semibold tracking-wide text-sky-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]"
          >
            Run Important Dual Demo
          </button>
          <div className="mt-3 text-xs text-slate-400">
            {forceImportantDemoAssumptions
              ? "Force mode sets the lock assumptions in the UI and uses the shared sync start path so both scripts begin together."
              : "Strict mode requires the displayed lock states before running."}
          </div>
          {scopedErrors["important-dual"] ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{scopedErrors["important-dual"]}</div> : null}
        </div>
      </div>
    </div>
  );
}
