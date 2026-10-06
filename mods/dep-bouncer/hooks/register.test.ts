import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'
import { installSpecs, oneEditApart } from './register'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3600_000).toISOString()

// name -> [packument, weekly downloads]
const REGISTRY: Record<string, [object, number]> = {
  lodash: [{ 'dist-tags': { latest: '4.17.21' }, time: { '4.17.20': iso(9000), '4.17.21': iso(8000) },
    versions: { '4.17.20': {}, '4.17.21': {} } }, 50_000_000],
  fresh: [{ 'dist-tags': { latest: '2.0.0' }, time: { '1.0.0': iso(500), '2.0.0': iso(5) },
    versions: { '1.0.0': {}, '2.0.0': {} } }, 90_000],
  lodahs: [{ 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': iso(900) }, versions: { '1.0.0': {} } }, 2_000],
  shady: [{ 'dist-tags': { latest: '1.1.0' }, time: { '1.0.0': iso(900), '1.1.0': iso(800) },
    versions: { '1.0.0': {}, '1.1.0': { scripts: { postinstall: 'node x.js' } } } }, 80_000],
  tiny: [{ 'dist-tags': { latest: '1.0.0' }, time: { '1.0.0': iso(900) }, versions: { '1.0.0': {} } }, 12],
}

function world(on: On) {
  mock.clock(on, { now: NOW })
  on('http.fetch', ($, e) => {
    const name = decodeURIComponent(e.url.split(/\.org\/(?:downloads\/point\/last-week\/)?/)[1]!)
    const hit = REGISTRY[name]
    if (!hit) return { value: { status: 404, ok: false, headers: {}, text: '{}' } }
    const body = e.url.includes('api.npmjs.org') ? { downloads: hit[1] } : hit[0]
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: 'installed', stderr: '', interrupted: false, isImage: false },
  }))
}

const run = async ($: Engine, command: string) =>
  $.tool.call({ tool: 'Bash', command })

test('parses install commands', () => {
  expect(installSpecs('cd web && pnpm add -D @scope/pkg@1.2.3 react')).toEqual([
    { name: '@scope/pkg', want: '1.2.3' },
    { name: 'react', want: 'latest' },
  ])
  expect(installSpecs('npm i --registry https://x lodash@npm:evil')).toEqual([{ name: 'evil', want: 'latest' }])
  expect(installSpecs('npm install')).toEqual([])
  expect(installSpecs('yarn add ./local git+https://x/y.git')).toEqual([])
  expect(installSpecs('echo npm install foo')).toEqual([])
})

test('one edit apart', () => {
  expect(oneEditApart('lodahs', 'lodash')).toBe(true)
  expect(oneEditApart('expres', 'express')).toBe(true)
  expect(oneEditApart('axois', 'axios')).toBe(true)
  expect(oneEditApart('lodash', 'lodash')).toBe(false)
  expect(oneEditApart('vue', 'vite')).toBe(false)
})

test('lets established packages and non-installs through', async ($, on) => {
  world(on)
  expect((await run($, 'npm install lodash')).deny).toBeUndefined()
  expect((await run($, 'ls -la')).deny).toBeUndefined()
  expect((await run($, 'pnpm add @private/thing')).deny).toBeUndefined()
})

test('blocks each risk with a readable reason', async ($, on) => {
  world(on)
  const cases: [string, RegExp][] = [
    ['npm i fresh', /published 5h ago.*fresh@1\.0\.0/],
    ['bun add tiny', /only 12 weekly downloads/],
    ['yarn add lodahs', /one edit away from the popular package "lodash"/],
    ['pnpm add shady', /adds an install script \(postinstall\) that 1\.0\.0 did not have/],
    ['npm install made-up-pkg', /does not exist on the npm registry/],
  ]
  for (const [command, reason] of cases) {
    const ran = await run($, command)
    expect(ran.deny).toMatch(reason)
  }
})
