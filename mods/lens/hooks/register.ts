import type { EngineInterface, FsEntry, Register, ToolCallResult } from 'claude-code'
import { type Diag, type Tool, TOOLS, TS, bySeverity, customTool, idOf, keyOf, lineOf, parse, resolvePath, scanSecrets, tally, tscLine } from './lens'

type Plan = { tool: Tool; bin: string; cwd: string; scope: string }
type Config = { disable: string[]; runners: Tool[] }
type Watch = {
  tsconfig: string
  dir: string
  state: 'starting' | 'ready' | 'stopped'
  started: number // compile cycles begun
  finished: number // compile cycles done
  cycleAt: number
  lastMs: number
  pending: Diag[]
  wake: (() => void)[]
  late: Set<string> // files whose edit report went out before this watcher's verdict
  idle?: { cancel: () => void }
  stop: () => void
}

const NAME = 'lens'
const IDLE_MS = 10 * 60_000 // a tsc watcher with no TypeScript edit for this long is stopped
const NOTICE_MS = 1_500 // how long tsc gets to notice an edit (its file watcher debounces ~250 ms)
const RESERVE_MS = 1_500 // kept back from the hook's 10 s budget
const RUN_TIMEOUT_MS = 120_000
const SHOW = 20
const CASCADE = 10
const LISTED = 60
const LEDGER = 30
const ENV = { NO_COLOR: '1', FORCE_COLOR: '0' }
const GIT_WRITE = /\bgit\s+(?:-C\s+\S+\s+|-\S+\s+)*(?:commit|push)\b/

// Session state. A scope is one run's coverage (`eslint:/a.ts`, `go-vet:/pkg`, `tsc:/tsconfig.json`) and holds
// its latest full set, LSP style; `baseline` is each scope's set before this turn first changed it.
let root = '/'
let falsePositives: Record<string, string> = {}
let recheck: 'queued' | 'running' | undefined // the guard's one follow-up turn
const known = new Map<string, Diag[]>()
const baseline = new Map<string, Set<string>>()
const checkedAt = new Map<string, number>() // file -> mtime its diagnostics were taken at
const turnFiles = new Set<string>()
const sessionFiles = new Set<string>()
const deferred = new Set<string>()
const watches = new Map<string, Watch>()
const late: string[] = []
const stats = new Map<string, { runs: number; fails: number; ms: number }>()
const missing = new Set<string>()
const ledger: string[] = []
// Lookups, dropped when a person's prompt opens a turn so tools installed meanwhile are found.
const listings = new Map<string, Promise<Set<string>>>()
const texts = new Map<string, Promise<string>>()
const bins = new Map<string, Promise<string | null>>()

const dirname = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'
const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)
const rel = (p: string) => (p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p)
const firstLine = (s: string) => s.trim().split('\n')[0]!.slice(0, 200)
const muted = (d: Diag) => deferred.has(keyOf(d)) || keyOf(d) in falsePositives

// Keeps `text` for /lens-health and answers the debug log's line for it.
function note(text: string) {
  ledger.push(`${new Date().toTimeString().slice(0, 8)} ${text}`)
  if (ledger.length > LEDGER) ledger.shift()
  return `${NAME}: ${text}`
}

function cached<T>(map: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let hit = map.get(key)
  if (!hit) map.set(key, (hit = make()))
  return hit
}
function names(dir: string, list: (dir: string) => Promise<FsEntry[]>) {
  return cached(listings, dir, () => list(dir).then(entries => new Set(entries.map(e => e.name)), () => new Set<string>()))
}
function textOf($: EngineInterface, path: string) {
  return cached(texts, path, () => $.fs.read(path).catch(() => ''))
}

/** The nearest folder from `dir` up that holds one of `files` (`name#text`: one holding `text`). */
async function findUp($: EngineInterface, dir: string, files: readonly string[]): Promise<string | undefined> {
  for (let d = dir; ; d = dirname(d)) {
    const here = await names(d, p => $.fs.list(p))
    for (const f of files) {
      const [name, text] = f.split('#') as [string, string?]
      if (here.has(name) && (!text || (await textOf($, join(d, name))).includes(text))) return d
    }
    if (d === '/') return
  }
}

/** Where `bin` lives for a file in `dir`: a project-local install first, then PATH unless `local`. */
function resolveBin($: EngineInterface, bin: string, dir: string, local?: true): Promise<string | null> {
  return cached(bins, `${bin}\0${dir}\0${local ?? ''}`, async () => {
    if (bin.includes('/')) return resolvePath(root, bin)
    for (let d = dir; ; d = dirname(d)) {
      for (const sub of ['node_modules/.bin', '.venv/bin', 'venv/bin'])
        if ((await names(join(d, sub), p => $.fs.list(p))).has(bin)) return join(d, `${sub}/${bin}`)
      if (d === '/') break
    }
    if (local) return null
    const found = await $.process.run(['which', bin]).catch(() => undefined)
    return found?.exitCode === 0 ? found.stdout.trim() || null : null
  })
}

/** `.lens.json` at the project root: runners to `disable`, and `runners` of the project's own. */
async function config($: EngineInterface): Promise<Config> {
  const text = await $.fs.read(join(root, '.lens.json')).catch(() => undefined)
  if (text === undefined) return { disable: [], runners: [] }
  try {
    const raw = JSON.parse(text) as { disable?: unknown; runners?: unknown }
    return {
      disable: Array.isArray(raw.disable) ? raw.disable.filter((s): s is string => typeof s === 'string') : [],
      runners: Array.isArray(raw.runners) ? raw.runners.map(customTool) : [],
    }
  } catch (err) {
    $.ui.log(note(`.lens.json ignored: ${(err as Error).message}`), { to: 'debug' })
    return { disable: [], runners: [] }
  }
}

/** The tools that apply to `file`, installed and gated: its checkers, or with `fixers` its fixers. */
async function plan($: EngineInterface, file: string, fixers: boolean, cfg: Config): Promise<Plan[]> {
  const dir = dirname(file)
  const plans: Plan[] = []
  for (const tool of [...cfg.runners, ...TOOLS]) {
    if (!tool.format !== fixers || !tool.match.test(file) || cfg.disable.includes(tool.id)) continue
    const gate = tool.gate && (await findUp($, dir, tool.gate))
    if (tool.gate && !gate) continue
    const bin = await resolveBin($, tool.bin, dir, tool.local)
    if (!bin) {
      if (!tool.local) missing.add(tool.bin)
      continue
    }
    const cwd = tool.cwd === 'gate' && gate ? gate : tool.cwd === 'dir' ? dir : root
    plans.push({ tool, bin, cwd, scope: `${tool.id}:${tool.wide ? cwd : file}` })
  }
  return plans
}

/** Replaces a scope's diagnostics. `before`: they are the picture ahead of this turn's edit. */
function record(scope: string, diags: Diag[], before = false) {
  const prev = known.get(scope)
  if (before) baseline.set(scope, new Set(diags.map(keyOf)))
  else if (prev && !baseline.has(scope)) baseline.set(scope, new Set(prev.map(keyOf)))
  known.set(scope, diags)
}

/** Whether this turn introduced `d`: not in its scope's baseline or, with none, in a file the turn edited. */
function isNew(d: Diag, scope: string) {
  const before = baseline.get(scope)
  return before ? !before.has(keyOf(d)) : turnFiles.has(d.file)
}

function* live() {
  for (const [scope, diags] of known) for (const d of diags) if (!muted(d)) yield { d, scope }
}

async function runCheck($: EngineInterface, p: Plan, file: string, before = false): Promise<boolean> {
  const s = stats.get(p.tool.id) ?? { runs: 0, fails: 0, ms: 0 }
  stats.set(p.tool.id, s)
  s.runs++
  const t0 = Date.now()
  try {
    const r = await $.process.run([p.bin, ...p.tool.argv([file])], { cwd: p.cwd, env: ENV, timeoutMs: RUN_TIMEOUT_MS })
    const out = p.tool.format === 'eslint' ? r.stdout : `${r.stdout}\n${r.stderr}`
    const diags = (() => {
      try {
        return parse(p.tool.format!, out, p.cwd, p.tool.id, p.tool.severity)
      } catch {
        return undefined
      }
    })()
    if (!diags || (!diags.length && r.exitCode > 1)) throw new Error(`exit ${r.exitCode}: ${firstLine(r.stderr || r.stdout) || 'no output'}`)
    // A one-file tool speaks of that file, however it spells the path.
    record(p.scope, p.tool.wide ? diags : diags.map(d => ({ ...d, file })), before)
    return true
  } catch (err) {
    s.fails++
    $.ui.log(note(`${p.tool.id} on ${rel(file)} failed: ${(err as Error).message}`), { to: 'debug' })
    return false
  } finally {
    s.ms += Date.now() - t0
  }
}

async function scanFile($: EngineInterface, file: string, before = false) {
  if (/(?:^|\/)\.env(?:\.|$)/.test(file)) return
  const text = await $.fs.read(file).catch(() => undefined) // over 4 MiB: not scanned
  if (text !== undefined) record(`secrets:${file}`, scanSecrets(text, file), before)
}

/** Takes the "before" picture of an existing file this turn has not edited yet: reused when nothing moved since. */
async function beforeEdit($: EngineInterface, file: string, checks: Plan[]) {
  const stat = await $.fs.stat(file).catch(() => undefined)
  if (!stat) return // a new file has no before
  const isUnchanged = checkedAt.get(file) === stat.mtimeMs
  await Promise.all([
    ...checks
      .filter(p => !baseline.has(p.scope))
      .map(p =>
        isUnchanged && !p.tool.wide && known.has(p.scope)
          ? baseline.set(p.scope, new Set(known.get(p.scope)!.map(keyOf)))
          : runCheck($, p, file, true)),
    baseline.has(`secrets:${file}`) ? undefined : scanFile($, file, true),
  ])
}

function wakeAll(w: Watch) {
  for (const wake of w.wake.splice(0)) wake()
}

/** Resolves true once `done()` holds, false if `ms` pass first; asked again whenever the watcher moves. */
function until($: EngineInterface, w: Watch, done: () => boolean, ms: number): Promise<boolean> {
  if (done()) return Promise.resolve(true)
  if (ms <= 0) return Promise.resolve(false)
  return new Promise(resolve => {
    let isSettled = false
    const timer = $.clock.after(ms, () => {
      isSettled = true
      resolve(done())
    })
    const check = () => {
      if (isSettled) return
      if (!done()) return void w.wake.push(check)
      isSettled = true
      timer.cancel()
      resolve(true)
    }
    w.wake.push(check)
  })
}

function onTscLine($: EngineInterface, w: Watch, raw: string) {
  const line = raw.trimEnd()
  if (/Starting (?:incremental )?compilation/.test(line)) {
    w.started++
    w.cycleAt = Date.now()
    w.pending = []
  } else if (/Found \d+ errors?\. Watching for file changes/.test(line)) {
    w.finished = w.started
    w.lastMs = Date.now() - w.cycleAt
    w.state = 'ready'
    record(`tsc:${w.tsconfig}`, w.pending)
    for (const file of w.late) {
      const text = report(file, ['tsc'], [`tsc:${w.tsconfig}`], true)
      if (text) late.push(`${text.replace(`[${NAME}]`, `[${NAME}, tsc's late verdict]`)}`)
    }
    w.late.clear()
    status($)
  } else {
    const d = tscLine(line, w.dir)
    if (d) w.pending.push(d)
    else if (/^\s+\S/.test(line) && w.pending.length) w.pending.at(-1)!.message += `\n${line.trim()}`
    else if (/^\s*error TS\d+/.test(line)) $.ui.log(note(`tsc ${rel(w.tsconfig)}: ${firstLine(line)}`), { to: 'debug' })
    return
  }
  wakeAll(w)
}

/** The warm `tsc --watch` for `tsconfig`: started on first use, stopped after IDLE_MS without a TypeScript edit. */
function watch($: EngineInterface, tsconfig: string, bin: string): Watch {
  const running = watches.get(tsconfig)
  if (running && running.state !== 'stopped') return keepWarm($, running)
  const dir = dirname(tsconfig)
  const stream = $.process.spawn({ argv: [bin, '--noEmit', '--watch', '--preserveWatchOutput', '--pretty', 'false', '-p', tsconfig], cwd: dir, env: ENV })
  const w: Watch = { tsconfig, dir, state: 'starting', started: 0, finished: 0, cycleAt: 0, lastMs: 0, pending: [], wake: [], late: new Set(),
    stop: () => void stream.return({ code: null, signal: 'SIGTERM' }) }
  watches.set(tsconfig, w)
  void (async () => {
    let partial = ''
    try {
      for await (const { text } of stream) {
        const lines = (partial + text).split('\n')
        partial = lines.pop()!
        for (const line of lines) onTscLine($, w, line)
      }
    } catch (err) {
      $.ui.log(note(`tsc watcher for ${rel(tsconfig)} failed: ${(err as Error).message}`), { to: 'debug' })
    }
    if (w.state !== 'stopped') $.ui.log(note(`tsc watcher for ${rel(tsconfig)} exited`), { to: 'debug' })
    w.state = 'stopped'
    w.idle?.cancel()
    wakeAll(w)
  })()
  return keepWarm($, w)
}

function keepWarm($: EngineInterface, w: Watch): Watch {
  w.idle?.cancel()
  w.idle = $.clock.after(IDLE_MS, () => {
    $.ui.log(note(`tsc watcher for ${rel(w.tsconfig)} stopped after ${IDLE_MS / 60_000} idle minutes`), { to: 'debug' })
    w.state = 'stopped'
    w.stop()
  })
  return w
}

async function tscFor($: EngineInterface, file: string, cfg: Config): Promise<Watch | undefined> {
  if (!TS.test(file) || cfg.disable.includes('tsc')) return
  const dir = await findUp($, dirname(file), ['tsconfig.json'])
  if (!dir) return
  const bin = await resolveBin($, 'tsc', dir)
  if (!bin) return void missing.add('tsc')
  return watch($, join(dir, 'tsconfig.json'), bin)
}

/** Waits, inside `ms`, for tsc to finish checking an edit made after cycle `since` began. False: it is late. */
async function settled($: EngineInterface, w: Watch, since: number, ms: number): Promise<boolean> {
  // ponytail: a cold first compile is not waited on, its verdict rides a later tool result; a big repo can take a minute
  if (w.state !== 'ready') return w.state === 'stopped'
  const t0 = Date.now()
  if (!(await until($, w, () => w.started > since || w.state !== 'ready', Math.min(NOTICE_MS, ms)))) return true // tsc saw no change
  return until($, w, () => w.finished >= w.started || w.state === 'stopped', ms - (Date.now() - t0))
}

/** What the model reads after editing `file`: what the edit introduced there, and errors the turn caused elsewhere. */
function report(file: string, ran: string[], scopes: string[], isQuiet: boolean, isPending = false): string | undefined {
  if (!ran.length) return
  const mine: Diag[] = []
  const old: Diag[] = []
  const elsewhere: Diag[] = []
  for (const scope of scopes)
    for (const d of known.get(scope) ?? []) {
      if (muted(d)) continue
      if (d.file === file) (isNew(d, scope) ? mine : old).push(d)
      else if (d.severity === 'error' && isNew(d, scope)) elsewhere.push(d)
    }
  const head = `[${NAME}] ${rel(file)}`
  const wait = isPending ? 'tsc is still checking; its verdict comes with a later tool result.' : ''
  if (!mine.length && !elsewhere.length)
    return isQuiet ? undefined : [`${head}: no new issues (${ran.join(', ')})${old.length ? `; ${old.length} pre-existing` : ''}.`, wait].filter(Boolean).join(' ')
  const lines = [`${head}: ${mine.length ? tally(mine) : 'nothing new'} introduced in this file (${ran.join(', ')}).`]
  lines.push(...mine.sort(bySeverity).slice(0, SHOW).map(d => lineOf(d, rel)))
  if (mine.length > SHOW) lines.push(`  ...and ${mine.length - SHOW} more (lens_diagnostics lists them all)`)
  if (old.length) lines.push(`  (${old.length} pre-existing in this file, not shown)`)
  if (elsewhere.length) {
    lines.push('Errors this turn introduced in other files:', ...elsewhere.sort(bySeverity).slice(0, CASCADE).map(d => lineOf(d, rel)))
    if (elsewhere.length > CASCADE) lines.push(`  ...and ${elsewhere.length - CASCADE} more`)
  }
  if (wait) lines.push(wait)
  lines.push('Fix what this edit introduced before moving on. If a finding is wrong, call lens_diagnostic_mark with its #id.')
  return lines.join('\n')
}

/** Errors still standing: introduced this turn or, for `session`, in any file this session edited. */
function blockers(span: 'turn' | 'session'): Diag[] {
  const held: Diag[] = []
  for (const { d, scope } of live())
    if (d.severity === 'error' && (isNew(d, scope) || (span === 'session' && sessionFiles.has(d.file)))) held.push(d)
  return held.sort(bySeverity)
}

function status($: EngineInterface) {
  let errors = 0
  let warnings = 0
  for (const { d } of live()) {
    if (d.severity === 'error') errors++
    else if (d.severity === 'warning') warnings++
  }
  $.ui.status(errors || warnings ? `lens ✗${errors} ⚠${warnings}` : 'lens ✓')
}

/** `result` with lens notes after it, and any tsc verdict that arrived late. */
function withNotes<R extends ToolCallResult>(result: R, ...notes: (string | undefined)[]): R {
  if (result.deny) return result
  const add = [...late.splice(0), ...notes].filter((n): n is string => !!n)
  return add.length ? ({ ...result, context: [...(result.context ?? []), ...add] } as R) : result
}

/** Checks `file` now and lists everything in it, old and new. */
async function checkNow($: EngineInterface, file: string, ms: number): Promise<string> {
  if (!(await $.fs.exists(file))) return `${rel(file)} does not exist.`
  const cfg = await config($)
  const checks = await plan($, file, false, cfg)
  const w = await tscFor($, file, cfg)
  const [ran] = await Promise.all([
    Promise.all(checks.map(async p => ((await runCheck($, p, file)) ? p.tool.id : ''))),
    scanFile($, file),
    w && until($, w, () => w.state !== 'starting' && w.finished >= w.started, ms),
  ])
  const names = [...ran.filter(Boolean), ...(w ? ['tsc'] : [])]
  if (!names.length) return `No checker applies to ${rel(file)}; /lens-health lists tools that are not installed.`
  const diags = [...live()].filter(x => x.d.file === file).map(x => x.d).sort(bySeverity)
  return [`${rel(file)}: ${tally(diags)} (${names.join(', ')})`, ...diags.map(d => lineOf(d, rel))].join('\n')
}

function summary(): string {
  const all = [...live()].map(x => x.d).sort(bySeverity)
  const hidden = [...known.values()].flat().filter(muted).length
  const files = new Set(all.map(d => d.file)).size
  const lines = [`${tally(all)} across ${files} file${files === 1 ? '' : 's'}${hidden ? ` (${hidden} marked, hidden)` : ''}`]
  lines.push(...all.slice(0, LISTED).map(d => lineOf(d, rel)))
  if (all.length > LISTED) lines.push(`  ...and ${all.length - LISTED} more`)
  return lines.join('\n')
}

function health(): string {
  const lines = ["tsc watchers:"]
  if (!watches.size) lines.push('  none yet (no tsconfig.json at the root and no TypeScript edited)')
  for (const w of watches.values())
    lines.push(`  ${rel(w.tsconfig)}: ${w.state}, ${w.finished} checks, last took ${w.lastMs} ms, ${known.get(`tsc:${w.tsconfig}`)?.length ?? 0} diagnostics`)
  lines.push('runners:')
  if (!stats.size) lines.push('  none run yet')
  for (const [id, s] of stats) lines.push(`  ${id}: ${s.runs} runs, ${s.fails} failed, ${Math.round(s.ms / s.runs)} ms average`)
  if (missing.size) lines.push(`not installed, so their files go unchecked: ${[...missing].join(', ')}`)
  lines.push(`marks: ${Object.keys(falsePositives).length} false positives (this project), ${deferred.size} deferred (this session)`)
  lines.push('recent degradations:', ...(ledger.length ? ledger.map(l => `  ${l}`) : ['  none']))
  return lines.join('\n')
}

/** Runs the project's fixers, then its formatters, over the files the turn edited. */
async function tidy($: EngineInterface, files: string[]) {
  const cfg = await config($)
  const groups = new Map<string, { plan: Plan; files: string[] }>()
  const before = new Map<string, number>()
  for (const file of files) {
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (!stat) continue
    before.set(file, stat.mtimeMs)
    for (const p of await plan($, file, true, cfg)) {
      const key = `${p.tool.id}\0${p.cwd}`
      const group = groups.get(key)
      if (group) group.files.push(file)
      else groups.set(key, { plan: p, files: [file] })
    }
  }
  const rank = (p: Plan) => TOOLS.indexOf(p.tool)
  const used = new Set<string>()
  for (const { plan: p, files: batch } of [...groups.values()].sort((a, b) => rank(a.plan) - rank(b.plan))) {
    const r = await $.process
      .run([p.bin, ...p.tool.argv(batch)], { cwd: p.cwd, env: ENV, timeoutMs: RUN_TIMEOUT_MS })
      .catch((err: Error) => ({ exitCode: -1, stdout: '', stderr: err.message }))
    if (r.exitCode > 1 || r.exitCode < 0) $.ui.log(note(`${p.tool.id} failed: ${firstLine(r.stderr || r.stdout)}`), { to: 'debug' })
    else used.add(p.tool.id)
  }
  let changed = 0
  for (const [file, mtime] of before) if ((await $.fs.stat(file).catch(() => undefined))?.mtimeMs !== mtime) changed++
  if (changed) $.ui.toast(`${NAME} tidied ${changed} file${changed === 1 ? '' : 's'} (${[...used].join(', ')})`)
}

export const register: Register = (on, options) => {
  const isTidy = options.tidy !== false
  const isStopGuard = options.stopGuard !== false
  const isGitGuard = options.gitGuard === true

  // Every tool call: the git guard ahead of Bash, the check after Edit and Write, late tsc verdicts after any.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Bash' && isGitGuard && GIT_WRITE.test(e.command)) {
      const held = blockers('session')
      if (held.length)
        return {
          deny: [`${NAME} is holding this commit/push: files this session edited still have ${tally(held)}.`,
            ...held.slice(0, SHOW).map(d => lineOf(d, rel)),
            'Fix them first, or mark findings that should not block with lens_diagnostic_mark. The user can turn this guard off in /config.'].join('\n'),
        }
    }
    if (e.tool !== 'Edit' && e.tool !== 'Write') return withNotes(await next(e))

    const file = resolvePath(root, e.file_path)
    const cfg = await config($)
    const checks = await plan($, file, false, cfg)
    const w = await tscFor($, file, cfg)
    const since = w?.started ?? 0
    await beforeEdit($, file, checks)
    const result = await next(e)
    if (result.deny || result.isError) return withNotes(result)

    turnFiles.add(file)
    sessionFiles.add(file)
    listings.delete(dirname(file)) // it may be a config file a gate looks for
    texts.delete(file)
    const [ran, isFresh] = await Promise.all([
      Promise.all(checks.map(async p => ((await runCheck($, p, file)) ? p.tool.id : ''))),
      w ? settled($, w, since, Math.min(next.budget.remainingMs, 60_000) - RESERVE_MS) : true,
      scanFile($, file),
    ])
    if (w && !isFresh) w.late.add(file)
    const stat = await $.fs.stat(file).catch(() => undefined)
    if (stat) checkedAt.set(file, stat.mtimeMs)
    const scopes = [...checks.map(p => p.scope), `secrets:${file}`, ...(w ? [`tsc:${w.tsconfig}`] : [])]
    const hasSecrets = !!known.get(`secrets:${file}`)?.length
    const names = [...ran.filter(Boolean), ...(w ? ['tsc'] : []), ...(hasSecrets ? ['secrets'] : [])]
    status($)
    return withNotes(result, report(file, names, scopes, false, !!w && !isFresh))
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__lens__lens_diagnostics' }, async ($, e, next) => {
    const path = typeof e.path === 'string' && e.path ? resolvePath(root, e.path) : undefined
    return { result: path ? await checkNow($, path, Math.min(next.budget.remainingMs, 60_000) - RESERVE_MS) : summary() }
  })

  on('tool.call', { tool: 'mcp__lens__lens_diagnostic_mark' }, async ($, e) => {
    const id = String(e.id ?? '').replace(/^#/, '')
    const hit = [...live()].find(x => idOf(x.d) === id)?.d
    if (!hit) return { result: `No current finding has id #${id}; lens_diagnostics lists the live ones.` }
    const isFalsePositive = e.disposition === 'false-positive'
    if (isFalsePositive) {
      falsePositives[keyOf(hit)] = String(e.reason ?? '')
      await $.store.set(`fp:${root}`, falsePositives)
    } else deferred.add(keyOf(hit))
    status($)
    return {
      result: `Marked #${id} (${hit.source}${hit.rule ? ` ${hit.rule}` : ''} in ${rel(hit.file)}) as ` +
        (isFalsePositive ? 'a false positive for this project.' : 'deferred for this session.'),
    }
  })

  on('command.run', { command: 'lens' }, async ($, e) => {
    if (e.args.trim() !== 'clear-marks') return { text: summary() }
    falsePositives = {}
    deferred.clear()
    await $.store.delete(`fp:${root}`)
    status($)
    return { text: "marks cleared." }
  })

  on('command.run', { command: 'lens-health' }, () => ({ text: health() }))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    root = await $.session.root()
    falsePositives = ((await $.store.get(`fp:${root}`)) ?? {}) as Record<string, string>
    await Promise.all([
      $.tool.register({
        name: 'lens_diagnostics',
        description:
          'Diagnostics from lens: tsc and the linters the project uses (eslint, biome, ruff, pyright, go vet, clippy, ' +
          'shellcheck, ...). Your edits are checked automatically and the result follows each Edit/Write. With `path`, checks ' +
          'that file now and lists every finding in it, old and new. Without, lists everything this session holds.',
        inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'A file to check now, relative to the project root or absolute.' } } },
      }),
      $.tool.register({
        name: 'lens_diagnostic_mark',
        description:
          'Triage a lens finding by the #id its report shows. `false-positive`: the rule misfired here; hidden in this ' +
          'project from now on. `defer`: real, but out of scope now; hidden for this session. Prefer fixing; mark only what should ' +
          'not be fixed, and say why.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The id after # in the report, e.g. 3fa2c1.' },
            disposition: { type: 'string', enum: ['false-positive', 'defer'] },
            reason: { type: 'string', description: 'One sentence on why.' },
          },
          required: ['id', 'disposition', 'reason'],
        },
      }),
      $.command.register({ name: 'lens', description: 'Diagnostics lens holds for this session', argumentHint: '[clear-marks]' }),
      $.command.register({ name: 'lens-health', description: 'lens runners, tsc watchers and recent degradations' }),
    ])
    // Warm the root project's tsc now, so the first edit already has a "before".
    const cfg = await config($)
    if (!cfg.disable.includes('tsc') && (await names(root, p => $.fs.list(p))).has('tsconfig.json')) {
      const bin = await resolveBin($, 'tsc', root)
      if (bin) watch($, join(root, 'tsconfig.json'), bin)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    // The guard's own follow-up continues the turn it checks, so the "before" stays the one Claude started from.
    if (recheck === 'queued') recheck = 'running'
    else if (e.text) {
      // A person's prompt opens a turn; a continuation (no text) stays in the one it continues.
      recheck = undefined
      turnFiles.clear()
      baseline.clear()
      late.length = 0
      listings.clear()
      texts.clear()
      bins.clear()
    }
    return next(e)
  })

  // The end of a turn: if it left errors it introduced, send Claude back once; otherwise tidy what it edited.
  // ponytail: a follow-up prompt, not a classic.Stop block: the built-in security plugin skips user-tier Stop hooks.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    if (isStopGuard && recheck === undefined) {
      const ms = Math.min(next.budget.remainingMs, 60_000) - RESERVE_MS
      await Promise.all([...watches.values()].map(w => until($, w, () => w.state !== 'starting' && w.finished >= w.started, ms)))
      const held = blockers('turn')
      if (held.length) {
        recheck = 'queued'
        $.ui.toast(`${NAME}: the turn left ${tally(held)}; sending Claude back once to fix them`)
        void $.prompt.submit({
          text: [`[${NAME}] Your last turn left ${tally(held)} it introduced:`, ...held.slice(0, SHOW).map(d => lineOf(d, rel)),
            ...(held.length > SHOW ? [`  ...and ${held.length - SHOW} more (lens_diagnostics)`] : []),
            'Fix them, then finish. If one is wrong or out of scope, call lens_diagnostic_mark with its #id ' +
              '(false-positive or defer) instead.'].join('\n'),
        })
        return result // tidy waits for the fix: a formatter between the edits of one change fights the editor
      }
    }
    recheck = undefined
    if (isTidy && turnFiles.size) void tidy($, [...turnFiles])
    return result
  }).catch(($, e, next) => next(e))
}
