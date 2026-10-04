// Test-kit findings: state is native; tool.call and command.run reach the plugin's hooks;
// tool.register and command.register have no implementation (stubbed here); an op stub
// answers { value } or { deny } (a stub that throws is skipped, not rejected); a
// streaming stub (process.spawn) is an async generator.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

const v = <T>(x: T) => ({ value: x })

export const MMDC = '/fake/bin/mmdc'
export const GH = '/fake/bin/gh'
export const HOME = '/Users/test'
export const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text y="20">ok</text></svg>'

// A PNG header for an 800x400 image: signature, IHDR length and type, width, height.
const u32 = (n: number) => String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
export const PNG_OK = `\x89PNG\r\n\x1a\n${u32(13)}IHDR${u32(800)}${u32(400)}\x08\x06\x00\x00\x00`

export type MmdcMode = 'ok' | 'syntax' | 'stopped' | 'missing'
export type Platform = 'darwin' | 'linux' | 'win32'
export type Fake = {
  clock: MockClock
  files: Map<string, string>
  store: Map<string, unknown>
  writes: Array<{ path: string; text: string }>
  runs: string[][]
  spawns: string[][]
  toasts: string[]
  copies: string[]
  opens: string[]
  panes: string[]
  prompts: string[]
  gists: string[]
  registered: string[]
  onPath: Record<string, string>
  mode: MmdcMode
  svg: string
  placePane: boolean
  denyOpen: boolean
  denyWorkWrites: boolean
  engineVersion: string
  surface: 'terminal' | 'desktop'
}

export type HostOptions = { platform?: Platform; env?: Record<string, string>; store?: Record<string, unknown> }

const ran = (stdout: string, exitCode = 0, stderr = '') =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

export function fakeHost(on: On, options: HostOptions = {}): Fake {
  const platform = options.platform ?? 'darwin'
  const fake = {
    files: new Map([[MMDC, '#!/usr/bin/env node'], [GH, '#!']]),
    store: new Map(Object.entries(options.store ?? {})), writes: [],
    runs: [], spawns: [], toasts: [], copies: [], opens: [], panes: [], prompts: [], gists: [], registered: [],
    onPath: { mmdc: MMDC, gh: GH },
    mode: 'ok', svg: SVG_OK, placePane: true, denyOpen: false, denyWorkWrites: false,
    engineVersion: '2.1.286', surface: 'desktop',
  } as Fake
  if (platform === 'darwin') fake.files.set('/System/Library/CoreServices/.keep', '')
  fake.clock = mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, {
    PATH: '/usr/bin:/bin', HOME,
    ...(platform === 'win32' ? { OS: 'Windows_NT', APPDATA: 'C:/Users/test/AppData/Roaming' } : {}),
    ...options.env,
  })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => v('sess-1'))
  on('session.cwd', () => v('/work'))
  on('session.root', () => v('/work'))
  on('session.surface', () => v(fake.surface))
  on('session.version', () => v({ version: fake.engineVersion, base: fake.engineVersion, builtAt: '' }))
  on('tool.register', ($, e) => { fake.registered.push(`tool:${e.name}`); return v({ tool: `mcp__whiteboard__${e.name}` }) })
  on('command.register', ($, e) => { fake.registered.push(`command:${e.name}`); return v(undefined) })
  on('prompt.submit', ($, e) => { fake.prompts.push(e.text); return { text: e.text } as never })

  on('store.get', ($, e) => v(fake.store.get(e.key)))
  on('store.set', ($, e) => { fake.store.set(e.key, e.value); return v(undefined) })
  on('store.delete', ($, e) => { fake.store.delete(e.key); return v(undefined) })
  on('store.keys', () => v([...fake.store.keys()]))

  on('fs.exists', ($, e) => v(
    (fake.mode !== 'missing' || e.path !== MMDC) &&
      (fake.files.has(e.path) || [...fake.files.keys()].some(k => k.startsWith(`${e.path}/`))),
  ))
  on('fs.write', ($, e) => {
    if (fake.denyWorkWrites && e.path.startsWith('/work/')) return { deny: `EACCES: ${e.path}` }
    fake.files.set(e.path, e.text)
    fake.writes.push({ path: e.path, text: e.text })
    return v(undefined)
  })
  on('fs.read', ($, e) => {
    const text = fake.files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return e.as === 'bytes' ? v({ base64: btoa(text) }) : v(text)
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
    const [cmd] = argv
    if (cmd === '/bin/zsh' || cmd === '/bin/bash' || cmd === 'where') {
      const bin = cmd === 'where' ? argv[1]! : argv[2]!.replace('command -v ', '')
      const found = fake.onPath[bin]
      return v(found ? ran(`${found}\n`) : ran('', 1))
    }
    if (cmd === 'open' || cmd === 'xdg-open') { fake.opens.push(argv[1]!); return v(ran('')) }
    if (cmd === 'cmd' && argv[2] === 'start') { fake.opens.push(argv[4]!); return v(ran('')) }
    if (cmd === 'rm' || (cmd === 'cmd' && argv[2] === 'del')) {
      for (const p of argv.slice(cmd === 'rm' ? 2 : 5)) fake.files.delete(p.replace(/\\/g, '/'))
      return v(ran(''))
    }
    if (cmd === GH && argv[1] === 'gist') {
      fake.gists.push(fake.files.get(argv[3]!) ?? '')
      return v(ran('https://gist.github.com/fake123\n'))
    }
    if (cmd === GH && argv[1] === 'auth') return v(ran('Logged in'))
    if (argv[1] === '--version' || argv[1] === '-version') return v(ran(`${cmd} 1.0.0\n`))
    return { deny: `unexpected command ${argv.join(' ')}` }
  })

  on('process.spawn', async function* ($, e) {
    const argv = [...e.argv]
    fake.spawns.push(argv)
    if (fake.mode === 'stopped') return v({ code: null, signal: 'SIGTERM' })
    if (fake.mode === 'syntax') {
      yield { stream: 'stderr' as const, text: "Error: Parse error on line 2:\n...A-->>\n------^\nExpecting 'TXT', got 'NEWLINE'\n" }
      yield { stream: 'stderr' as const, text: 'Parser.parseError (https://mermaid-cli-intercept.invalid/x.mjs:1:1)\n' }
      return v({ code: 1, signal: null })
    }
    const output = outputOf(argv)
    fake.files.set(output, output.endsWith('.png') ? PNG_OK : fake.svg)
    return v({ code: 0, signal: null })
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

// Where each renderer's argv says the output goes.
function outputOf(argv: string[]): string {
  if (argv.includes('-i')) return argv[argv.indexOf('-o') + 1]!
  const t = argv.find(a => /^-t(svg|png)$/.test(a))
  if (t) {
    const input = argv[argv.length - 1]!
    const dir = argv[argv.indexOf('-o') + 1]!
    const base = input.slice(input.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    return `${dir}/${base}.${t.slice(2)}`
  }
  return argv[argv.length - 1]!
}

export async function startSession($: { session: { start: (e: never) => Promise<unknown> } }): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
}

export function errorText(r: unknown): string | undefined {
  const x = r as { deny?: string; isError?: boolean; text?: string }
  return x.deny ?? (x.isError ? x.text : undefined)
}

export const PANE_PROPS = {
  title: 'Whiteboard', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}

export const mountPane = ($: any, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode') =>
  $.ui.mount({
    plugin: 'whiteboard', surface, component: 'Pane', requestId: 'whiteboard', props: PANE_PROPS,
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  })

export const drawCall = ($: any, title: unknown, source: unknown, language?: string) =>
  $.tool.call({ tool: 'mcp__whiteboard__draw', title, source, ...(language ? { language } : {}) } as never)
