// Test-kit findings: state is native; tool.call and command.run reach the plugin's hooks;
// tool.register and command.register have no implementation (stubbed here); an op stub
// answers { value } or { deny } (a stub that throws is skipped, not rejected).
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

const v = <T>(x: T) => ({ value: x })

export const MMDC = '/fake/bin/mmdc'
export const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text y="20">ok</text></svg>'

export type MmdcMode = 'ok' | 'syntax' | 'timeout' | 'missing'
export type Fake = {
  files: Map<string, string>
  runs: string[][]
  toasts: string[]
  copies: string[]
  opens: string[]
  panes: string[]
  registered: string[]
  mode: MmdcMode
  svg: string
  placePane: boolean
  denyOpen: boolean
  denyWorkWrites: boolean
  shellFindsMmdc: boolean
}

const ran = (stdout: string, exitCode = 0, stderr = '') =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

export function fakeHost(on: On): Fake {
  const fake: Fake = {
    files: new Map([[MMDC, '#!/usr/bin/env node']]),
    runs: [], toasts: [], copies: [], opens: [], panes: [], registered: [],
    mode: 'ok', svg: SVG_OK, placePane: true, denyOpen: false, denyWorkWrites: false, shellFindsMmdc: true,
  }
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, { TMPDIR: '/tmp/', PATH: '/usr/bin:/bin', HOME: '/Users/test' })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => v('sess-1'))
  on('session.cwd', () => v('/work'))
  on('tool.register', ($, e) => { fake.registered.push(`tool:${e.name}`); return v({ tool: `mcp__whiteboard__${e.name}` }) })
  on('command.register', ($, e) => { fake.registered.push(`command:${e.name}`); return v(undefined) })

  on('fs.exists', ($, e) => v(
    (fake.mode !== 'missing' || e.path !== MMDC) &&
      (fake.files.has(e.path) || [...fake.files.keys()].some(k => k.startsWith(`${e.path}/`))),
  ))
  on('fs.write', ($, e) => {
    if (fake.denyWorkWrites && e.path.startsWith('/work/')) return { deny: `EACCES: ${e.path}` }
    fake.files.set(e.path, e.text)
    return v(undefined)
  })
  on('fs.read', ($, e) => {
    const text = fake.files.get(e.path)
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : v(text)
  })
  on('fs.stat', ($, e) => {
    const text = fake.files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return v({ kind: 'file' as const, size: text.length, mtimeMs: 0, isLink: false })
  })
  on('fs.list', ($, e) => {
    const names = new Map<string, 'file' | 'dir'>()
    for (const k of fake.files.keys()) {
      if (!k.startsWith(`${e.path}/`)) continue
      const rest = k.slice(e.path.length + 1)
      const [first] = rest.split('/')
      names.set(first!, rest.includes('/') ? 'dir' : 'file')
    }
    return v([...names].map(([name, kind]) => ({
      name, kind, size: fake.files.get(`${e.path}/${name}`)?.length ?? 0, mtimeMs: 0, isLink: false,
    })))
  })

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    fake.runs.push(argv)
    if (argv[0] === '/bin/zsh') return v(fake.shellFindsMmdc ? ran(`${MMDC}\n`) : ran('', 1))
    if (argv[0] === 'open') { fake.opens.push(argv[1]!); return v(ran('')) }
    if (fake.mode === 'timeout') return { deny: 'process timed out after 20000 ms' }
    if (fake.mode === 'syntax') {
      return v(ran('', 1, "Error: Parse error on line 2:\n...A-->>\n------^\nExpecting 'TXT', got 'NEWLINE'"))
    }
    fake.files.set(argv[argv.indexOf('-o') + 1]!, fake.svg)
    return v(ran(''))
  })

  on('ui.open', ($, e) => {
    if (fake.denyOpen) return { deny: 'another plugin refused the pane' }
    fake.panes.push(e.id)
    return v(fake.placePane
      ? { isPlaced: true as const }
      : { isPlaced: false as const, reason: 'the terminal is narrower than 144 columns' })
  })
  on('ui.toast', ($, e) => { fake.toasts.push(e.text); return v(undefined) })
  on('ui.copy', ($, e) => { fake.copies.push(e.text); return v({ isCopied: true as const }) })

  return fake
}

export async function startSession($: { session: { start: (e: never) => Promise<unknown> } }): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
}


export function errorText(r: unknown): string | undefined {
  const x = r as { deny?: string; isError?: boolean; text?: string }
  return x.deny ?? (x.isError ? x.text : undefined)
}
