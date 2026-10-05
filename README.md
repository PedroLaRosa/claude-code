# model-effort

A [Claude Code mod](https://code.claude.com/docs) that lets you switch **model**, **effort** and **ultracode** with one keystroke, and shows the current model and effort in the footer.

```
                                                        Opus 5.5 ▰▰▰▰▱ xhigh
```

## Why

Changing model or effort means typing `/model sonnet` or `/effort high`, or opening a picker. That is slow enough that you stop doing it, so you run everything at one setting. This mod makes it a keypress: drop to low effort for a quick edit, push to max for a hard bug, jump back.

The footer meter (`▰▰▰▱▱ high`, colored cool to hot from your theme) means you always see what you're running at.

## Keys

| Key | Action |
|---|---|
| `alt+↑` / `alt+↓` | previous / next model (runs `/model`) |
| `alt+←` / `alt+→` | lower / higher effort (wraps around) |
| `alt+.` | ultracode on / off (runs `/effort ultracode`) |

`/model-effort` prints this table inside Claude Code; it also shows in `/help` and the `/` menu.

- **Effort** changes apply to this session only. Nothing is saved.
- **Model** changes run `/model`, so the new model becomes your saved default, same as typing it.
- **Ultracode** needs dynamic workflows enabled and a model that supports it. If Claude Code refuses, the press does nothing; `/effort ultracode on` shows why.

## Install

Needs a Claude Code version with mods (built on 2.1.289).

**1. Get the mod**

```sh
git clone https://github.com/PedroLaRosa/claude-code-model-effort ~/.claude/mods/model-effort
```

**2. Load it in every session** — add to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/model-effort"
  }
}
```

(Or try it once with `claude --plugin-dir ~/.claude/mods/model-effort`.)

**3. Bind the keys** — a mod can't ship keybindings, so add to `~/.claude/keybindings.json`:

```json
{
  "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
  "bindings": [
    {
      "context": "Global",
      "bindings": {
        "alt+up": "strip:jump6",
        "alt+down": "strip:jump7",
        "alt+left": "strip:jump8",
        "alt+right": "strip:jump9",
        "alt+.": "strip:jump5"
      }
    }
  ]
}
```

Merge with your existing `bindings` if you have some. These keys replace Claude Code's defaults for `alt+↑/↓` (diff file list) and `alt+←/→` (word jumps).

**4. Make your terminal send Alt.** On macOS, Option usually types a symbol instead. Enable "Option as Alt" in your terminal (iTerm2: Profiles → Keys; Terminal.app: Use Option as Meta key). In kitty, `macos_option_as_alt yes`, or to change only `alt+.`:

```
map opt+period send_text all \x1b.
```

Restart Claude Code. The meter appears at the right of the footer.

## Customize

- **Different keys:** change them in `keybindings.json` (keep the `strip:jump5-9` actions). Update `KEYS`/`KEY_TABLE` in `hooks/register.tsx` so `/model-effort` stays accurate.
- **Model list:** edit `MODELS` at the top of `hooks/register.tsx` (`fable, opus, sonnet, haiku`).

## Develop

```sh
claude plugin validate .
claude plugin test .
```

## How it works

Mods can't read keys directly. Instead the mod draws four hidden buttons above the prompt, each tied to a built-in `strip:jump` action, and your keybindings fire those actions. Effort is applied by rewriting the effort on each main-thread request (subagents keep theirs), so no `/effort` rows clutter the transcript.

## Limits

- Plain `shift+arrow` can't be used: Claude Code doesn't deliver shift-only keys to mod buttons.
- The ultracode toggle remembers what it last asked for. If you flip ultracode from the `/effort` slider, one press may look like a no-op while it catches up. Claude Code's own `· ultracode` indicator above the prompt is always accurate.
