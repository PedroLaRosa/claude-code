// The pure half of claude-code-lens: which tools run on which files, how their output parses,
// the secret patterns, and how a diagnostic is named. No `$` here, so the tests call it directly.

export type Severity = 'error' | 'warning' | 'info'
export type Diag = { file: string; line: number; col: number; severity: Severity; message: string; rule?: string; source: string }
export type Format = 'gcc' | 'github' | 'eslint'

export type Tool = {
  id: string
  match: RegExp
  /** The executable, looked up in node_modules/.bin, .venv/bin and venv/bin from the file's folder up, then on PATH. */
  bin: string
  /** Only a project-local install counts: the project chose this tool. */
  local?: true
  /** Config files, one of which must sit in the file's folder or above; `name#text` also needs `text` inside. */
  gate?: readonly string[]
  /** Where it runs: the gate file's folder, or the file's own; the session root otherwise. */
  cwd?: 'gate' | 'dir'
  /** Its diagnostics cover the whole folder it runs in (a Go package, a crate), not just the file. */
  wide?: true
  /** How its output reads. A tool without one is a fixer, run on the turn's files when the turn ends. */
  format?: Format
  /** The severity of a finding whose line names none. */
  severity?: Severity
  argv: (files: string[]) => string[]
}

const JS = /\.[cm]?[jt]sx?$/
const PY = /\.pyi?$/
const BIOME_EXT = /\.(?:[cm]?[jt]sx?|jsonc?|css|graphql)$/
const PRETTIER_EXT = /\.(?:[cm]?[jt]sx?|jsonc?|json5|css|scss|less|html|vue|mdx?|ya?ml|graphql)$/
export const TS = /\.(?:[cm]?ts|tsx)$/

const ESLINT = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts',
  'eslint.config.cts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
  'package.json#"eslintConfig"']
const PRETTIER = ['.prettierrc', '.prettierrc.json', '.prettierrc.json5', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
  '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs']
const STYLELINT = ['.stylelintrc', '.stylelintrc.json', '.stylelintrc.yml', '.stylelintrc.yaml', '.stylelintrc.js',
  '.stylelintrc.cjs', '.stylelintrc.mjs', 'stylelint.config.js', 'stylelint.config.cjs', 'stylelint.config.mjs']
const RUFF = ['ruff.toml', '.ruff.toml', 'pyproject.toml#[tool.ruff']
const BIOME = ['biome.json', 'biome.jsonc']

// tsc is not in the table: it runs as one warm `tsc --watch` per tsconfig (register.ts).
// ponytail: ~15 common tools; anything else goes in .claude-code-lens.json `runners`.
export const TOOLS: readonly Tool[] = [
  { id: 'eslint', match: JS, bin: 'eslint', local: true, gate: ESLINT, cwd: 'gate', format: 'eslint', argv: f => ['--format', 'json', ...f] },
  { id: 'biome', match: BIOME_EXT, bin: 'biome', local: true, format: 'github', argv: f => ['lint', '--reporter=github', ...f] },
  { id: 'oxlint', match: JS, bin: 'oxlint', local: true, format: 'github', argv: f => ['--format=github', ...f] },
  { id: 'stylelint', match: /\.(?:css|scss|less)$/, bin: 'stylelint', local: true, gate: STYLELINT, cwd: 'gate', format: 'gcc', argv: f => ['--formatter', 'unix', ...f] },
  { id: 'ruff', match: PY, bin: 'ruff', format: 'gcc', argv: f => ['check', '--output-format=concise', '--quiet', ...f] },
  { id: 'pyright', match: PY, bin: 'pyright', format: 'gcc', argv: f => f },
  { id: 'mypy', match: PY, bin: 'mypy', gate: ['mypy.ini', '.mypy.ini', 'pyproject.toml#[tool.mypy', 'setup.cfg#[mypy'], cwd: 'gate', format: 'gcc', severity: 'error',
    argv: f => ['--show-column-numbers', '--no-error-summary', '--no-color-output', ...f] },
  { id: 'go-vet', match: /\.go$/, bin: 'go', gate: ['go.mod'], cwd: 'dir', wide: true, format: 'gcc', severity: 'error', argv: () => ['vet', '.'] },
  { id: 'clippy', match: /\.rs$/, bin: 'cargo', gate: ['Cargo.toml'], cwd: 'gate', wide: true, format: 'gcc', argv: () => ['clippy', '--message-format=short', '--quiet'] },
  { id: 'shellcheck', match: /\.(?:sh|bash)$/, bin: 'shellcheck', format: 'gcc', argv: f => ['-f', 'gcc', ...f] },
  { id: 'rubocop', match: /\.rb$/, bin: 'rubocop', gate: ['.rubocop.yml'], cwd: 'gate', format: 'gcc', argv: f => ['--format', 'emacs', ...f] },
  { id: 'yamllint', match: /\.ya?ml$/, bin: 'yamllint', gate: ['.yamllint', '.yamllint.yml', '.yamllint.yaml'], cwd: 'gate', format: 'gcc', argv: f => ['-f', 'parsable', ...f] },
  { id: 'actionlint', match: /\/\.github\/workflows\/[^/]+\.ya?ml$/, bin: 'actionlint', format: 'gcc', severity: 'error', argv: f => ['-oneline', ...f] },
  { id: 'hadolint', match: /(?:^|\/)(?:Dockerfile|Containerfile)[^/]*$|\.dockerfile$/i, bin: 'hadolint', format: 'gcc', argv: f => ['--no-color', ...f] },
  // Fixers, in this order: safe fixes before formatting, so the formatter has the last word.
  { id: 'eslint-fix', match: JS, bin: 'eslint', local: true, gate: ESLINT, cwd: 'gate', argv: f => ['--fix', ...f] },
  { id: 'biome-fix', match: BIOME_EXT, bin: 'biome', local: true, gate: BIOME, cwd: 'gate', argv: f => ['check', '--write', ...f] },
  { id: 'prettier', match: PRETTIER_EXT, bin: 'prettier', local: true, gate: PRETTIER, cwd: 'gate', argv: f => ['--write', '--log-level', 'warn', ...f] },
  { id: 'ruff-fix', match: PY, bin: 'ruff', gate: RUFF, cwd: 'gate', argv: f => ['check', '--fix', '--quiet', ...f] },
  { id: 'ruff-format', match: PY, bin: 'ruff', gate: RUFF, cwd: 'gate', argv: f => ['format', '--quiet', ...f] },
  { id: 'gofmt', match: /\.go$/, bin: 'gofmt', argv: f => ['-w', ...f] },
  // ponytail: edition pinned to 2021; read it from Cargo.toml if a 2024-only syntax ever trips it
  { id: 'rustfmt', match: /\.rs$/, bin: 'rustfmt', gate: ['Cargo.toml'], cwd: 'gate', argv: f => ['--edition', '2021', ...f] },
]

/** A runner from `.claude-code-lens.json`; throws, naming what is wrong, on a malformed one. */
export function customTool(raw: unknown): Tool {
  const { id, match, argv, format = 'gcc', cwd } = (raw ?? {}) as Record<string, unknown>
  const isArgv = Array.isArray(argv) && argv.length > 0 && argv.every(a => typeof a === 'string')
  if (typeof id !== 'string' || typeof match !== 'string' || !isArgv || (format !== 'gcc' && format !== 'github' && format !== 'eslint'))
    throw new Error(`runner ${JSON.stringify(id)} needs an id, a match regex, an argv of strings and a format of gcc, github or eslint`)
  const [bin, ...rest] = argv as string[]
  return { id, match: new RegExp(match), bin: bin!, format, cwd: cwd === 'dir' ? 'dir' : undefined,
    argv: f => rest.map(a => a.replaceAll('{file}', f[0]!)) }
}

/** `p` made absolute against `base`, `.` and `..` resolved (POSIX paths). */
export function resolvePath(base: string, p: string): string {
  const parts: string[] = []
  for (const seg of (p.startsWith('/') ? p : `${base}/${p}`).split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return `/${parts.join('/')}`
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const SEV: Record<string, Severity> = {
  fatal: 'error', error: 'error', e: 'error', f: 'error',
  warning: 'warning', warn: 'warning', w: 'warning', c: 'warning', r: 'warning',
  note: 'info', info: 'info', information: 'info', hint: 'info', style: 'info',
}
// `path:line[:col]` then `: `, ` - ` (pyright) or a space (hadolint); go vet prefixes `vet: `.
const GCC = /^\s*(?:vet: )?(.+?):(\d+)(?::(\d+))?(?::\s*|\s+-\s+|\s+)(\S.*)$/
const TAIL = /\s+[[(]([^\]()\s]+)[\])]$/ // `[SC2086]`, `[assignment]`, `(document-start)`, stylelint's `[error]`
const LEAD_CODE = /^([A-Z]{1,8}\d{2,5})\s+/ // ruff `F401`, hadolint `DL3006`
const LEAD_SEV = /^\[?(fatal|error|warning|warn|note|info|information|hint|style)(?:\[([^\]]+)\])?\]?:?\s+/i // `error[E0308]:`, `[warning]`
const RUBOCOP = /^([CWREF]):\s+(?:([\w/]+):\s+)?/
const GITHUB = /^::(error|warning|notice)\s+(.*?)::(.*)$/
const TSC = /^(.+)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/

/** Peels a rule id and a severity off a gcc-style message, wherever the tool put them. */
export function splitMessage(text: string, fallback: Severity): { message: string; rule?: string; severity: Severity } {
  let message = text.trim()
  let rule: string | undefined
  let severity: Severity | undefined
  let m: RegExpExecArray | null
  for (let i = 0; i < 2 && (m = TAIL.exec(message)); i++) {
    const s = SEV[m[1]!.toLowerCase()]
    if (s) severity ??= s
    else rule ??= m[1]
    message = message.slice(0, m.index)
  }
  if ((m = LEAD_CODE.exec(message))) {
    rule ??= m[1]
    message = message.slice(m[0].length)
  }
  if ((m = LEAD_SEV.exec(message) ?? RUBOCOP.exec(message))) {
    severity ??= SEV[m[1]!.toLowerCase()]
    rule ??= m[2]
    message = message.slice(m[0].length)
  }
  if (/^SyntaxError\b/.test(message)) severity = 'error'
  return { message: message.replace(/^\[\*\]\s*/, ''), rule, severity: severity ?? fallback }
}

const unescapeGithub = (s: string) =>
  s.replace(/%0D/g, '\r').replace(/%0A/g, '\n').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%')

/** The diagnostics in one tool's output; paths made absolute against `cwd`. Throws on output that is not `format`. */
export function parse(format: Format, out: string, cwd: string, source: string, fallback: Severity = 'warning'): Diag[] {
  if (format === 'eslint') {
    type File = { filePath: string; messages: { ruleId: string | null; severity: number; message: string; line?: number; column?: number }[] }
    return (JSON.parse(out) as File[]).flatMap(f =>
      f.messages
        .filter(m => !m.message.startsWith('File ignored'))
        .map(m => ({ file: resolvePath(cwd, f.filePath), line: m.line ?? 1, col: m.column ?? 1,
          severity: m.severity === 2 ? 'error' as const : 'warning' as const, message: m.message, rule: m.ruleId ?? undefined, source })))
  }
  const diags: Diag[] = []
  for (const line of out.replace(ANSI, '').split(/\r?\n/)) {
    if (format === 'github') {
      const m = GITHUB.exec(line)
      if (!m) continue
      const props = Object.fromEntries(m[2]!.split(',').map(kv => [kv.slice(0, kv.indexOf('=')), unescapeGithub(kv.slice(kv.indexOf('=') + 1))]))
      if (!props.file || !props.line) continue
      diags.push({ file: resolvePath(cwd, props.file), line: Number(props.line), col: Number(props.col ?? 1),
        severity: m[1] === 'error' ? 'error' : m[1] === 'warning' ? 'warning' : 'info',
        message: unescapeGithub(m[3]!).replace(/^\S+:\d+:\d+: /, ''), rule: props.title, source })
      continue
    }
    const m = GCC.exec(line)
    if (m) diags.push({ file: resolvePath(cwd, m[1]!), line: Number(m[2]), col: Number(m[3] ?? 1), source, ...splitMessage(m[4]!, fallback) })
  }
  return diags
}

/** One `tsc --pretty false` diagnostic line, or undefined for any other line. */
export function tscLine(line: string, cwd: string): Diag | undefined {
  const m = TSC.exec(line.replace(ANSI, ''))
  if (!m) return
  return { file: resolvePath(cwd, m[1]!), line: Number(m[2]), col: Number(m[3]),
    severity: m[4] === 'error' ? 'error' : m[4] === 'warning' ? 'warning' : 'info', message: m[6]!, rule: m[5], source: 'tsc' }
}

// ponytail: high-precision token shapes only; no entropy scan, gitleaks covers that if the project wants it
const SECRETS: [string, RegExp][] = [
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['stripe-live-key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['private-key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
]

/** Credentials written into `text`; the message carries only the first four characters of one. */
export function scanSecrets(text: string, file: string): Diag[] {
  const diags: Diag[] = []
  text.split('\n').forEach((line, i) => {
    for (const [rule, re] of SECRETS) {
      const m = re.exec(line)
      if (!m) continue
      diags.push({ file, line: i + 1, col: m.index + 1, severity: 'error', rule, source: 'secrets',
        message: `possible ${rule.replaceAll('-', ' ')} (${m[0].slice(0, 4)}…) in source; load it from the environment instead` })
      break
    }
  })
  return diags
}

/** What a diagnostic is across edits: line numbers move, the rest does not. */
export const keyOf = (d: Diag) => `${d.file}\0${d.source}\0${d.rule ?? ''}\0${d.message}`

/** A short stable id (FNV-1a of the key) the model quotes to triage a diagnostic. */
export function idOf(d: Diag): string {
  let h = 0x811c9dc5
  for (const c of keyOf(d)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6)
}

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
export const bySeverity = (a: Diag, b: Diag) => RANK[a.severity] - RANK[b.severity] || a.file.localeCompare(b.file) || a.line - b.line

/** "2 errors, 1 warning". */
export function tally(diags: readonly Diag[]): string {
  const n = (s: Severity) => diags.filter(d => d.severity === s).length
  const part = (k: number, word: string) => (k ? `${k} ${word}${k === 1 ? '' : 's'}` : '')
  return [part(n('error'), 'error'), part(n('warning'), 'warning'), part(n('info'), 'note')].filter(Boolean).join(', ') || 'nothing'
}

/** One diagnostic as the model reads it. */
export const lineOf = (d: Diag, rel: (p: string) => string) =>
  `  ${d.severity} ${rel(d.file)}:${d.line}:${d.col} ${d.message.replace(/\s*\n\s*/g, ' ').slice(0, 300)} [${d.source}${d.rule ? ` ${d.rule}` : ''}] #${idOf(d)}`
