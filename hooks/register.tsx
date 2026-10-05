import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Footer, right corner: `Opus 5.5 ▰▰▰▱▱ high`, meter and word colored cool to hot.
// alt+up / alt+down cycle the model (through /model), alt+left / alt+right the
// effort, alt+. toggles ultracode (`/effort ultracode on|off`). A key
// reaches a mod only through a Button in the band above the prompt naming an engine
// action, so ~/.claude/keybindings.json binds the keys to strip:jump5-9 (idle at the
// prompt) and hidden Buttons there take them. Shift alone never presses a mod's Button.

// ponytail: fixed list; edit it when your account's models change
const MODELS = ['fable', 'opus', 'sonnet', 'haiku']
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
// Theme keys, cool to hot, so the colors follow the person's theme.
const HEAT: Record<string, string> = { low: 'inactive', medium: 'success', high: 'warning', xhigh: 'claude', max: 'error' }

// The keys' pick, sent on that model's main-thread requests: this session only,
// nothing saved and no /effort row in the transcript.
const pick = atom({ plugin: 'model-effort', key: 'pick' } as const, null)
// The level the engine itself last sent on the main thread.
const base = atom({ plugin: 'model-effort', key: 'base' } as const, null)
// Whether ultracode was last asked on. The engine's flag has no reader and /effort
// answers a mod with no text, so this is the ask, not the truth; the engine draws the
// truth itself (`· ultracode` above the prompt).
// ponytail: a refused `on` or the /effort slider's tab toggle costs one press to resync
const ultra = atom({ plugin: 'model-effort', key: 'ultra' } as const, false)

// The model the footer last drew, so the band can tell when alt+p changed it.
let drawnModel = ''

const wrap = (list: string[], at: number, dir: number) => list[(at + dir + list.length) % list.length]!

// The engine's level for `model`: its last request's, else the saved default.
async function engineLevel($: EngineInterface, model: string): Promise<string> {
  const seen = await read($, base)
  if (seen?.model === model) return seen.level
  const s = await $.settings.read()
  const perModel = s.modelSettings as Record<string, { effortLevel?: unknown } | undefined> | undefined
  const saved = perModel?.[model.replace('[1m]', '')]?.effortLevel ?? s.effortLevel
  return typeof saved === 'string' ? saved : 'high'
}

async function stepEffort($: EngineInterface, dir: number) {
  const model = await $.session.model()
  const engine = await engineLevel($, model)
  await update($, pick, now => ({
    model,
    level: wrap(LEVELS, LEVELS.indexOf(now?.model === model ? now.level : engine), dir),
  }))
}

// The mod's own run skips its command.run hook, so it notes the ask itself.
async function toggleUltra($: EngineInterface) {
  const on = !(await read($, ultra))
  await update($, ultra, () => on)
  await $.command.run({ command: 'effort', args: `ultracode ${on ? 'on' : 'off'}` })
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
// typeahead as /model-effort's description, and in full as its output.
// ponytail: copied from ~/.claude/keybindings.json; edit both when a key moves
const KEYS = 'alt+↑/↓ model · alt+←/→ effort · alt+. ultracode'
const KEY_TABLE = [
  'keys (bound in ~/.claude/keybindings.json):',
  '  alt+↑ / alt+↓   previous / next model (runs /model)',
  '  alt+← / alt+→   lower / higher effort (this session)',
  '  alt+.           ultracode on / off (/effort ultracode)',
].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'model-effort', description: `Keys: ${KEYS}` })

    return next(e)
  })

  on('command.run', { command: 'model-effort' }, () => ({ text: KEY_TABLE }))

  on('turn.step', async function* ($, e, next) {
    const level = e.effort
    if (e.agentId !== undefined || typeof level !== 'string') return yield* next(e)
    const seen = await read($, base)
    if (seen?.model !== e.model || seen.level !== level) {
      // The engine's level changed on this model (/effort, alt+p): follow it.
      if (seen?.model === e.model) await update($, pick, () => null)
      await update($, base, () => ({ model: e.model, level }))
    }
    const chosen = await read($, pick)

    return yield* next(chosen?.model === e.model ? { ...e, effort: chosen.level as typeof e.effort } : e)
  })

  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const ran = await next(e)
    const [word, arg] = e.args.trim().toLowerCase().split(/\s+/)
    if (word === 'ultracode') {
      // As /effort reads it: bare or `on` is on, `off` is off.
      if (arg === undefined || arg === 'on' || arg === 'off') await update($, ultra, () => arg !== 'off')

      return ran
    }
    await update($, pick, () => null)
    const level = e.args.trim()
    if (LEVELS.includes(level)) {
      const model = await $.session.model()
      await update($, base, () => ({ model, level }))
    }

    return ran
  })

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    $.ui.invalidate('ui.render')

    return ran
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const model = await $.session.model()
    drawnModel = model
    const chosen = await read($, pick)
    const level = chosen?.model === model ? chosen.level : await engineLevel($, model)
    const filled = LEVELS.indexOf(level) + 1
    const color = HEAT[level]
    const hot = color === undefined ? { dimColor: true } : { color }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ')} & </Text>}
        <Text {...(level === 'max' ? hot : { dimColor: true })}>{displayName(model)} </Text>
        <Text {...hot}>{'▰'.repeat(filled)}</Text>
        <Text dimColor>{'▱'.repeat(LEVELS.length - filled)}</Text>
        <Text {...hot} bold={level === 'max'}> {level}</Text>
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
