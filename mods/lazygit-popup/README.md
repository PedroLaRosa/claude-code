# lazygit-popup

A [Claude Code mod](https://code.claude.com/docs): press **alt+g** and [lazygit](https://github.com/jesseduffield/lazygit) opens in a popup over your Claude Code pane. Press **ESC** (or `q`) to quit lazygit and the popup closes.

## Why

I was fed up with opening a new terminal, or switching to different software, just to see a git diff. So I used Claude Code mods to fix it: lazygit opens in the same pane, right over Claude Code.

## Requirements

- **Claude Code with mods** (built on 2.1.291): the `claude` CLI, for `claude plugin` install
- **tmux 3.2+**: Claude Code must run inside it; `display-popup` needs 3.2
- **lazygit**, on your `PATH`: the mod calls `lazygit -cd` and `lazygit -ucf`; a release recent enough to support `quitOnTopLevelReturn`, or ESC won't close the popup
- **A keybinding**: `"alt+g": "strip:jump4"` in `~/.claude/keybindings.json` (see Install)
- **A terminal that sends Alt**: Linux terminals do by default. On macOS, set Option to act as Alt (see Install)

Works on macOS, Linux and Windows via WSL: anywhere tmux runs. Native Windows has no tmux, so run Claude Code inside tmux in WSL.

Install the tools with `brew install tmux lazygit` on macOS, or your package manager on Linux/WSL.

## Install

```bash
claude plugin marketplace add PedroLaRosa/claude-code
claude plugin install lazygit-popup@pedro-la-rosa-claude-code
```

A mod can't ship keybindings, so bind the key yourself. Add this to the `"Global"` bindings in `~/.claude/keybindings.json`:

```json
"alt+g": "strip:jump4"
```

Then run `/reload-plugins`.

On macOS, make your terminal send Option as Alt (iTerm2: Profiles → Keys; Terminal.app: _Use Option as Meta key_; kitty: `macos_option_as_alt yes`).

## How it works

- **The key:** mods can't read keys directly. The mod draws a hidden button above the prompt tied to Claude Code's built-in `strip:jump4` action, and your keybinding fires it.
- **The popup:** the button runs `tmux display-popup -E lazygit` in the session's directory. With `-E`, the popup closes when lazygit exits.
- **ESC quits:** the mod writes `quitOnTopLevelReturn: true` to `claude-popup.yml` in lazygit's config dir and loads it on top of your own `config.yml`, for the popup only. lazygit runs everywhere else are unchanged.

## Hack on it

```bash
git clone https://github.com/PedroLaRosa/claude-code ~/claude-code
claude --plugin-dir ~/claude-code/mods/lazygit-popup
```

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. Popup size is the `-w` / `-h` pair in `hooks/register.tsx`. Check changes with `claude plugin validate .` and `claude plugin test .`

## Limits

- tmux only. Outside tmux, alt+g shows a "needs tmux" toast. On Windows, that means using WSL.
