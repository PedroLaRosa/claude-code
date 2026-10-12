# statusline-command

My Claude Code [status line](https://code.claude.com/docs/en/statusline): a single dependency-free Node script that Claude Code runs after each update and prints three rows under the conversation.

![statusline-command demo: branch, context bar, cache time left, session cost, and the 5h and 7d limit gauges](https://raw.githubusercontent.com/PedroLaRosa/claude-code/main/assets/statusline-command-demo.png)

The last row of the screenshot (`auto mode on · 2 shells`) is Claude Code's own footer, not this script.

## What it shows

**Row 1: git branch.** `🌿` and the current branch, or nothing outside a repo or on a detached HEAD.

**Row 2: this session.**

- **Context:** tokens in the window (`103.1k`) and a 10-cell bar with the percent used. Green, amber from 70%, red from 90%.
- **Prompt cache:** `ϟ cache 97% 57 min` is the hit ratio and the time left before the cache expires. The time turns amber under 10 minutes, and the whole part turns red and reads `expired` once the cache is cold. Absent before the first reply.
- **Cost and time:** the session's cost in dollars and how long it has run. Absent until the session has cost something.

**Row 3: plan limits.** The 5-hour and 7-day windows, each as a small gauge plus the percent used and when it resets (`↻ 51 min → 03:20` for 5h, `↻ 3d12h` for 7d).

- The 5h icon is a pie that fills with usage (`○ ◔ ◑ ◕ ●`); the 7d one is `▦`.
- The gauge compares usage with the time elapsed in the window. The solid part is usage up to the clock; a dashed part is the gap between the two, grey while you are under the clock's pace and in the level color once you run ahead of it.
- The level is green, amber past 75% used or more than 5 points ahead of the clock, red past 90% or more than 15 points ahead. Red also bolds the percent.
- Absent without a Pro or Max plan, and while a window has no valid reading (it has just reset).

## Requirements

- **Node.js**, any recent version. No packages.
- **Claude Code** with a [status line](https://code.claude.com/docs/en/statusline) command. The limits and cache fields come from the JSON Claude Code pipes in, so they appear only when your plan and version report them.
- **A terminal with ANSI colors and a font that has the gauge glyphs** (`━ ╍ █ ░ ◔ ◑ ◕ ▦ ϟ`). Any modern terminal font does.

## Install

Copy the script somewhere on your machine:

```bash
mkdir -p ~/.claude
curl -fsSL https://raw.githubusercontent.com/PedroLaRosa/claude-code/main/statusline-command/statusline-command.js \
  -o ~/.claude/statusline-command.js
```

Point Claude Code at it in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline-command.js",
    "refreshInterval": 30
  }
}
```

`refreshInterval` is in seconds and keeps the cache countdown and the `↻` times moving while you are idle.

## Try it without Claude Code

The script reads the status line JSON on stdin, so you can feed it a sample:

```bash
echo '{"model":{"display_name":"Opus"},"cost":{"total_cost_usd":1.44,"total_duration_ms":1145000},"context_window":{"used_percentage":10,"current_usage":{"input_tokens":103100}},"prompt_cache":{"warm":true,"hit_ratio":0.97,"expires_at":'$(( $(date +%s) + 3420 ))'}}' \
  | node statusline-command/statusline-command.js
```
