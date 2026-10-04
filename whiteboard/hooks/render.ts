// Pure pieces of rendering. The engine follows `$` only into functions of the
// same file, so the calls themselves live in register.tsx.
import { slug } from './history'

export const RENDER_TIMEOUT_MS = 20_000
export const MAX_INLINE_SVG = 131_072
export const MIN_ENGINE = '2.1.286'

export type Language = 'mermaid' | 'd2' | 'plantuml'
export type Theme = 'default' | 'neutral' | 'dark' | 'forest'
export type Platform = 'darwin' | 'linux' | 'win32'
export type Format = 'svg' | 'png'

export const LANGUAGES: readonly Language[] = ['mermaid', 'd2', 'plantuml']
export const THEMES: readonly Theme[] = ['default', 'neutral', 'dark', 'forest']

export const RENDERERS: Record<Language, { bin: string; ext: string; label: string; install: string; versionArg: string }> = {
  mermaid: { bin: 'mmdc', ext: 'mmd', label: 'Mermaid', install: 'npm i -g @mermaid-js/mermaid-cli', versionArg: '--version' },
  d2: { bin: 'd2', ext: 'd2', label: 'D2', install: 'brew install d2 (or see https://d2lang.com)', versionArg: '--version' },
  plantuml: { bin: 'plantuml', ext: 'puml', label: 'PlantUML', install: 'brew install plantuml (needs Java)', versionArg: '-version' },
}

const SYNTAX_ERROR =
  /Parse error|Syntax error|Lexical error|No diagram type detected|UnknownDiagramError|^err:|\berr: |failed to compile/im

// A frame of the stack mmdc prints after the message: `    at fn (file:...)`
// or mermaid's own `Parser.parse (https://...)`.
const STACK_FRAME = /^\s+at\s|^[\w.$#]+ \((?:https?|file):\/\//

export type RenderFailure = { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }
export type RenderResult = { ok: true; path: string; bytes: number } | RenderFailure

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

export function themeOf(value: unknown): Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value) ? (value as Theme) : 'default'
}

export function missingHint(language: Language): string {
  const r = RENDERERS[language]
  const option = language === 'mermaid' ? ', or set the whiteboard plugin option `mmdcPath` to its absolute path' : ''
  return `${r.bin} (${r.label}) was not found. Install it with \`${r.install}\`${option}.`
}

export function stripFences(text: string): string {
  const t = text.trim()
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(t)
  return (m ? m[2]! : t).trim()
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : '/'
}

export function platformOf(env: { os: string | undefined; isMac: boolean }): Platform {
  return env.os === 'Windows_NT' ? 'win32' : env.isMac ? 'darwin' : 'linux'
}

export function lookupArgv(platform: Platform, bin: string): string[] {
  if (platform === 'win32') return ['where', bin]
  return [platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '-lc', `command -v ${bin}`]
}

export function openArgv(platform: Platform, path: string): string[] {
  if (platform === 'win32') return ['cmd', '/c', 'start', '""', path.replace(/\//g, '\\')]
  return [platform === 'darwin' ? 'open' : 'xdg-open', path]
}

export function removeArgv(platform: Platform, paths: readonly string[]): string[] {
  if (platform === 'win32') return ['cmd', '/c', 'del', '/f', '/q', ...paths.map(p => p.replace(/\//g, '\\'))]
  return ['rm', '-f', ...paths]
}

// Where a lookup may find a binary when the login shell cannot.
export function fallbackDirs(platform: Platform, home: string | undefined, appData: string | undefined): string[] {
  if (platform === 'win32') return appData ? [`${appData}/npm`] : []
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', ...(home ? [`${home}/.local/bin`] : [])]
}

export function binEnv(binPath: string, path: string | undefined, home: string | undefined, platform: Platform): Record<string, string> {
  const sep = platform === 'win32' ? ';' : ':'
  const env: Record<string, string> = { PATH: `${dirname(binPath)}${sep}${path ?? '/usr/bin:/bin'}` }
  if (home) env.HOME = home
  return env
}

export function boardDirFrom(home: string, projectKey: string): string {
  return `${home.replace(/[/\\]+$/, '')}/.claude/whiteboard/${projectKey}`
}

export function projectKey(root: string): string {
  let hash = 5381
  for (let i = 0; i < root.length; i++) hash = ((hash * 33) ^ root.charCodeAt(i)) >>> 0
  const base = root.split(/[/\\]/).filter(Boolean).pop() ?? 'root'
  return `${slug(base)}-${hash.toString(16).padStart(8, '0')}`
}

export function renderArgv(
  language: Language,
  req: { bin: string; input: string; output: string; dir: string; format: Format; theme: Theme; mermaidConfig: string },
): string[] {
  const dark = req.theme === 'dark'
  switch (language) {
    case 'mermaid':
      // --no-font-embed: mmdc 12 inlines ~160 KB of web fonts, which would push every
      // diagram past MAX_INLINE_SVG; text falls back to arial/sans-serif instead.
      return [
        req.bin, '-i', req.input, '-o', req.output, '-b', dark ? '#1e1e1e' : 'white', '-q', '--no-font-embed',
        ...(req.theme !== 'default' ? ['-t', req.theme] : []),
        ...(req.mermaidConfig ? ['-c', req.mermaidConfig] : []),
      ]
    case 'd2':
      return [req.bin, ...(dark ? ['--theme=200'] : []), '--pad=24', req.input, req.output]
    case 'plantuml':
      return [req.bin, `-t${req.format}`, ...(dark ? ['-darkmode'] : []), '-o', req.dir, req.input]
  }
}

export function failureOf(run: { exitCode: number | null; stderr: string; stdout: string }): RenderFailure {
  const lines = (run.stderr || run.stdout).trim().split('\n')
  const firstFrame = lines.findIndex(line => STACK_FRAME.test(line))
  const text = (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).join('\n').trim().slice(0, 2000)
  return {
    ok: false,
    kind: SYNTAX_ERROR.test(text) ? 'syntax' : 'failed',
    message: text || `The renderer exited with code ${run.exitCode}.`,
  }
}

export function stoppedFailure(): RenderFailure {
  return {
    ok: false,
    kind: 'timeout',
    message: `Rendering was stopped: it took longer than ${RENDER_TIMEOUT_MS / 1000}s or was interrupted. Simplify the diagram or split it.`,
  }
}

export function rejectionOf(err: unknown): RenderFailure {
  const msg = err instanceof Error ? err.message : String(err)
  return /tim(e|ed) ?out|still running/i.test(msg) ? stoppedFailure() : { ok: false, kind: 'failed', message: `The renderer could not run: ${msg}` }
}

export function locatedPath(run: { exitCode: number; stdout: string }): string | null {
  const abs = run.stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('/') || /^[A-Za-z]:\\/.test(l))
  return run.exitCode === 0 && abs.length > 0 ? abs[abs.length - 1]! : null
}

// Newest first: nvm folder names (v22.10.1) by numeric parts; anything else last.
export function byNewestVersion(a: string, b: string): number {
  const parts = (s: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1).map(Number)
  const pa = parts(a)
  const pb = parts(b)
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pb[i]! - pa[i]!
  return 0
}

export function isOlder(version: string, min: string): boolean {
  const parts = (s: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(s)?.slice(1).map(Number)) ?? null
  const v = parts(version)
  const m = parts(min)
  if (!v || !m) return false
  for (let i = 0; i < 3; i++) if (v[i] !== m[i]) return v[i]! < m[i]!
  return false
}

export function isKittyTerminal(env: { termProgram?: string; term?: string; kittyWindow?: string }): boolean {
  const program = (env.termProgram ?? '').toLowerCase()
  const term = (env.term ?? '').toLowerCase()
  return program === 'ghostty' || program === 'kitty' || term === 'xterm-kitty' || term === 'xterm-ghostty' || Boolean(env.kittyWindow)
}

// Width and height from a PNG's IHDR chunk (bytes 16-23), read off the first 32 base64 characters.
export function pngSize(base64: string): { width: number; height: number } | null {
  let bin: string
  try {
    bin = atob(base64.slice(0, 32))
  } catch {
    return null
  }
  if (bin.length < 24 || bin.slice(1, 4) !== 'PNG') return null
  const u32 = (o: number) => ((bin.charCodeAt(o) << 24) | (bin.charCodeAt(o + 1) << 16) | (bin.charCodeAt(o + 2) << 8) | bin.charCodeAt(o + 3)) >>> 0
  const width = u32(16)
  const height = u32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

// Terminal cells are about twice as tall as wide.
export function imageRows(width: number, height: number, columns: number): number {
  return Math.max(4, Math.min(60, Math.round(columns * (height / width) * 0.5)))
}
