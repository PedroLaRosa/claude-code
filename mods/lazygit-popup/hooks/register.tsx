import type { EngineInterface, Register } from 'claude-code'

// alt+g opens lazygit in a tmux popup over this pane, in the session's directory.
// The popup closes when lazygit exits, and in the popup ESC at lazygit's top level
// exits it (quitOnTopLevelReturn, layered over your own config.yml for the popup only).
// A key reaches a mod only through a Button in the band above the prompt naming an
// engine action, so ~/.claude/keybindings.json binds alt+g to strip:jump4 and a
// hidden Button there takes it.

// ponytail: tmux only; add a new-terminal-window fallback if you run Claude outside tmux
async function openLazygit($: EngineInterface) {
  const pane = await $.env.get('TMUX_PANE')
  if (!pane) return $.ui.toast('lazygit-popup: needs tmux')

  const dir = (await $.process.run(['lazygit', '-cd'])).stdout.trim()
  const overlay = `${dir}/claude-popup.yml`
  await $.fs.write(overlay, 'quitOnTopLevelReturn: true\n')
  const main = `${dir}/config.yml`
  const configs = (await $.fs.exists(main)) ? `${main},${overlay}` : overlay

  // display-popup holds the call until lazygit exits; the popup outlives the call
  // (timeout or reload), so nothing waits on it.
  void $.process
    .run(
      ['tmux', 'display-popup', '-E', '-w', '90%', '-h', '90%', '-t', pane, '-d', await $.session.cwd(), 'lazygit', '-ucf', configs],
      { timeoutMs: 600_000 },
    )
    .catch(() => {})
}

export const register: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The band is shared: what draws there beneath stays, the Button hides beside it.
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box display="none">
          <Button
            key="lazygit"
            label="lazygit"
            action="strip:jump4"
            onPress={() => openLazygit($).catch(err => $.ui.toast(`lazygit-popup: ${err}`))}
          />
        </Box>
      </Box>
    )
  })
}
