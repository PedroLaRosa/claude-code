import type { EventOf, RenderElement, RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

test('the band keys cycle effort (wrapping, each step through /effort) and model; the footer shows both', async ($, on) => {
  const ran: string[] = []
  const sent: unknown[] = []
  on('turn.step', async function* ($, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })

  const band = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const footer = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  const shown = async () => (await footer.findAll({ type: 'Text' })).map(t => t.text).join('')

  expect(await shown()).toMatch(/^focus & Opus 5\.5 /)

  const colors = async () => (await footer.findAll({ type: 'Text' })).map(t => t.props?.color).filter(Boolean)

  // Settings are empty in the test, so the engine's level falls back to high.
  expect(await shown()).toContain('ϟϟϟ·· high')
  expect(await colors()).toEqual(['#87D7FF', '#87D7FF', '#87D7FF'])
  await band.press({ key: 'effort-up' })
  expect(await shown()).toContain('ϟϟϟϟ· xhigh')
  expect(ran.at(-1)).toBe('effort xhigh')
  // The clock is frozen at step 0, so the shimmer sits on the first character.
  const xhigh = await colors()
  expect(xhigh.length).toBe('Opus 5.5 '.length + 4 + 'xhigh'.length)
  expect(xhigh[0]).toBe('#DEC8FF')
  expect(new Set(xhigh.slice(1))).toEqual(new Set(['#AF87FF']))
  await band.press({ key: 'effort-up' })
  await band.press({ key: 'effort-up' })
  expect(await shown()).toContain('ϟ···· low')
  expect(ran.at(-1)).toBe('effort low')
  await band.press({ key: 'effort-down' })
  expect(await shown()).toContain('ϟϟϟϟϟ max')
  expect(ran).toEqual(['effort xhigh', 'effort max', 'effort low', 'effort max'])
  // At max each character is a step further round the rainbow (the clock is frozen at step 0).
  expect((await colors()).slice(0, 3)).toEqual(['#D7005F', '#FFAF5F', '#D7D787'])

  // The main thread's next request goes out at the picked level; a subagent's is left alone.
  const step = { turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as const
  for await (const _ of $.turn.step(step)) void _
  for await (const _ of $.turn.step({ ...step, agentId: 'a1' })) void _
  expect(sent).toEqual(['max', 'high'])

  await band.press({ key: 'model-next' })
  expect(ran.at(-1)).toBe('model sonnet')
  await band.press({ key: 'model-prev' })
  expect(ran.at(-1)).toBe('model fable')
})

// A row as /effort or the model picker prints it, or as the model writes it.
const row = (text: string, door: 'command' | 'response' = 'command'): EventOf['session.append'] => {
  const role = door === 'command' ? 'user' : 'assistant'
  return {
    message: { type: role, role, content: [{ type: 'text', text }] },
    door,
    origin: door === 'command' ? { kind: 'composer' } : { kind: 'model', model: 'claude-opus-5-5' },
    uuid: text,
  }
}
const stdout = (text: string) => row(`<local-command-stdout>${text}</local-command-stdout>`)

test('alt+. toggles ultracode through /effort, following one turned on elsewhere', async ($, on) => {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
  // Nothing in a test stores a row (the bottom throws), so an append rejects once the mod has read it.
  const append = (r: EventOf['session.append']) => $.session.append(r).catch(() => undefined)
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return {}
  })

  const band = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const footer = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const shown = async () => (await footer.findAll({ type: 'Text' })).map(t => t.text).join('')

  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode on')
  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode off')

  // Turned on by hand (typed, or tab in the slider): the next press turns it off, and the effort pick stays.
  await band.press({ key: 'effort-up' })
  await append(stdout('Ultracode on (this session only): dynamic workflows on every task. Effort stays high.'))
  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode off')
  expect(await shown()).toContain('ϟϟϟϟ· xhigh')
})

test('the footer follows every level /effort or the model picker prints, saved or not', async ($, on) => {
  let model = 'claude-opus-5-5'
  on('session.model', () => ({ value: model }))
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
  on('command.run', () => ({}))
  // Nothing in a test stores a row (the bottom throws), so an append rejects once the mod has read it.
  const append = (r: EventOf['session.append']) => $.session.append(r).catch(() => undefined)

  const band = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const footer = await $.ui.mount({ plugin: 'model-cycle', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const shown = async () => (await footer.findAll({ type: 'Text' })).map(t => t.text).join('')

  expect(await shown()).toContain('ϟϟ··· medium')
  // The slider's `s`: this session only, so the saved medium no longer applies.
  await append(stdout('Set effort level to max (this session only): Maximum capability with deepest reasoning.'))
  expect(await shown()).toContain('ϟϟϟϟϟ max')
  // Esc in the slider changes nothing, a key's pick included.
  await band.press({ key: 'effort-down' })
  await append(stdout('Cancelled'))
  expect(await shown()).toContain('ϟϟϟϟ· xhigh')
  // The model picker's level replaces the pick, and holds on the next model too.
  model = 'claude-sonnet-5-5'
  await append(stdout('Set model to Sonnet 5.5 for this session only with low effort'))
  expect(await shown()).toContain('Sonnet 5.5 ϟ···· low')
  // The model saying it is no row the engine printed.
  await append(row('Set effort level to max', 'response'))
  expect(await shown()).toContain('ϟ···· low')
  // auto: back to the saved default.
  await append(stdout('Effort level set to auto (this session only)'))
  expect(await shown()).toContain('ϟϟ··· medium')
})

test('/model-cycle lists the keys', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
  const { text } = await $.command.run({ ...typed, command: 'model-cycle', args: '' })
  expect(text).toContain('alt+.')
  expect(text).toContain('alt+← / alt+→')
})

test('/model-cycle setup merges the keys into keybindings.json and keeps what is there', async ($, on) => {
  let file: string | undefined = JSON.stringify({
    bindings: [
      { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } },
      { context: 'Global', bindings: { 'alt+up': 'app:toggleTodos' } },
    ],
  })
  const written: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.exists', () => ({ value: file !== undefined }))
  on('fs.read', () => ({ value: file! }))
  on('fs.write', (_$, e) => {
    file = e.text
    written.push(e.path)
    return { value: undefined }
  })
  const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
  const setup = () => $.command.run({ ...typed, command: 'model-cycle', args: 'setup' })

  const first = await setup()
  const bindings = JSON.parse(file!).bindings
  expect(written).toEqual(['/home/me/.claude/keybindings.json'])
  expect(bindings[0].bindings['ctrl+e']).toBe('chat:externalEditor')
  expect(bindings[1].bindings).toMatchObject({ 'alt+up': 'app:toggleTodos', 'alt+down': 'strip:jump7', 'alt+.': 'strip:jump5' })
  expect(first.text).toContain('Left alone: alt+up')

  // A second run changes nothing.
  expect((await setup()).text).toContain('Left alone: alt+up')
  expect(written).toHaveLength(1)

  // No file yet: it is created with every key.
  file = undefined
  await setup()
  expect(Object.keys(JSON.parse(file!).bindings[0].bindings)).toHaveLength(5)
})
