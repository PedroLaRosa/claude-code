# model-cycle

A [Claude Code mod](https://code.claude.com/docs) that lets you switch **model**, **effort** and **ultracode** with one keystroke, and shows the current model and effort in the footer.

```
                                                        Opus 5.5 ▰▰▰▰▱ xhigh
```

## Why

Changing model or effort means typing `/model sonnet` or `/effort high`, or opening a picker. That is slow enough that you stop doing it, so you run everything at one setting. This mod makes it a keypress: drop to low effort for a quick edit, push to max for a hard bug, jump back.

The footer meter (`▰▰▰▱▱ high`, colored cool to hot from your theme) means you always see what you're running at.

## Install

Needs a Claude Code version with mods (built on 2.1.289). **Pick one:**

<details open>
<summary><strong>Paste into Claude Code</strong></summary>

Paste this into a Claude Code session and it does the rest:

```text
Install the Claude Code mod from github.com/PedroLaRosa/claude-code-model-cycle:
1. Run `claude plugin marketplace add PedroLaRosa/claude-code-model-cycle`, then
   `claude plugin install model-cycle@pedro-la-rosa-mods`.
2. Merge these into the "Global" bindings of ~/.claude/keybindings.json (create the
   file if missing, keep every existing binding, don't overwrite a key that is already
   bound; tell me about any conflict):
   alt+up → strip:jump6, alt+down → strip:jump7, alt+left → strip:jump8,
   alt+right → strip:jump9, alt+. → strip:jump5
3. Tell me to run /reload-plugins.
```

</details>

<details>
<summary><strong>Run commands</strong></summary>

```bash
claude plugin marketplace add PedroLaRosa/claude-code-model-cycle
claude plugin install model-cycle@pedro-la-rosa-mods
```

Or from inside a session:

```
/plugin marketplace add PedroLaRosa/claude-code-model-cycle
/plugin install model-cycle@pedro-la-rosa-mods
/reload-plugins
```

Then bind the keys with one command (a mod can't ship keybindings, so it writes them for you):

```
/model-cycle setup
```

It merges five keys into `~/.claude/keybindings.json` and never overwrites a key you already bound to something else.

</details>

**Last step: make your terminal send Alt.** On macOS, Option usually types a symbol instead of acting as Alt. Turn on "Option as Alt" in your terminal (iTerm2: Profiles → Keys; Terminal.app: *Use Option as Meta key*; kitty: `macos_option_as_alt yes`). To change only `alt+.` in kitty, leave that setting off and add `map opt+period send_text all \x1b.` to `kitty.conf`.

Update with `claude plugin update model-cycle@pedro-la-rosa-mods`. Remove with `claude plugin uninstall model-cycle@pedro-la-rosa-mods` (and delete the five keys from `keybindings.json`).

## Keys

| Key | Action |
|---|---|
| `alt+↑` / `alt+↓` | previous / next model (runs `/model`) |
| `alt+←` / `alt+→` | lower / higher effort (wraps around) |
| `alt+.` | ultracode on / off (runs `/effort ultracode`) |

`/model-cycle` prints this table inside Claude Code; it also shows in `/help` and the `/` menu.

- **Effort** changes apply to this session only. Nothing is saved.
- **Model** changes run `/model`, so the new model becomes your saved default, same as typing it.
- **Ultracode** needs dynamic workflows enabled and a model that supports it. If Claude Code refuses, the press does nothing; `/effort ultracode on` shows why.
- These keys replace Claude Code's defaults for `alt+↑/↓` (diff file list) and `alt+←/→` (word jumps in the prompt).

## Hack on it

Clone it and load the folder directly instead of installing:

```bash
git clone https://github.com/PedroLaRosa/claude-code-model-cycle ~/.claude/mods/model-cycle
claude --plugin-dir ~/.claude/mods/model-cycle
```

To load it in every session, add `"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/model-cycle" }` to `~/.claude/settings.json`. Saving a file reloads the mod.

- **Model list:** edit `MODELS` at the top of `hooks/register.tsx` (`fable, opus, sonnet, haiku`).
- **Different keys:** change them in `keybindings.json` (keep the `strip:jump5-9` actions), and update `BINDINGS`, `KEYS` and `KEY_TABLE` in `hooks/register.tsx`.
- **Check your change:** `claude plugin validate .` and `claude plugin test .`

## How it works

Mods can't read keys directly. Instead the mod draws five hidden buttons above the prompt, each tied to a built-in `strip:jump` action, and your keybindings fire those actions. Effort is applied by rewriting the effort on each main-thread request (subagents keep theirs), so no `/effort` rows clutter the transcript.

## Limits

- Plain `shift+arrow` can't be used: Claude Code doesn't deliver shift-only keys to mod buttons.
- The ultracode toggle remembers what it last asked for. If you flip ultracode from the `/effort` slider, one press may look like a no-op while it catches up. Claude Code's own `· ultracode` indicator above the prompt is always accurate.
