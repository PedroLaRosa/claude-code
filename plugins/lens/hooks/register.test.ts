import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { customTool, parse, resolvePath, scanSecrets, splitMessage, tscLine } from './lens'

test('reads each tool output format', () => {
  const at = (out: string, source = 'x') => parse('gcc', out, '/p', source).map(d => [d.file, d.line, d.col, d.severity, d.rule, d.message])
  expect(at('src/main.rs:2:18: error[E0308]: mismatched types: expected `i32`, found `&str`')).toEqual([
    ['/p/src/main.rs', 2, 18, 'error', 'E0308', 'mismatched types: expected `i32`, found `&str`']])
  expect(at('vet: ./main.go:6:2: declared and not used: x\n# example.com/m', 'go-vet')).toEqual([
    ['/p/main.go', 6, 2, 'warning', undefined, 'declared and not used: x']])
  expect(at('s.sh:2:6: note: Double quote to prevent globbing and word splitting. [SC2086]')).toEqual([
    ['/p/s.sh', 2, 6, 'info', 'SC2086', 'Double quote to prevent globbing and word splitting.']])
  expect(at('  /abs/a.py:3:5 - error: Type "Literal[\'a\']" is not assignable to declared type "int"')).toEqual([
    ['/abs/a.py', 3, 5, 'error', undefined, 'Type "Literal[\'a\']" is not assignable to declared type "int"']])
  expect(at('a.py:1:8: F401 [*] `os` imported but unused')).toEqual([['/p/a.py', 1, 8, 'warning', 'F401', '`os` imported but unused']])
  expect(at('a.py:4:1: SyntaxError: Expected an expression')[0]?.[3]).toBe('error')
  expect(at('Dockerfile:1 DL3006 warning: Always tag the version of an image explicitly')).toEqual([
    ['/p/Dockerfile', 1, 1, 'warning', 'DL3006', 'Always tag the version of an image explicitly']])
  expect(at('a.yaml:1:1: [warning] missing document start "---" (document-start)')).toEqual([
    ['/p/a.yaml', 1, 1, 'warning', 'document-start', 'missing document start "---"']])
  expect(at('a.css:1:5: Unexpected unknown property "colr" (property-no-unknown) [error]')).toEqual([
    ['/p/a.css', 1, 5, 'error', 'property-no-unknown', 'Unexpected unknown property "colr"']])
  expect(at('/r/a.rb:1:1: C: Style/FrozenStringLiteralComment: Missing frozen string literal comment.')).toEqual([
    ['/r/a.rb', 1, 1, 'warning', 'Style/FrozenStringLiteralComment', 'Missing frozen string literal comment.']])
  expect(splitMessage('F841 Local variable `error` is assigned to but never used', 'warning').severity).toBe('warning')

  const gh = parse('github', [
    '::error title=lint/suspicious/noDoubleEquals,file=src/c.ts,line=2,endLine=2,col=9,endColumn=11::Using == may be unsafe.',
    '::warning file=src/c.ts,line=3,endLine=3,col=7,endColumn=13,title=eslint(no-unused-vars)::src/c.ts:3:7: Variable \'unused\' is declared but never used.',
    'lint ━━━━━━',
  ].join('\n'), '/p', 'biome')
  expect(gh.map(d => [d.file, d.line, d.col, d.severity, d.rule, d.message])).toEqual([
    ['/p/src/c.ts', 2, 9, 'error', 'lint/suspicious/noDoubleEquals', 'Using == may be unsafe.'],
    ['/p/src/c.ts', 3, 7, 'warning', 'eslint(no-unused-vars)', "Variable 'unused' is declared but never used."],
  ])

  const es = parse('eslint', JSON.stringify([{ filePath: '/p/a.ts', messages: [
    { ruleId: 'eqeqeq', severity: 2, message: "Expected '==='.", line: 2, column: 9 },
    { ruleId: null, severity: 1, message: 'File ignored because of a matching ignore pattern.' },
  ] }]), '/p', 'eslint')
  expect(es.map(d => [d.file, d.severity, d.rule])).toEqual([['/p/a.ts', 'error', 'eqeqeq']])
  expect(() => parse('eslint', 'Oops! Something went wrong', '/p', 'eslint')).toThrow()

  expect(tscLine("src/b.ts(2,25): error TS2345: Argument of type 'string' is not assignable.", '/p')).toEqual({
    file: '/p/src/b.ts', line: 2, col: 25, severity: 'error', message: "Argument of type 'string' is not assignable.", rule: 'TS2345', source: 'tsc' })
  expect(tscLine('5:17:49 PM - Found 1 error. Watching for file changes.', '/p')).toBeUndefined()
  expect(resolvePath('/a/b', '../c/./d.ts')).toBe('/a/c/d.ts')
})

test('flags secrets without echoing them', () => {
  const found = scanSecrets('const ok = 1\nconst key = "AKIAABCDEFGHIJKLMNOP"\n-----BEGIN RSA PRIVATE KEY-----', '/p/a.ts')
  expect(found.map(d => [d.line, d.rule])).toEqual([[2, 'aws-access-key'], [3, 'private-key']])
  expect(found[0]!.message).not.toMatch(/AKIAABCDEFGHIJKLMNOP/)
})

test('validates project runners', () => {
  const vale = customTool({ id: 'vale', match: '\\.md$', argv: ['vale', '--output=line', '{file}'] })
  expect([vale.bin, vale.argv(['/p/a.md']), vale.match.test('/p/a.md')]).toEqual(['vale', ['--output=line', '/p/a.md'], true])
  expect(() => customTool({ id: 'x', match: '.', argv: 'rm -rf /' })).toThrow(/argv of strings/)
})

// A small project on a virtual disk: eslint and tsc installed locally, a fake eslint that flags `==` (error) and
// `var` (warning), and a scripted `tsc --watch` that breaks b.ts whenever a.ts's greet takes a number.
const FILES: Record<string, string> = {
  '/repo/tsconfig.json': '{}',
  '/repo/eslint.config.js': 'export default []',
  '/repo/.prettierrc': '{}',
  '/repo/node_modules/.bin/eslint': '',
  '/repo/node_modules/.bin/tsc': '',
  '/repo/node_modules/.bin/prettier': '',
  '/repo/src/a.ts': 'var greet = (name: string) => name\n',
  '/repo/src/b.ts': "greet('bob')\n",
}

function world(on: On) {
  const disk = { ...FILES }
  const mtimes: Record<string, number> = {}
  const ran: string[][] = []
  const toasts: string[] = []
  const queue: string[] = []
  let pull: (() => void) | undefined
  const tsc = (...lines: string[]) => {
    queue.push(`${lines.join('\n')}\n`)
    pull?.()
  }
  const children = (dir: string) =>
    [...new Set(Object.keys(disk).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0]!))]

  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  on('session.root', () => ({ value: '/repo' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('fs.list', (_$, e) => {
    const names = children(e.path)
    if (!names.length) throw new Error('ENOENT')
    return { value: names.map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_$, e) => {
    if (!(e.path in disk)) throw new Error('ENOENT')
    return { value: disk[e.path]! }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in disk || children(e.path).length > 0 }))
  on('fs.stat', (_$, e) => {
    if (!(e.path in disk)) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: disk[e.path]!.length, mtimeMs: mtimes[e.path] ?? 0, isLink: false } }
  })
  on('process.run', (_$, e) => {
    ran.push([...e.argv])
    const [bin, ...args] = e.argv
    let stdout = ''
    if (bin === '/repo/node_modules/.bin/eslint' && args[0] === '--format') {
      const file = args.at(-1)!
      const text = disk[file] ?? ''
      stdout = JSON.stringify([{ filePath: file, messages: [
        ...(text.includes('var ') ? [{ ruleId: 'no-var', severity: 1, message: 'Unexpected var.', line: 1, column: 1 }] : []),
        ...(/[^=]==[^=]/.test(text) ? [{ ruleId: 'eqeqeq', severity: 2, message: "Expected '==='.", line: 2, column: 9 }] : []),
      ] }])
    }
    return { value: { exitCode: bin === 'which' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    tsc('1:00:00 PM - Starting compilation in watch mode...', '1:00:01 PM - Found 0 errors. Watching for file changes.')
    for (;;) {
      while (queue.length) yield { stream: 'stdout' as const, text: queue.shift()! }
      await new Promise<void>(resolve => (pull = resolve))
    }
  })
  on('tool.register', (_$, e) => ({ value: { tool: `mcp__claude-code-lens__${e.name}` } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, isImage: false } }))
  on('tool.call', { tool: 'Edit' }, (_$, e) => {
    disk[e.file_path] = disk[e.file_path]!.replace(e.old_string, e.new_string)
    mtimes[e.file_path] = (mtimes[e.file_path] ?? 0) + 1
    const a = disk['/repo/src/a.ts']!
    tsc('1:00:02 PM - File change detected. Starting incremental compilation...',
      ...(a.includes('name: number') ? ["src/b.ts(1,7): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."] : []),
      ...(a.includes('= 1 as string') ? ["src/a.ts(2,7): error TS2352: Conversion of type 'number' to type 'string' may be a mistake.",
        "  Type 'number' is not comparable to type 'string'."] : []),
      '1:00:03 PM - Found 0 errors. Watching for file changes.')
    return { result: { filePath: e.file_path, oldString: e.old_string, newString: e.new_string, originalFile: null,
      structuredPatch: [], userModified: false, replaceAll: false } }
  })
  return { disk, ran, toasts, clock, sent }
}

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  await $.turn.start({ text: 'refactor greet', turnId: 't1' })
}
const edit = ($: Engine, old_string: string, new_string: string) =>
  $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string, new_string })

test('an edit reports what it introduced, here and in other files, and nothing it did not', async ($, on) => {
  world(on)
  await start($)
  const done = await edit($, 'name: string) => name', 'name: number) => name == 1 ? "a" : "b"')
  const note = done.context?.join('\n') ?? ''
  expect(note).toMatch(/src\/a\.ts: 1 error introduced in this file \(eslint, tsc\)/)
  expect(note).toMatch(/error src\/a\.ts:2:9 Expected '==='\. \[eslint eqeqeq\] #[0-9a-f]{6}/)
  expect(note).toMatch(/\(1 pre-existing in this file, not shown\)/) // the `var` was there before
  expect(note).toMatch(/other files:\n {2}error src\/b\.ts:1:7 Argument of type 'string'.*\[tsc TS2345\]/)

  const clean = await edit($, 'name == 1', 'name === 1')
  expect(clean.context?.join('\n')).toMatch(/src\/a\.ts: .*introduced/) // b.ts is still broken this turn
  expect(clean.context?.join('\n')).not.toMatch(/eqeqeq/)
})

test('a clean edit says so, and multi-line tsc messages stay whole', async ($, on) => {
  world(on)
  await start($)
  const ok = await edit($, 'var greet', 'const greet')
  expect(ok.context).toEqual(['[claude-code-lens] src/a.ts: no new issues (eslint, tsc).'])
  const bad = await edit($, '=> name\n', '=> name\nconst n = 1 as string\n')
  expect(bad.context?.join('\n')).toMatch(/may be a mistake\. Type 'number' is not comparable to type 'string'\. \[tsc TS2352\]/)
})

test('a turn that leaves new errors sends Claude back once, and a mark releases it', async ($, on) => {
  const { ran, sent, clock } = world(on)
  await start($)
  const done = await edit($, 'name: string) => name', 'name: number) => name')
  const id = /TS2345\] #([0-9a-f]{6})/.exec(done.context?.join('\n') ?? '')![1]!
  const complete = () => $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await complete()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatch(/Your last turn left 1 error it introduced:\n {2}error src\/b\.ts:1:7/)

  // The follow-up turn keeps the original "before"; marking the error lets it end, once, and tidy runs then.
  await $.turn.start({ text: sent[0]!, turnId: 't2' })
  const marked = await $.tool.call({ tool: 'mcp__claude-code-lens__lens_diagnostic_mark', id, disposition: 'defer', reason: 'next PR' })
  expect(String(marked.result)).toMatch(/deferred for this session/)
  expect(ran.some(argv => argv.includes('--write'))).toBe(false)
  await complete()
  await clock.advance(0)
  expect(sent).toHaveLength(1)
  expect(ran.some(argv => argv.includes('--write'))).toBe(true)
})

test('the git guard holds commits while edited files have errors', { options: { gitGuard: true } }, async ($, on) => {
  world(on)
  await start($)
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m wip' })).deny).toBeUndefined()
  await edit($, 'name: string) => name', 'name: string) => name == "x"')
  expect((await $.tool.call({ tool: 'Bash', command: 'rtk git -C /repo commit -m wip' })).deny).toMatch(/holding this commit\/push/)
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
})

test('the turn ends with the project formatter over the files it edited', async ($, on) => {
  const { ran, clock } = world(on)
  await start($)
  await edit($, 'var greet', 'const greet')
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(0)
  expect(ran).toContainEqual(['/repo/node_modules/.bin/prettier', '--write', '--log-level', 'warn', '/repo/src/a.ts'])
})
