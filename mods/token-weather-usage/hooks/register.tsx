import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Limit, View } from '../types'

// Two rows of colored pills above the prompt: context tokens with weather, prompt cache time left,
// session cost and running subagents; under them, the 5h/7d limits against the time elapsed.
// Reads $.session / $.agent / $.clock and four caching env vars; no network, files or processes.
// ponytail: plain Unicode glyphs only (no Nerd Font, no emoji) so cell widths hold in any terminal.

const MIN = 60_000
const HOUR = 60 * MIN
const SPAN: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }
const ORDER = ['five_hour', 'seven_day', 'spend_limit']
const BARS = '▁▂▃▄▅▆▇█'
const PIE = '○◔◑◕●'
const SPARK = 6
const GAUGE = 5
const HISTORY = 12
const COMPACT_AT = 100_000
const CACHE_SOON = 10 * MIN

// Pill accents; neutral parts use theme keys (subtle, inactive) to follow light and dark.
const HUE: Record<string, string> = {
  five_hour: '#3fb97f',
  seven_day: '#a07cf0',
  spend_limit: '#e0b040',
  cache: '#4fb3e8',
  cost: '#e0b040',
  agents: '#ec6fa7',
  ok: '#3fb97f',
  warn: '#f0a030',
  hot: '#ef5350',
}

const WEATHER = [
  { upTo: 25, icon: '☀', color: '#f5c000' },
  { upTo: 50, icon: '☁', color: '#94a3b8' },
  { upTo: 75, icon: '☂', color: '#4c7cf0' },
  { upTo: Infinity, icon: '↯', color: '#a855f7' },
]

type UI = Pick<Elements['terminal'], 'Box' | 'Text'>
type Data = Omit<View, 'now'>

const view = atom({ plugin: 'token-weather-usage', key: 'view' } as const, null)

const blank = (): Data => ({
  tokens: [],
  window: 0,
  limits: [],
  cache: null,
  cacheOff: false,
  cacheTtl: '',
  cost: null,
  lastPrompt: null,
  agents: 0,
})

// ponytail: module variables, rebuilt from $.session.usage() on start; the band reads the snapshot in $.state.
let s = blank()
let promptBase: number | null = null

export const register: Register = on => {
  let ticker: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    ticker?.cancel()
    s = { ...blank(), window: s.window }
    const flag = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? '').trim())
    s.cacheOff = flag(await $.env.get('DISABLE_PROMPT_CACHING'))
    s.cacheTtl = flag(await $.env.get('FORCE_PROMPT_CACHING_5M'))
      ? '5m'
      : (await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')) ||
        (flag(await $.env.get('ENABLE_PROMPT_CACHING_1H')) ? '1h' : '')
    apply(await $.session.usage())
    promptBase = s.cost
    await refreshAgents($)
    // Elapsed time, the cache countdown and agents change between turns: redraw every 15 s.
    ticker = $.clock.every(15_000, async () => {
      await refreshAgents($)
      await show($)
    })
    await show($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // /clear, /resume and disconnect keep the ticker.
    if (e.reason === 'prompt_input_exit' || e.reason === 'other') ticker?.cancel()
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    apply(e)
    await show($)
    return next(e)
  })

  // Main-loop requests only: how much of the prompt the cache served.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const at = await $.clock.now()
    const result = yield* next(e)
    if (result?.usage) {
      s.cache = {
        at,
        read: result.usage.cache_read_input_tokens ?? 0,
        write: result.usage.cache_creation_input_tokens ?? 0,
        fresh: result.usage.input_tokens ?? 0,
      }
      await refreshAgents($)
      await show($)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId) {
        await refreshAgents($)
      } else {
        apply(await $.session.usage())
        if (s.cost !== null && promptBase !== null && s.cost >= promptBase) s.lastPrompt = s.cost - promptBase
        promptBase = s.cost
      }
      await show($)
    } catch {
      // No reading this turn: the band keeps the previous one.
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || !v || (v.tokens.length === 0 && v.limits.length === 0)) return next(e)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    return (
      <Box width={e.props.bodyColumns} flexDirection="column" rowGap={1} marginTop={1}>
        {rows(ui, v)}
      </Box>
    )
  })
}

const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length)

function apply(u: { context: { tokens?: number; window: number }; rateLimits: Limit[]; cost?: { usd: number } }) {
  const t = u.context.tokens ?? 0
  let tokens = s.tokens.filter(n => n > 0)
  // A reopened session reads the same context again: no duplicate reading, no false empty bar.
  if (u.context.window && !(t > 0 && tokens[tokens.length - 1] === t)) tokens.push(t)
  s.tokens = tokens.slice(-HISTORY)
  s.window = u.context.window || s.window
  if (u.rateLimits.length > 0) s.limits = [...u.rateLimits].sort((a, b) => rank(a.kind) - rank(b.kind))
  if (u.cost) s.cost = u.cost.usd
}

async function refreshAgents($: EngineInterface) {
  try {
    s.agents = ((await $.agent.list()) ?? []).filter(a => a.status === 'running').length
  } catch {
    // Keep the previous count.
  }
}

async function show($: EngineInterface) {
  const now = await $.clock.now()
  await update($, view, () => ({ ...s, tokens: [...s.tokens], limits: [...s.limits], now }))
}

function rows(ui: UI, v: View) {
  const session: RenderChildren[] = []
  if (v.tokens.length > 0) session.push(contextPill(ui, v))
  session.push(cachePill(ui, v))
  if (v.cost !== null && v.cost >= 0.005) session.push(costPill(ui, v))
  if (v.agents > 0) session.push(agentsPill(ui, v.agents))
  const limits: RenderChildren[] = []
  for (const l of v.limits) {
    if (Date.parse(l.resetsAt ?? '') <= v.now) continue // reset already: no valid reading
    limits.push(limitPill(ui, l, v.now))
  }
  return [row(ui, 'session', session), row(ui, 'limits', limits)]
}

// One left-aligned row, a grey " | " between pills; an empty row draws nothing.
function row({ Box, Text }: UI, key: string, items: RenderChildren[]) {
  const shown = items.filter(Boolean)
  if (shown.length === 0) return null
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap">
      {shown.flatMap((p, i) => (i > 0 ? [<Text key={`${key}-sep-${i}`} color="inactive"> | </Text>, p] : [p]))}
    </Box>
  )
}

// ponytail: no border, so a pill is one row instead of three; the separators in row() mark where each ends.
function pill({ Box, Text }: UI, key: string, ...parts: RenderChildren[]) {
  return (
    <Box key={key} flexShrink={0}>
      <Text wrap="truncate">{parts}</Text>
    </Box>
  )
}

// ☀ 48k ▂▅▁▃▇ ▲ +5.3k: weather by share of the window, a bar per turn's growth, the last step.
function contextPill(ui: UI, v: View) {
  const { Text } = ui
  const cur = v.tokens[v.tokens.length - 1] ?? 0
  const pct = v.window > 0 ? (cur / v.window) * 100 : 0
  const w = WEATHER.find(b => pct < b.upTo) ?? WEATHER[WEATHER.length - 1]!
  const deltas = v.tokens.slice(1).map((n, i) => Math.max(0, n - (v.tokens[i] ?? 0))).slice(-SPARK)
  const top = Math.max(...deltas, 1)
  const bars = deltas.map(d => BARS[Math.round((d / top) * (BARS.length - 1))]).join('')
  const diff = v.tokens.length >= 2 ? cur - (v.tokens[v.tokens.length - 2] ?? 0) : 0
  return pill(
    ui,
    'context',
    <Text color={w.color}>{w.icon}</Text>,
    ' ',
    <Text bold>{short(cur)}</Text>,
    bars ? [' ', <Text color="inactive">{bars.slice(0, -1)}</Text>, <Text color={w.color}>{bars.slice(-1)}</Text>] : null,
    diff !== 0 ? <Text dimColor>{` ${diff > 0 ? '▲ +' : '▼ −'}${short(Math.abs(diff))}`}</Text> : null,
  )
}

// ◔ 5h ━╍━━━ 22% ↻ 3h00 → 20:40
function limitPill(ui: UI, l: Limit, now: number) {
  const { Text } = ui
  const used = Math.max(0, l.percentUsed)
  const resetMs = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  const span = SPAN[l.kind]
  const left = Number.isFinite(resetMs) ? Math.max(0, resetMs - now) : null
  const elapsed = span && left !== null ? clamp(((span - left) / span) * 100) : null
  const pace = elapsed === null ? 0 : used - elapsed
  const hot = used >= 90 || pace > 15
  const level = hot ? HUE.hot! : used >= 75 || pace > 5 ? HUE.warn! : HUE.ok!
  const hue = HUE[l.kind] ?? HUE.spend_limit!
  const icon = l.kind === 'five_hour' ? PIE[Math.round(clamp(used) / 25)] : l.kind === 'seven_day' ? '▦' : '¤'
  const when = left === null ? '' : l.kind === 'five_hour' ? `${duration(left)} → ${clock(resetMs)}` : duration(left)
  return pill(
    ui,
    l.kind,
    <Text color={hue}>{icon}</Text>,
    ` ${LABEL[l.kind] ?? l.kind} `,
    gauge(ui, used, elapsed, level),
    ' ',
    <Text bold color={hot ? level : undefined}>{`${Math.round(used)}%`}</Text>,
    when ? [' ', <Text dimColor>{`↻ ${when}`}</Text>] : null,
  )
}

// Solid: the share used, up to where the clock stands. Dashed: the gap between usage and time
// elapsed, grey while usage trails the clock, in the warning color once it runs ahead.
function gauge({ Text }: UI, used: number, elapsed: number | null, color: string) {
  const u = Math.round((clamp(used) / 100) * GAUGE)
  const t = elapsed === null ? u : Math.round((elapsed / 100) * GAUGE)
  const solid = Math.min(u, t)
  const dashed = Math.abs(t - u)
  const rest = GAUGE - Math.max(u, t)
  return [
    solid > 0 ? <Text color={color}>{'━'.repeat(solid)}</Text> : null,
    dashed > 0 ? <Text color={u > t ? color : 'inactive'}>{'╍'.repeat(dashed)}</Text> : null,
    rest > 0 ? <Text color="subtle">{'━'.repeat(rest)}</Text> : null,
  ]
}

// Lifetime is inferred, as the host gives token counts not the TTL: env override, then plan.
function cacheTtl(v: View) {
  if (v.cacheTtl === '5m') return 5 * MIN
  if (v.cacheTtl === '1h') return HOUR
  // A subscription within its plan gets 1 hour; usage credits or an API key, 5 minutes.
  const plan = v.limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  return plan.length > 0 && plan.every(l => l.percentUsed < 100) ? HOUR : 5 * MIN
}

// ϟ cache 98% 54 min, amber under 10 min, red once expired.
function cachePill(ui: UI, v: View) {
  if (v.cacheOff) return null
  const { Text } = ui
  const head = (hue: string) => [<Text color={hue}>ϟ</Text>, ' cache ']
  if (!v.cache) return pill(ui, 'cache', head(HUE.cache!), <Text dimColor>—</Text>)
  const total = v.cache.read + v.cache.write + v.cache.fresh
  const hit = total > 0 ? Math.round((v.cache.read / total) * 100) : 0
  const left = v.cache.at + cacheTtl(v) - v.now
  if (left <= 0) {
    const big = (v.tokens[v.tokens.length - 1] ?? total) >= COMPACT_AT
    return pill(
      ui,
      'cache',
      head(HUE.hot!),
      <Text bold color={HUE.hot}>expired</Text>,
      big ? [' ', <Text dimColor>/compact</Text>] : null,
    )
  }
  if (hit < 50 && v.cache.write > 1_000) {
    return pill(ui, 'cache', head(HUE.warn!), <Text bold>{`${hit}%`}</Text>, ' ', <Text color={HUE.warn}>missed</Text>)
  }
  const soon = left < CACHE_SOON
  const hue = soon ? HUE.warn! : HUE.cache!
  const time = left < MIN ? '< 1 min' : duration(left)
  return pill(
    ui,
    'cache',
    head(hue),
    <Text bold>{`${hit}%`}</Text>,
    ' ',
    soon ? <Text bold color={HUE.warn}>{time}</Text> : <Text dimColor>{time}</Text>,
  )
}

// ¤ ≈ $18.42 ❯ +$2.31: the session so far, then what the last prompt added.
function costPill(ui: UI, v: View) {
  const { Text } = ui
  const last = v.lastPrompt
  return pill(
    ui,
    'cost',
    <Text color={HUE.cost}>¤</Text>,
    ' ≈ ',
    <Text bold>{`$${(v.cost ?? 0).toFixed(2)}`}</Text>,
    last !== null && last >= 0.005 ? [' ', <Text dimColor>{`❯ +$${last.toFixed(2)}`}</Text>] : null,
  )
}

function agentsPill(ui: UI, n: number) {
  const { Text } = ui
  return pill(ui, 'agents', <Text color={HUE.agents}>✻</Text>, ' ', <Text bold>{String(n)}</Text>, n === 1 ? ' agent' : ' agents')
}

// 3h02, 42 min, 2d23h.
function duration(ms: number) {
  const m = Math.round(ms / MIN)
  if (m < 60) return `${m} min`
  const d = Math.floor(m / 1440)
  const hours = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${String(hours).padStart(2, '0')}h` : `${hours}h${String(m % 60).padStart(2, '0')}`
}

function clock(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const clamp = (n: number) => Math.min(100, Math.max(0, n))

// 1M, 1.2M, 107k, 98.3k, 950: one decimal only when it matters.
function short(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}
