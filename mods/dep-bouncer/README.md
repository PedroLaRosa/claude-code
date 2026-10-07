# dep-bouncer

A [Claude Code mod](https://code.claude.com/docs) that checks every package install before it runs. When the agent runs `npm`, `pnpm`, `yarn` or `bun` `add`/`install <pkg>`, the mod looks the package up on the npm registry first. If it looks risky, the install is denied and the agent gets a readable reason.

## Why

Agents install whatever they think they need, including packages that don't exist or that they misspelled. After the Axios, Intercom and Better-Auth supply-chain incidents this year, a check before every install is cheap insurance.

## What gets blocked

An install is denied, with every reason that applies, when:

- **Too new:** the version was published less than 72 hours ago. The reason suggests the newest release older than 72h to pin instead.
- **Too few downloads:** the package has fewer than 300 weekly downloads.
- **Possible typosquat:** the name is one typo away from a popular package (a letter added, dropped, changed or two swapped), and it has fewer than 50k weekly downloads itself. That second condition is so `preact` isn't flagged as a copy of `react`.
- **New install script:** the version adds a `preinstall`, `install` or `postinstall` script that the previous version didn't have.
- **Doesn't exist:** an unscoped package that isn't on npm, which usually means the name was hallucinated.

If the registry can't be reached, the install is denied rather than allowed through. A denied install tells the agent to ask you to run it yourself.

Example:

```
dep-bouncer blocked this install:
- fresh@2.0.0 was published 5h ago (under 72h). Pin an older release instead, e.g. fresh@1.0.0.
Double-check the package is the one you meant. If it is, ask the user to run the install themselves.
```

## Requirements

- **Claude Code with mods** (built on 2.1.291): the `claude` CLI, for `claude plugin` install
- **Network access** to `registry.npmjs.org` and `api.npmjs.org`

## Install

```bash
claude plugin marketplace add PedroLaRosa/claude-code
claude plugin install dep-bouncer@pedro-la-rosa-claude-code
```

Then run `/reload-plugins`.

## How it works

- **The hook:** a `tool.call` hook on Bash. It splits the command on `&&`, `||`, `;`, `|` and newlines, so `cd web && pnpm add foo` is caught. It also follows `foo@npm:bar` aliases to `bar`.
- **The lookup:** for each package, it fetches the full package metadata from `registry.npmjs.org` (for publish times and scripts) and last week's downloads from `api.npmjs.org`, in parallel.
- **The answer:** if nothing is wrong, the command runs as normal. Otherwise the hook returns a deny with the reasons, and a toast shows which packages were blocked.

## Hack on it

```bash
git clone https://github.com/PedroLaRosa/claude-code ~/claude-code
claude --plugin-dir ~/claude-code/mods/dep-bouncer
```

To load it in every session, add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`. The thresholds and the popular-names list are constants at the top of `hooks/register.ts`. Check changes with `claude plugin validate .` and `claude plugin test .`

## Limits

- **Private packages:** a scoped package that isn't on the public registry (e.g. one on a private registry) is let through without checks.
- **Version ranges:** a range like `^1.2` is checked against the `latest` version, not the highest version matching the range.
- **Not checked:** `npx`, git/URL/file installs, and the packages a dependency pulls in.
- **Popular-names list:** about 150 hand-picked packages, so typosquats of names outside it get past the typo check.
- **Large packages:** the full metadata is about 11MB for `@types/node`. It's one request per install.
