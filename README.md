# claude-code-plugins

My [Claude Code](https://code.claude.com/docs) mods, in one plugin marketplace. Each one installs on its own.

| Plugin | What it does |
| --- | --- |
| [dep-bouncer](plugins/dep-bouncer) | Blocks agent package installs that are too fresh, too obscure, typosquats, or add install scripts. |
| [lazygit-popup](plugins/lazygit-popup) | alt+g opens lazygit in a popup over Claude Code; ESC closes it. |
| [lens](plugins/lens) | Runs tsc, your linters and a secret scan on every edit, and hands Claude what it broke in the same turn. |
| [model-cycle](plugins/model-cycle) | Switch model, effort and ultracode with one keystroke; shows the model and effort in the footer. |
| [token-weather-usage](plugins/token-weather-usage) | Colored pills above the prompt: context, 5h/7d limits, cache time left, session cost, running subagents. |

## Install

At the Claude Code prompt, install the one you want:

```
/plugin install <plugin> --marketplace PedroLaRosa/claude-code-plugins
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session. Some plugins need one more step, like a keybinding; their README says so.

From a shell:

```bash
claude plugin marketplace add PedroLaRosa/claude-code-plugins
claude plugin install <plugin>@pedro-la-rosa-mods
```

## Develop

```bash
git clone https://github.com/PedroLaRosa/claude-code-plugins ~/claude-code-plugins
claude --plugin-dir ~/claude-code-plugins/plugins/<plugin>
```

Check a change with `claude plugin validate plugins/<plugin>` and `claude plugin test plugins/<plugin>`. A new plugin goes in `plugins/<name>/` and gets an entry in `.claude-plugin/marketplace.json`; `claude plugin validate .` checks the marketplace.
