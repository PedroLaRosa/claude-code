import type { EngineInterface, Register } from 'claude-code'

const MIN_AGE_MS = 72 * 3600_000
const MIN_WEEKLY_DOWNLOADS = 300
// A one-edit neighbour of a popular name is only suspicious while it is itself unpopular (preact vs react).
const TYPOSQUAT_EXEMPT_DOWNLOADS = 50_000
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall']

// ponytail: hand-picked top of npm; swap for a fetched top-N list if squats slip past it
const POPULAR = `react react-dom vue angular svelte next nuxt express koa fastify hono lodash underscore
axios node-fetch got request superagent chalk commander yargs inquirer debug dotenv cross-env uuid nanoid
moment dayjs date-fns luxon typescript ts-node tsx esbuild vite webpack rollup parcel babel-core
eslint prettier jest mocha vitest chai sinon cypress playwright puppeteer jquery bootstrap tailwindcss
postcss autoprefixer sass less styled-components emotion classnames clsx redux zustand mobx rxjs
graphql apollo-server prisma sequelize mongoose mongodb mysql mysql2 pg redis ioredis socket.io ws
cors body-parser cookie-parser helmet morgan jsonwebtoken bcrypt bcryptjs passport multer formidable
zod yup joi ajv glob minimatch rimraf mkdirp fs-extra chokidar semver colors ora execa shelljs
nodemon pm2 concurrently husky lint-staged sharp jimp cheerio jsdom marked highlight.js three d3
chart.js electron react-router react-router-dom react-query swr formik react-hook-form immer
openai stripe firebase aws-sdk twilio nodemailer winston pino bunyan async bluebird q
better-auth intercom-client lodash-es tslib core-js regenerator-runtime typeorm knex drizzle-orm`
  .split(/\s+/)

// Words that may sit before the package manager in a command segment.
const PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*|sudo|rtk|command|exec|time)$/
const VERBS: Record<string, string[]> = {
  npm: ['install', 'i', 'in', 'add'],
  pnpm: ['add', 'install', 'i'],
  yarn: ['add'],
  bun: ['add', 'install', 'i', 'a'],
}
// Flags whose next word is a value, not a package.
const VALUE_FLAGS = new Set(['--filter', '-F', '--workspace', '--registry', '--cwd', '-C', '--prefix', '--dir'])

type Spec = { name: string; want: string }
type Packument = {
  'dist-tags'?: Record<string, string>
  time?: Record<string, string>
  versions?: Record<string, { scripts?: Record<string, string> }>
}

/** Registry packages a Bash command would install via npm/pnpm/yarn/bun; [] when it installs none. */
export function installSpecs(command: string): Spec[] {
  const specs: Spec[] = []
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).map(w => w.replace(/^['"]|['"]$/g, ''))
    while (words.length && PREFIX.test(words[0]!)) words.shift()
    const verbs = VERBS[words.shift() ?? '']
    if (words[0] === 'global') words.shift() // yarn global add
    if (!verbs || !verbs.includes(words.shift() ?? '')) continue
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!
      if (VALUE_FLAGS.has(w)) i++
      else if (!w.startsWith('-')) {
        const spec = parseSpec(w)
        if (spec) specs.push(spec)
      }
    }
  }
  return specs
}

function parseSpec(word: string): Spec | undefined {
  const alias = word.indexOf('@npm:') // lodash@npm:whatever installs whatever
  if (alias > 0) word = word.slice(alias + 5)
  // ponytail: paths, URLs, git, workspace: and file: specs are not registry installs; not vetted
  if (!word || /^[.~/]|:/.test(word)) return
  const at = word.lastIndexOf('@')
  return at > 0 ? { name: word.slice(0, at), want: word.slice(at + 1) || 'latest' } : { name: word, want: 'latest' }
}

/** True when a and b differ by one insertion, deletion, substitution or adjacent swap. */
export function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (a[i] === b[i]) i++
  if (a.length === b.length)
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

const hasInstallScript = (doc: Packument, v: string | undefined) =>
  !!v && INSTALL_SCRIPTS.some(s => doc.versions?.[v]?.scripts?.[s])

const ago = (ms: number) => (ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3600_000)}h`)

/** Why `spec` should not be installed; [] when it may. */
export async function vet($: EngineInterface, { name, want }: Spec): Promise<string[]> {
  const path = name.replace('/', '%2f')
  // ponytail: full packument (the abbreviated one has no publish times); multi-MB for huge packages
  const [res, dl] = await Promise.all([
    $.http.fetch(`https://registry.npmjs.org/${path}`),
    $.http.fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`),
  ])
  if (res.status === 404)
    // A scoped 404 is most likely a private registry package; an unscoped one was probably hallucinated.
    return name.startsWith('@') ? [] : [`${name} does not exist on the npm registry.`]
  if (!res.ok) throw new Error(`registry answered ${res.status} for ${name}`)

  const doc = JSON.parse(res.text) as Packument
  const tags = doc['dist-tags'] ?? {}
  // ponytail: semver ranges resolve to `latest`, not max-satisfying; close enough for a gate
  const version = tags[want] ?? (doc.versions?.[want] ? want : tags.latest)
  if (!version) return [`${name} has no version matching "${want}".`]

  const reasons: string[] = []
  const now = await $.clock.now()
  const times = doc.time ?? {}
  const age = now - Date.parse(times[version] ?? '')
  if (age < MIN_AGE_MS) {
    const older = Object.keys(doc.versions ?? {})
      .filter(v => !v.includes('-') && now - Date.parse(times[v] ?? '') >= MIN_AGE_MS)
      .sort((a, b) => Date.parse(times[b]!) - Date.parse(times[a]!))[0]
    reasons.push(
      `${name}@${version} was published ${ago(age)} ago (under 72h).` +
        (older ? ` Pin an older release instead, e.g. ${name}@${older}.` : ''),
    )
  }

  const downloads = dl.ok ? ((JSON.parse(dl.text) as { downloads?: number }).downloads ?? 0) : 0
  if (downloads < MIN_WEEKLY_DOWNLOADS)
    reasons.push(`${name} has only ${downloads} weekly downloads (under ${MIN_WEEKLY_DOWNLOADS}).`)

  const bare = name.replace(/^@[^/]+\//, '')
  const twin = POPULAR.find(p => p !== name && oneEditApart(bare, p))
  if (twin && !POPULAR.includes(name) && downloads < TYPOSQUAT_EXEMPT_DOWNLOADS)
    reasons.push(`${name} is one edit away from the popular package "${twin}" (possible typosquat).`)

  const previous = Object.keys(doc.versions ?? {})
    .filter(v => v !== version && Date.parse(times[v] ?? '') < Date.parse(times[version] ?? ''))
    .sort((a, b) => Date.parse(times[b]!) - Date.parse(times[a]!))[0]
  if (hasInstallScript(doc, version) && !hasInstallScript(doc, previous))
    reasons.push(
      `${name}@${version} adds an install script (${INSTALL_SCRIPTS.filter(s => doc.versions?.[version]?.scripts?.[s]).join(', ')}) ` +
        (previous ? `that ${previous} did not have.` : 'in its first release.'),
    )
  return reasons
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const specs = installSpecs(e.command)
    if (!specs.length) return next(e)
    const verdicts = await Promise.all(specs.map(s => vet($, s)))
    const reasons = verdicts.flat()
    if (!reasons.length) return next(e)
    $.ui.toast(`dep-bouncer blocked: ${specs.map(s => s.name).join(', ')}`)
    return {
      deny:
        `dep-bouncer blocked this install:\n${reasons.map(r => `- ${r}`).join('\n')}\n` +
        `Double-check the package is the one you meant. If it is, ask the user to run the install themselves.`,
    }
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `dep-bouncer could not vet this install (registry unreachable?). Ask the user to run it themselves.` },
  )
}
