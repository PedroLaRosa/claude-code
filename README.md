# claude-code

My [Claude Code](https://code.claude.com/docs) mods, in one plugin marketplace. Each one installs on its own.

| Plugin | What it does |
| --- | --- |
| [dep-bouncer](mods/dep-bouncer) | Blocks agent package installs that are too fresh, too obscure, typosquats, or add install scripts. |
| [lazygit-popup](mods/lazygit-popup) | alt+g opens lazygit in a popup over Claude Code; ESC closes it. |
| [lens](mods/lens) | Runs tsc, your linters and a secret scan on every edit, and hands Claude what it broke in the same turn. |
| [model-cycle](mods/model-cycle) | Switch model, effort and ultracode with one keystroke; shows the model and effort in the footer. |
| [token-weather-usage](mods/token-weather-usage) | Colored pills above the prompt: context, 5h/7d limits, cache time left, session cost, running subagents. |

## Install

At the Claude Code prompt, install the one you want:

```
/plugin install <plugin> --marketplace PedroLaRosa/claude-code
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session. Some plugins need one more step, like a keybinding; their README says so.

From a shell:

```bash
claude plugin marketplace add PedroLaRosa/claude-code
claude plugin install <plugin>@pedro-la-rosa-mods
```

## Develop

```bash
git clone https://github.com/PedroLaRosa/claude-code ~/claude-code
claude --plugin-dir ~/claude-code/mods/<plugin>
```

Check a change with `claude plugin validate mods/<plugin>` and `claude plugin test mods/<plugin>`. A new plugin goes in `mods/<name>/` and gets an entry in `.claude-plugin/marketplace.json`; `claude plugin validate .` checks the marketplace.
