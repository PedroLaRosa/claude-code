import type { RenderElement, RenderPropsOf } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

test('the band keys cycle effort (wrapping) and model; the footer shows both', async ($, on) => {
  const ran: string[] = []
  const sent: unknown[] = []
  on('turn.step', async function* ($, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return { text: '' }
  })

  const band = await $.ui.mount({ plugin: 'model-effort', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const footer = await $.ui.mount({ plugin: 'model-effort', surface: 'terminal', component: 'SessionMode', props: { modes: ['focus'] } })
  const shown = async () => (await footer.findAll({ type: 'Text' })).map(t => t.text).join('')

  expect(await shown()).toMatch(/^focus & Opus 5\.5 /)

  // Settings are empty in the test, so the engine's level falls back to high.
  expect(await shown()).toContain('▰▰▰▱▱ high')
  await band.press({ key: 'effort-up' })
  expect(await shown()).toContain('▰▰▰▰▱ xhigh')
  await band.press({ key: 'effort-up' })
  await band.press({ key: 'effort-up' })
  expect(await shown()).toContain('▰▱▱▱▱ low')
  await band.press({ key: 'effort-down' })
  expect(await shown()).toContain('▰▰▰▰▰ max')

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

test('alt+. toggles ultracode through /effort, following a typed /effort ultracode', async ($, on) => {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))
  on('command.run', ($, e) => {
    ran.push(`${e.command} ${e.args}`)
    return {}
  })

  const band = await $.ui.mount({ plugin: 'model-effort', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const footer = await $.ui.mount({ plugin: 'model-effort', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const shown = async () => (await footer.findAll({ type: 'Text' })).map(t => t.text).join('')

  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode on')
  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode off')

  // Typed by hand: the next press turns it off, and the effort pick stays.
  await band.press({ key: 'effort-up' })
  const typed = { command: 'effort', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
  await $.command.run({ ...typed, args: 'ultracode' })
  await band.press({ key: 'ultracode' })
  expect(ran.at(-1)).toBe('effort ultracode off')
  expect(await shown()).toContain('▰▰▰▰▱ xhigh')
})

test('/model-effort lists the keys', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const typed = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
  const { text } = await $.command.run({ ...typed, command: 'model-effort', args: '' })
  expect(text).toContain('alt+.')
  expect(text).toContain('alt+← / alt+→')
})
