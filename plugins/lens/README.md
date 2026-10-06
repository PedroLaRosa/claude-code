# lens

A [Claude Code mod](https://code.claude.com/docs) that checks every file Claude edits. After each Edit or Write, it runs tsc and the linters your project uses, then puts what the edit broke into that same tool result. Claude sees a type error in the turn it caused it, not three tool calls later when a test fails.

It is the Claude Code version of [pi-lens](https://pi.dev/packages/pi-lens).

## What Claude sees

After an edit that changes a function signature:

```
[lens] src/a.ts: nothing new introduced in this file (biome, oxlint, tsc).
  (1 pre-existing in this file, not shown)
Errors this turn introduced in other files:
  error src/b.ts:2:25 Argument of type 'string' is not assignable to parameter of type 'number'. [tsc TS2345] #4429ff
Fix what this edit introduced before moving on. If a finding is wrong, call lens_diagnostic_mark with its #id.
```

After a clean edit: `[lens] src/b.ts: no new issues (biome, oxlint, tsc).`

Reports list only what the current turn introduced. Every tool runs once before Claude's first edit of a file in a turn, so the report can compare. Problems that were already there are counted, not listed.

## What it does

- **Warm tsc.** Each `tsconfig.json` gets one `tsc --noEmit --watch` for the session, so an edit costs an incremental check instead of a cold `tsc` run. A root `tsconfig.json` is warmed at session start. The watcher reports errors across the whole project, so an edit that breaks another file shows up as a cascade. A watcher with no TypeScript edit for 10 minutes is stopped.
- **Linters, run on the edited file.** A tool only runs when the project has it installed, and some also need its config file:

  | Files | Tools |
  |---|---|
  | JS/TS | eslint (with an eslint config), biome, oxlint (when in `node_modules`) |
  | CSS/SCSS/Less | stylelint (with a config) |
  | Python | ruff, pyright, mypy (with a mypy config); also found in `.venv/bin` |
  | Go | `go vet` on the package (with `go.mod`) |
  | Rust | `cargo clippy` on the crate (with `Cargo.toml`) |
  | Shell | shellcheck |
  | Ruby | rubocop (with `.rubocop.yml`) |
  | YAML / GitHub workflows | yamllint (with a config), actionlint |
  | Dockerfile | hadolint |

  You can add any other tool to `.lens.json` (see Config below).
- **Secret scan.** Every edited file is scanned for AWS, GitHub, Slack, Stripe, Google, Anthropic, OpenAI and npm tokens, and for private keys. A hit is an error, and its message shows only the first four characters. `.env` files are skipped.
- **Turn-end guard.** If a turn ends with errors it introduced, the mod sends Claude one follow-up prompt that lists them. It never sends a second one. The follow-up measures fixes against the code as it was before the turn started.
- **Tidy at turn end.** After a turn, the files it edited go through the project's fixers and formatters, in this order: `eslint --fix`, `biome check --write`, prettier, `ruff check --fix`, `ruff format`, gofmt, rustfmt. Each one runs only if the project configures it. This runs once at the end, never between edits, because a formatter running mid-change fights the edits still being made.
- **Git guard (off by default).** Denies `git commit` and `git push` while files the session edited still have errors.
- **Late results.** A tsc check that outlasts the hook's time budget is attached to the next tool result instead.
- **Status line.** Shows `lens ✗2 ⚠5` for current errors and warnings, or `lens ✓`.

### For Claude

- `lens_diagnostics`: with a `path`, checks that file now and lists every finding, old and new. Without one, lists everything the session has found.
- `lens_diagnostic_mark`: marks a finding by its `#id` as `false-positive` (hidden in this project from then on) or `defer` (hidden for this session).

### For you

- `/lens` lists every finding in the session. `/lens clear-marks` removes all false-positive and defer marks.
- `/lens-health` shows the tsc watchers, how often each runner ran and failed and its average time, tools that aren't installed, and recent degradations (crashes, timeouts, stopped watchers).

## Config

Three switches appear in `/config` under the plugin's options:

| Option | Default | What it does |
|---|---|---|
| `stopGuard` | on | Send Claude back once when a turn leaves errors it introduced |
| `tidy` | on | Run the configured fixers and formatters at turn end |
| `gitGuard` | off | Deny `git commit` and `git push` while edited files have errors |

Per project, add `.lens.json` at the root:

```json
{
  "disable": ["oxlint", "prettier", "tsc"],
  "runners": [
    { "id": "vale", "match": "\\.mdx?$", "argv": ["vale", "--output=line", "{file}"], "format": "gcc" }
  ]
}
```

- `disable` takes runner ids. Checkers: `tsc eslint biome oxlint stylelint ruff pyright mypy go-vet clippy shellcheck rubocop yamllint actionlint hadolint`. Fixers: `eslint-fix biome-fix prettier ruff-fix ruff-format gofmt rustfmt`.
- A runner's `format` is one of:
  - `gcc`: lines like `file:line:col: message`
  - `github`: `::error file=…,line=…::message`
  - `eslint`: ESLint's JSON output
- A runner's `cwd` is `"dir"` to run in the file's folder. Otherwise it runs in the project root.

A runner runs the command you give it, just as a hook in `.claude/settings.json` does. So only trust a `.lens.json` you would also trust as settings.

## Compared with pi-lens

| pi-lens | here |
|---|---|
| Per-edit LSP, linter and type-check diagnostics | Warm `tsc --watch`, plus the linters above, injected into the Edit/Write result |
| Delta mode (new diagnostics only) | Same: compared with the file before this turn's first edit |
| Cascade diagnostics | Errors tsc, `go vet` or clippy find in other files |
| Secrets in the write pipeline | Same, using token-shape patterns |
| Deferred autofix and format | Same: at turn end |
| Turn-end findings and blockers | One follow-up prompt per turn |
| Git guard | Same, off by default |
| `lens_diagnostics`, `lens_diagnostic_mark` | Same names; dispositions are `false-positive` and `defer` |
| `/lens-health` and its degradation ledger | Same |
| Widget and footer tally | Status line |
| Read-before-edit guard | Not needed: Claude Code's Edit already refuses a file Claude hasn't read |
| `lsp_navigation` | Not included: Claude Code has an LSP tool |
| ast-grep and tree-sitter rules, `module_report`, `read_symbol`, `/lens-map`, session-wide gitleaks/trivy/knip scans | Not included |

## Install

```
/plugin install lens --marketplace PedroLaRosa/claude-code-plugins
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

Requirements: Claude Code with mods (built on 2.1.291), plus whichever of the tools above your projects use.

## Hack on it

```bash
git clone https://github.com/PedroLaRosa/claude-code-plugins ~/claude-code-plugins
claude --plugin-dir ~/claude-code-plugins/plugins/lens
```

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`.

The tool table, output parsers and secret patterns live in `hooks/lens.ts`. The hooks, tsc watchers and turn state live in `hooks/register.ts`. Run the tests with `claude plugin test .`.

To type-check, run tsc with a bigger heap, because the engine's declarations are about 1.3 MB:

```bash
NODE_OPTIONS=--max-old-space-size=12288 tsc -p .
```

## Limits

- **Monorepos and project references:** tsc watches the nearest `tsconfig.json`. A solution-style `tsconfig` that only has `references` isn't followed. A file the `tsconfig` doesn't include gets no tsc check, but the report still lists `tsc` as having run.
- **Cold tsc start:** the hook never waits on a watcher's first full compile. That compile's results arrive with a later tool result.
- **Cost of the "before" run:** every checker runs once more before Claude's first edit of a file in a turn. If the file is unchanged since the last check, the cached result is reused.
- **Paths:** POSIX only. With a wide-scoped tool (`go vet`, clippy) and a symlinked project path, findings in the edited file may be shown as findings in other files.
- **When files are rescanned:** a tool or config installed mid-turn is picked up at the next prompt. Bash commands that edit files (`sed -i`) aren't checked directly, but the tsc watcher still sees their effect.
- **Subagents:** they get per-edit reports. A late tsc result may be attached to whichever agent makes the next tool call.
