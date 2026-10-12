# claude-code

My whole [Claude Code](https://code.claude.com/docs) setup in one repo: mods, plugins, status bar and the rest of how I configure it.

Everything shared so far ships as a plugin marketplace, and each plugin installs on its own.

## Mods

| Plugin | What it does |
| --- | --- |
| [model-effort-switcher](mods/model-effort-switcher) | Switch model, effort and ultracode with one keystroke; shows the model and effort in the footer. |
| [dep-bouncer](mods/dep-bouncer) | Blocks agent package installs that are too fresh, too obscure, typosquats, or add install scripts. |
| [lens](mods/lens) | Runs tsc, your linters and a secret scan on every edit, and hands Claude what it broke in the same turn. |
| [lazygit-popup](mods/lazygit-popup) | alt+g opens lazygit in a popup over Claude Code; ESC closes it. Requires tmux. |
| [token-weather-usage](mods/token-weather-usage) | **Demo:** UI customization compared with the status line. Colored pills above the prompt: context, 5h/7d limits, cache time left, session cost, running subagents. |

## Status line

| Folder | What it does |
| --- | --- |
| [statusline-command](statusline-command) | My status line: git branch, context bar, prompt cache time left, session cost, and 5h/7d limit gauges that compare usage with time elapsed. |

Not a plugin: copy the script and point `statusLine` at it; its README has the steps.

## Install the mods

At the Claude Code prompt, install the one you want:

```
/plugin install <plugin> --marketplace PedroLaRosa/claude-code
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session. Some plugins need one more step, like a keybinding; their README says so.

From a shell:

```bash
claude plugin marketplace add PedroLaRosa/claude-code
claude plugin install <plugin>@pedro-la-rosa-claude-code
```

## Develop

```bash
git clone https://github.com/PedroLaRosa/claude-code ~/claude-code
claude --plugin-dir ~/claude-code/mods/<plugin>
```

Check a change with `claude plugin validate mods/<plugin>` and `claude plugin test mods/<plugin>`. A new plugin goes in `mods/<name>/` and gets an entry in `.claude-plugin/marketplace.json`; `claude plugin validate .` checks the marketplace.
