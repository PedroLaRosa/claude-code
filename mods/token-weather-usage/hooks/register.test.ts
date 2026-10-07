import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const in2h = new Date(NOW + 2 * 3_600_000).toISOString()
const BAND = {
  plugin: 'token-weather-usage',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

function world(on: any, usage: unknown, agents: unknown[] = []) {
  mock.clock(on, { now: NOW })
  mock.env(on, {})
  on('session.usage', () => ({ value: usage }))
  on('agent.list', () => ({ value: agents }))
  on('session.start', () => ({ cwd: '/' }))
}

test('band shows context, limit against the clock, cost and agents', async ($, on) => {
  world(
    on,
    {
      startedAt: NOW,
      context: { tokens: 634_000, window: 1_000_000, percent: 63 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 80, resetsAt: in2h }],
      cost: { usd: 41.07 },
    },
    [{ id: 'a1', type: 'Explore', description: 'x', status: 'running' }],
  )
  await $.session.start({ cwd: '/' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ key: 'context' }))?.text).toContain('☂ 634k')
    // 80% used, 60% of the window elapsed: 3 solid, 1 dashed ahead of the clock, 1 left; red.
    expect((await ui.find({ key: 'five_hour' }))?.text).toContain('5h ━━━╍━ 80% ↻ 2h00 → ')
    expect((await ui.find({ type: 'Text', text: /^80%$/ }))?.props.color).toBe('#ef5350')
    expect((await ui.find({ key: 'cost' }))?.text).toContain('≈ $41.07')
    expect((await ui.find({ key: 'agents' }))?.text).toContain('1 agent')
    expect((await ui.find({ key: 'cache' }))?.text).toContain('cache —')
    // Session pills on one row, " | " between them; the limits on the row below.
    const session = (await ui.find({ key: 'session' }))?.text
    expect(session).toContain(' | ϟ cache — | ¤ ≈ $41.07 | ✻ 1 agent')
    expect(session).not.toContain('5h')
    expect((await ui.find({ key: 'limits' }))?.text).toContain('5h')
    await ui.unmount()
  }
})

test('band passes without readings', async ($, on) => {
  world(on, { startedAt: NOW, context: { window: 0 }, rateLimits: [] })
  on('ui.render', () => ({ type: 'Box', props: { key: 'engine' }, children: [] })) // the engine's own band
  await $.session.start({ cwd: '/' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'context' })).toBeUndefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  await ui.unmount()
})
