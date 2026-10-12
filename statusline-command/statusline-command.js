#!/usr/bin/env node

const { execSync } = require("child_process");

const CYAN = "\x1b[36m",
  GREEN = "\x1b[32m",
  YELLOW = "\x1b[33m",
  RED = "\x1b[31m",
  MAGENTA = "\x1b[35m",
  GREY = "\x1b[90m",
  BOLD = "\x1b[1m",
  RESET = "\x1b[0m";

const MIN = 60000;
const SPAN = { five_hour: 5 * 60 * MIN, seven_day: 7 * 24 * 60 * MIN };
const PIE = "○◔◑◕●";
const GAUGE = 5;

const clamp = (n) => Math.min(100, Math.max(0, n));

// 3h02, 42 min, 2d23h.
function duration(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0
    ? `${d}d${String(h).padStart(2, "0")}h`
    : `${h}h${String(m % 60).padStart(2, "0")}`;
}

function clock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Solid: the share used, up to where the clock stands. Dashed: the gap between usage and time
// elapsed, grey while usage trails the clock, in the level color once it runs ahead.
function gauge(used, elapsed, color) {
  const u = Math.round((clamp(used) / 100) * GAUGE);
  const t = elapsed === null ? u : Math.round((elapsed / 100) * GAUGE);
  const solid = Math.min(u, t);
  const dashed = Math.abs(t - u);
  const rest = GAUGE - Math.max(u, t);
  return `${color}${"━".repeat(solid)}${u > t ? color : GREY}${"╍".repeat(dashed)}${GREY}${"━".repeat(rest)}${RESET}`;
}

// ϟ cache 91% 54 min: amber under 10 min, red once expired. Absent before the first reply.
function cachePart(c, now) {
  if (!c) return "";
  const left = (c.expires_at || 0) * 1000 - now;
  if (!c.warm || left <= 0) return `${RED}ϟ cache ${BOLD}expired${RESET}`;
  const hit = Math.round((c.hit_ratio || 0) * 100);
  const time = left < MIN ? "< 1 min" : duration(left);
  return `${CYAN}ϟ${RESET} cache ${BOLD}${hit}%${RESET} ${left < 10 * MIN ? YELLOW : GREY}${time}${RESET}`;
}

// ◑ 5h ━━━╍━ 80% ↻ 2h00 → 14:00. Absent without a Pro/Max plan.
function limitPart(kind, l, now) {
  if (!l) return "";
  const resetMs = l.resets_at ? l.resets_at * 1000 : null;
  if (resetMs !== null && resetMs <= now) return ""; // reset already: no valid reading
  const used = Math.max(0, l.used_percentage || 0);
  const left = resetMs === null ? null : resetMs - now;
  const elapsed =
    left === null ? null : clamp(((SPAN[kind] - left) / SPAN[kind]) * 100);
  const pace = elapsed === null ? 0 : used - elapsed;
  const hot = used >= 90 || pace > 15;
  const level = hot ? RED : used >= 75 || pace > 5 ? YELLOW : GREEN;
  const five = kind === "five_hour";
  const icon = five
    ? `${GREEN}${PIE[Math.round(clamp(used) / 25)]}`
    : `${MAGENTA}▦`;
  const when =
    left === null
      ? ""
      : five
        ? `${duration(left)} → ${clock(resetMs)}`
        : duration(left);
  return (
    `${icon}${RESET} ${five ? "5h" : "7d"} ${gauge(used, elapsed, level)} ` +
    `${BOLD}${hot ? level : ""}${Math.round(used)}%${RESET}` +
    (when ? ` ${GREY}↻ ${when}${RESET}` : "")
  );
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const data = JSON.parse(input);
  const model = data.model.display_name;
  const cost = data.cost?.total_cost_usd || 0;
  const pct = Math.floor(data.context_window?.used_percentage || 0);
  const durationMs = data.cost?.total_duration_ms || 0;
  const usage = data.context_window?.current_usage || {};
  const tokens =
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  const tokenStr =
    tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;

  const barColor = pct >= 90 ? RED : pct >= 70 ? YELLOW : GREEN;
  const filled = Math.floor(pct / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);

  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);

  let branch = "";
  try {
    branch = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    branch = branch ? `🌿 ${branch}` : "";
  } catch {}

  const now = Date.now();
  const cacheInfo = cachePart(data.prompt_cache, now);
  console.log(branch);
  console.log(
    [
      `${tokenStr} ${barColor}${bar}${RESET} ${pct}%`,
      cacheInfo ? `${cacheInfo}` : "",
      cost > 0
        ? `${YELLOW}$${cost.toFixed(2)}${RESET} | ⏱️ ${mins}m ${secs}s`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
  console.log(
    [
      limitPart("five_hour", data.rate_limits?.five_hour, now),
      limitPart("seven_day", data.rate_limits?.seven_day, now),
    ]
      .filter(Boolean)
      .join(" | "),
  );
});
