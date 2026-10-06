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

test('alt+g opens lazygit in a tmux popup with the ESC-quits overlay', async ($, on) => {
  const ran: (readonly string[])[] = []
  const written: Record<string, string> = {}
  on('env.get', (_$, e) => ({ value: e.name === 'TMUX_PANE' ? '%3' : undefined }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_$, e) => {
    written[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    ran.push(e.argv)
    const stdout = e.argv[1] === '-cd' ? '/cfg\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))

  const band = await $.ui.mount({ plugin: 'lazygit-popup', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'lazygit' })

  expect(written['/cfg/claude-popup.yml']).toBe('quitOnTopLevelReturn: true\n')
  expect(ran.at(-1)).toEqual([
    'tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', '-t', '%3', '-d', '/repo',
    'lazygit', '-ucf', '/cfg/config.yml,/cfg/claude-popup.yml',
  ])
})

test('outside tmux it says so and runs nothing', async ($, on) => {
  const ran: unknown[] = []
  const toasts: string[] = []
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_$, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, (): RenderElement => ({ type: 'Box', children: [] }))

  const band = await $.ui.mount({ plugin: 'lazygit-popup', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'lazygit' })

  expect(ran).toEqual([])
  expect(toasts).toEqual(['lazygit-popup: needs tmux'])
})
