import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Settings } from 'claude-code'
import type { Level } from '../types'

// Footer, right corner: `Opus 5.5 ϟϟϟ·· high`, model, meter and word in the level's color, xhigh shimmering, max cycling a rainbow.
// alt+up / alt+down cycle the model (through /model), alt+left / alt+right the
// effort (through /effort), alt+. toggles ultracode (`/effort ultracode on|off`). A key
// reaches a mod only through a Button in the band above the prompt naming an engine
// action, so ~/.claude/keybindings.json binds the keys to strip:jump5-9 (idle at the
// prompt) and hidden Buttons there take them. Shift alone never presses a mod's Button.

// ponytail: fixed list; edit it when your account's models change
const MODELS = ['fable', 'opus', 'sonnet', 'haiku']
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const HEAT: Record<string, string> = { low: '#D7D787', medium: '#AED75F', high: '#87D7FF', xhigh: '#AF87FF' }
// Max cycles these, each character one step ahead of the one before, a step every STEP_MS.
const RAINBOW = ['#D7005F', '#FFAF5F', '#D7D787', '#AED75F', '#87D7FF', '#87AFFF', '#AF87FF']
// Xhigh sweeps one light character along the string, then rests SHIMMER_REST steps.
const SHIMMER = '#DEC8FF'
const SHIMMER_REST = 3
const STEP_MS = 110

// The keys' pick, until the /effort row it ran prints. A press mid-turn waits for the
// turn to end to run /effort, so meanwhile the pick goes on that model's main-thread requests.
const pick = atom({ plugin: 'model-cycle', key: 'pick' } as const, null)
// The level the engine itself last sent on the main thread.
const base = atom({ plugin: 'model-cycle', key: 'base' } as const, null)
// The level /effort or the model picker last printed. The engine keeps one for every
// model; null after `auto`, so the saved default applies.
const printed = atom({ plugin: 'model-cycle', key: 'printed' } as const, null)
// Whether ultracode is on, as /effort last printed it or the key last asked.
// ponytail: a refused `on` from the key costs one press to resync; the engine draws the
// truth itself (`· ultracode` above the prompt)
const ultra = atom({ plugin: 'model-cycle', key: 'ultra' } as const, false)

// What /effort and the model picker print as they set a level: `Set effort level to max
// (this session only): …`, `Effort level set to auto`, `…; set to 'xhigh' instead`,
// `Set model to Opus 5.5 … with high effort`.
const SET_LEVEL = /effort level (?:set )?to (\w+)|set to '(\w+)' instead|with (\w+) effort/i

// The model the footer last drew, so the band can tell when alt+p changed it.
let drawnModel = ''
// Whether the footer last drew xhigh or max, the levels that animate.
let animated = false

const wrap = (list: string[], at: number, dir: number) => list[(at + dir + list.length) % list.length]!

// The engine's level for `model`: its last request's (`seen`), else what /effort last
// printed (`said`), else the saved default, read from settings only then.
async function engineLevel(model: string, seen: Level | null, said: string | null, settings: () => Promise<Settings>): Promise<string> {
  if (seen?.model === model) return seen.level
  if (said !== null) return said
  const s = await settings()
  const perModel = s.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined
  const saved = perModel?.[model.replace('[1m]', '')]?.effortLevel ?? s.effortLevel
  return typeof saved === 'string' ? saved : 'high'
}

// Each press runs `/effort <level>` with the level the footer now shows, as typing it does.
async function stepEffort($: EngineInterface, dir: number) {
  const model = await $.session.model()
  const engine = await engineLevel(model, await read($, base), await read($, printed), () => $.settings.read())
  const now = await read($, pick)
  const level = wrap(LEVELS, LEVELS.indexOf(now?.model === model ? now.level : engine), dir)
  await update($, pick, () => ({ model, level }))
  await $.command.run({ command: 'effort', args: level })
}

// The press notes its ask itself; the row /effort prints, if it reaches the hook, agrees.
async function toggleUltra($: EngineInterface) {
  const isUltra = !(await read($, ultra))
  await update($, ultra, () => isUltra)
  await $.command.run({ command: 'effort', args: `ultracode ${isUltra ? 'on' : 'off'}` })
}

// /model saves the pick as the default and leaves a row, as typing it does;
// a press mid-turn runs once the turn ends.
async function stepModel($: EngineInterface, dir: number) {
  const now = (await $.session.model()).toLowerCase()
  await $.command.run({ command: 'model', args: wrap(MODELS, MODELS.findIndex(m => now.includes(m)), dir) })
  $.ui.invalidate('ui.render')
}

// claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5, …[1m] → … 1M.
function displayName(model: string): string {
  const [family, ...version] = model.replace('[1m]', '').replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p))
  if (!family) return model
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim() + (model.endsWith('[1m]') ? ' 1M' : '')
}

// The `?` shortcuts list takes no plugin rows, so the keys live in /help and the
// typeahead as /model-cycle's description, and in full as its output.
// ponytail: copied from ~/.claude/keybindings.json; edit both when a key moves
const SHORTCUTS = 'alt+↑/↓ model · alt+←/→ effort · alt+. ultracode'
const SHORTCUT_TABLE = [
  'keys (bound in ~/.claude/keybindings.json):',
  '  alt+↑ / alt+↓   previous / next model (runs /model)',
  '  alt+← / alt+→   lower / higher effort (runs /effort)',
  '  alt+.           ultracode on / off (/effort ultracode)',
].join('\n')

const BINDINGS: Record<string, string> = {
  'alt+up': 'strip:jump6',
  'alt+down': 'strip:jump7',
  'alt+left': 'strip:jump8',
  'alt+right': 'strip:jump9',
  'alt+.': 'strip:jump5',
}

type KeybindingsFile = { bindings?: { context: string; bindings: Record<string, string | null> }[] }

// `/model-cycle setup`: merges BINDINGS into ~/.claude/keybindings.json, leaving
// any key the person already bound to something else alone.
async function setupKeys($: EngineInterface): Promise<string> {
  const path = `${await $.env.get('HOME')}/.claude/keybindings.json`
  let file: KeybindingsFile = {}
  if (await $.fs.exists(path)) {
    try {
      file = JSON.parse(await $.fs.read(path))
    } catch {
      return `${path} is not valid JSON, so nothing was changed. Fix it and run /model-cycle setup again.`
    }
  }
  const all = (file.bindings ??= [])
  let global = all.find(b => b.context === 'Global')
  if (!global) all.push((global = { context: 'Global', bindings: {} }))
  const added: string[] = []
  const kept: string[] = []
  for (const [key, action] of Object.entries(BINDINGS)) {
    const now = global.bindings[key]
    if (now === undefined) {
      global.bindings[key] = action
      added.push(key)
    } else if (now !== action) kept.push(`${key} (already ${now ?? 'unbound'})`)
  }
  if (added.length > 0) await $.fs.write(path, `${JSON.stringify(file, null, 2)}\n`)

  return [
    added.length > 0 ? `Bound ${added.join(', ')} in ~/.claude/keybindings.json.` : 'The keys are already bound.',
    kept.length > 0 ? `Left alone: ${kept.join(', ')}. Unbind those, then run setup again.` : '',
    'Last step: make your terminal send Alt for Option (see the README).',
  ].filter(Boolean).join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'model-cycle', description: `Keys: ${SHORTCUTS} · "setup" binds them`, argumentHint: '[setup]' })

    // ponytail: one standing timer; it only redraws while max is showing
    $.clock.every(STEP_MS, () => {
      if (animated) $.ui.invalidate('ui.render')
    })

    return next(e)
  })

  on('command.run', { command: 'model-cycle' }, async ($, e) => ({
    text: e.args.trim() === 'setup' ? await setupKeys($) : SHORTCUT_TABLE,
  }))

  on('turn.step', async function* ($, e, next) {
    const level = e.effort
    if (e.agentId !== undefined || typeof level !== 'string') return yield* next(e)
    const seen = await read($, base)
    if (seen?.model !== e.model || seen.level !== level) {
      // The engine's level changed on this model without printing it: follow it.
      if (seen?.model === e.model) await update($, pick, () => null)
      await update($, base, () => ({ model: e.model, level }))
    }
    const chosen = await read($, pick)

    return yield* next(chosen?.model === e.model ? { ...e, effort: chosen.level as typeof e.effort } : e)
  })

  // The row /effort or the model picker prints is the only place the engine tells a mod
  // its level: typed or slid, saved or this session only. A row that sets none (Esc's
  // `Cancelled`, an error) leaves the pick alone.
  on('session.append', async ($, e, next) => {
    const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    if (e.agentId !== undefined || !text.startsWith('<local-command-stdout>')) return next(e)
    const set = text.match(SET_LEVEL)
    const level = (set?.[1] ?? set?.[2] ?? set?.[3])?.toLowerCase()
    if (level !== undefined && (level === 'auto' || LEVELS.includes(level))) {
      await update($, pick, () => null)
      await update($, base, () => null)
      await update($, printed, () => (level === 'auto' ? null : level))
    }
    const ultracode = text.match(/\bUltracode (on|off)\b/)
    if (ultracode) await update($, ultra, () => ultracode[1] === 'on')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const model = await $.session.model()
    drawnModel = model
    const chosen = await read($, pick)
    const level =
      chosen?.model === model ? chosen.level : await engineLevel(model, await read($, base), await read($, printed), () => $.settings.read())
    const filled = LEVELS.indexOf(level) + 1
    animated = level === 'xhigh' || level === 'max'
    const step = Math.floor((await $.clock.now()) / STEP_MS)
    const { Box, Text } = $.ui.resolve(e)
    const name = `${displayName(model)} `
    const total = name.length + filled + level.length
    // The level's color. Max: each character its own rainbow step; xhigh: one light
    // character sweeping along. Both run on from `from`, so the model, meter and word
    // move as one string.
    const color = (at: number) =>
      level === 'max'
        ? RAINBOW[(step + at) % RAINBOW.length]
        : at === step % (total + SHIMMER_REST) ? SHIMMER : HEAT[level]
    const paint = (text: string, from: number) =>
      animated
        ? [...text].map((c, i) => <Text key={i} color={color(from + i)}>{c}</Text>)
        : <Text color={HEAT[level]}>{text}</Text>

    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}
        {paint(name, 0)}
        {paint('ϟ'.repeat(filled), name.length)}
        <Text dimColor>{'·'.repeat(LEVELS.length - filled)}</Text>
        <Text> </Text>
        {paint(level, name.length + filled)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // An alt+p pick tells a mod nothing, but this band redraws as the picker closes.
    if ((await $.session.model()) !== drawnModel) $.ui.invalidate('ui.render')
    // The band is shared: what draws there beneath stays, the Buttons hide beside it.
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box display="none">
          <Button key="model-next" label="model next" action="strip:jump7" onPress={() => stepModel($, 1)} />
          <Button key="model-prev" label="model previous" action="strip:jump6" onPress={() => stepModel($, -1)} />
          <Button key="effort-up" label="effort up" action="strip:jump9" onPress={() => stepEffort($, 1)} />
          <Button key="effort-down" label="effort down" action="strip:jump8" onPress={() => stepEffort($, -1)} />
          <Button key="ultracode" label="ultracode" action="strip:jump5" onPress={() => toggleUltra($)} />
        </Box>
      </Box>
    )
  })
}
