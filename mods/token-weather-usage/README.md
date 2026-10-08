# token-weather-usage

> **Demo.** An exploration of how far a mod can customize the UI, set against the [status line](https://code.claude.com/docs/en/statusline). For day-to-day usage numbers, prefer the status line; see [Mod vs status line](#mod-vs-status-line).

A Claude Code mod that draws two rows of colored pills above the prompt: how full the context is, how long the prompt cache has left, what the session has cost and how many subagents are running; under them, your 5h and 7d plan limits against the time elapsed.

```
☁ 312k ▄▃▄▂█ ▲ +27.4k | ϟ cache 99% 1h00 | ¤ ≈ $18.42 ❯ +$2.31 | ✻ 3 agents

◑ 5h ━━━━━ 48% ↻ 2h54 → 21:32 | ▦ 7d ━━━━━ 52% ↻ 3d02h
```

## Install

```
/plugin install token-weather-usage --marketplace PedroLaRosa/claude-code
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

## What the pills show

| Pill | Meaning |
| --- | --- |
| `☀ ☁ ☂ ↯ 312k` | Context tokens. The weather worsens as the window fills (under 25%, 50%, 75%, then above). The small bars show how much each turn added; `▲ +27.4k` is the last one. |
| `◑ 5h`, `▦ 7d` | Plan usage. The solid part is what you used; the dashed part is the gap to the time elapsed in the window: grey while you are under pace, amber or red once you run ahead of it. `↻` is when the window resets. |
| `ϟ cache` | Share of the last prompt served from the cache and the time before it expires. Amber under 10 minutes, red once expired (with a `/compact` hint on a large context). |
| `¤ ≈ $` | Session cost so far; `❯ +$` is what the last prompt added. |
| `✻ agents` | Subagents running now. |

Usage percentages update with each API reply (every turn, or when a window moves a whole point); the time parts redraw every 15 seconds.

## Mod vs status line

| | Status line | This mod |
| --- | --- | --- |
| Data | JSON on stdin (`context_window`, `rate_limits`, `cost`) on every refresh | `$.session.usage()` and hook events, read at turn boundaries |
| Freshness | Updates often (on each change, plus `refreshInterval`) | Usage moves only with API replies; between turns it can lag behind the status line |
| Layout | Lines of ANSI text in a fixed slot | JSX (`Box`, `Text`, flexbox) in any UI slot, sized to the terminal |
| Logic | A stateless command run per refresh | Stateful in-process hooks: turn history, per-request cache hits, live subagent list |

In practice the status line was the more reliable source for these numbers, since it refreshed more regularly. The mod wins on what it can draw and compute: any layout JSX can compose, and data the status line JSON does not carry.

## Privacy

The mod reads only what Claude Code hands it (`$.session`, `$.agent`, `$.clock`, and the prompt caching environment variables). It has no network, file or process access and no dependencies.

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
