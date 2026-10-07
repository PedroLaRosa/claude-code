# model-effort-switcher

A [Claude Code mod](https://code.claude.com/docs) that lets you switch **model**, **effort** and **ultracode** with one keystroke, and shows the current model and effort in the footer.

![model-effort-switcher demo: cycling model, effort and ultracode with the keyboard](https://raw.githubusercontent.com/PedroLaRosa/claude-code/main/assets/model-effort-switcher-demo.gif)

## Why

Changing model or effort means typing `/model sonnet` or `/effort high`, or opening a picker. That is slow enough that you stop doing it, so you run everything at one setting. This mod makes it a keypress: drop to low effort for a quick edit, push to max for a hard bug, jump back.

The footer meter (`ϟϟϟ·· high`: one bolt per effort level out of five, one color per level, with xhigh shimmering and max cycling a rainbow) means you always see what you're running at.

## Install

Needs a Claude Code version with mods (built on 2.1.289). **Pick one:**

<details open>
<summary><strong>Paste into Claude Code</strong></summary>

Paste this into a Claude Code session and it does the rest:

```text
Install the Claude Code mod from github.com/PedroLaRosa/claude-code:
1. Run `claude plugin marketplace add PedroLaRosa/claude-code`, then
   `claude plugin install model-effort-switcher@pedro-la-rosa-claude-code`.
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
claude plugin marketplace add PedroLaRosa/claude-code
claude plugin install model-effort-switcher@pedro-la-rosa-claude-code
```

Or from inside a session:

```
/plugin marketplace add PedroLaRosa/claude-code
/plugin install model-effort-switcher@pedro-la-rosa-claude-code
/reload-plugins
```

Then bind the keys with one command (a mod can't ship keybindings, so it writes them for you):

```
/model-effort-switcher setup
```

It merges five keys into `~/.claude/keybindings.json` and never overwrites a key you already bound to something else.

</details>

**Last step: make your terminal send Alt.** On macOS, Option usually types a symbol instead of acting as Alt. Turn on "Option as Alt" in your terminal (iTerm2: Profiles → Keys; Terminal.app: _Use Option as Meta key_; kitty: `macos_option_as_alt yes`). To change only `alt+.` in kitty, leave that setting off and add `map opt+period send_text all \x1b.` to `kitty.conf`.

Update with `claude plugin update model-effort-switcher@pedro-la-rosa-claude-code`. Remove with `claude plugin uninstall model-effort-switcher@pedro-la-rosa-claude-code` (and delete the five keys from `keybindings.json`).

## Keys

| Key               | Action                                        |
| ----------------- | --------------------------------------------- |
| `alt+↑` / `alt+↓` | previous / next model (runs `/model`)         |
| `alt+←` / `alt+→` | lower / higher effort (runs `/effort`, wraps) |
| `alt+.`           | ultracode on / off (runs `/effort ultracode`) |

`/model-effort-switcher` prints this table inside Claude Code; it also shows in `/help` and the `/` menu.

- **Effort** changes run `/effort <level>` with the level the footer shows, same as typing it.
- **Model** changes run `/model`, so the new model becomes your saved default, same as typing it.
- **Ultracode** needs dynamic workflows enabled and a model that supports it. If Claude Code refuses, the press does nothing; `/effort ultracode on` shows why.
- These keys replace Claude Code's defaults for `alt+↑/↓` (diff file list) and `alt+←/→` (word jumps in the prompt).

## Hack on it

Clone it and load the folder directly instead of installing:

```bash
git clone https://github.com/PedroLaRosa/claude-code ~/claude-code
claude --plugin-dir ~/claude-code/mods/model-effort-switcher
```

To load it in every session, add `"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/claude-code/mods/model-effort-switcher" }` to `~/.claude/settings.json`. Saving a file reloads the mod.

- **Meter glyphs:** edit `ϟ` (filled) and `·` (empty) in the `SessionMode` render hook of `hooks/register.tsx`. If `ϟ` renders as a letter in your font, swap it for `↯`.
- **Model list:** edit `MODELS` at the top of `hooks/register.tsx` (`fable, opus, sonnet, haiku`).
- **Different keys:** change them in `keybindings.json` (keep the `strip:jump5-9` actions), and update `BINDINGS`, `SHORTCUTS` and `SHORTCUT_TABLE` in `hooks/register.tsx`.
- **Check your change:** `claude plugin validate .` and `claude plugin test .`

## How it works

Mods can't read keys directly. Instead the mod draws five hidden buttons above the prompt, each tied to a built-in `strip:jump` action, and your keybindings fire those actions. Each effort step runs `/effort <level>`. A press mid-turn runs `/effort` once the turn ends; until then the picked level is written onto the turn's remaining main-thread requests (subagents keep theirs).

Claude Code gives mods no way to read its effort, so the footer follows the line `/effort` and the model picker print (`Set effort level to max (this session only)`, `… with high effort`). Typing a level, the slider, its `s` for this session only, and Esc all show up straight away. Picking a level there replaces a key's pick.

## What it runs and writes

- **Slash commands:** `alt+←/→` runs `/effort <level>`, `alt+.` runs `/effort ultracode on|off`, and `alt+↑/↓` runs `/model <name>`, once per key press (after the turn ends, if a turn is running). It runs nothing else, and nothing without a key press.
- **Files:** only `/model-effort-switcher setup` writes a file: it adds the five keys to `~/.claude/keybindings.json` (found through `HOME`). It writes nothing when every key is already bound. Nothing is sent off your machine.

## Limits

- Plain `shift+arrow` can't be used: Claude Code doesn't deliver shift-only keys to mod buttons.
- If Claude Code refuses an `alt+.` (ultracode not available), the next press may look like a no-op while it catches up. Claude Code's own `· ultracode` indicator above the prompt is always accurate.
