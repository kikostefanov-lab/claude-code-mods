// Pure pieces of rendering. The engine follows `$` only into functions of the
// same file, so the calls themselves live in register.tsx.

export const RENDER_TIMEOUT_MS = 20_000
export const MAX_INLINE_SVG = 131_072
export const MISSING_HINT =
  'mmdc (mermaid-cli) was not found. Install it with `npm i -g @mermaid-js/mermaid-cli`, or set the whiteboard plugin option `mmdcPath` to its absolute path.'

// A frame of the stack mmdc prints after the message: `    at fn (file:...)`
// or mermaid's own `Parser.parse (https://...)`.
const STACK_FRAME = /^\s+at\s|^[\w.$#]+ \((?:https?|file):\/\//

const PARSE_ERROR = /Parse error|Syntax error|Lexical error|No diagram type detected|UnknownDiagramError/i

export type RenderFailure = { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }
export type RenderResult = { ok: true; svgPath: string; svgBytes: number } | RenderFailure

export function stripFences(text: string): string {
  const t = text.trim()
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(t)
  return (m ? m[2]! : t).trim()
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '/'
}

export function boardDirFrom(tmpdir: string | undefined, sessionId: string): string {
  return `${(tmpdir ?? '/tmp').replace(/\/+$/, '')}/claude-whiteboard/${sessionId}`
}

// --no-font-embed: mmdc 12 inlines ~160 KB of web fonts, which would push every
// diagram past MAX_INLINE_SVG; text falls back to arial/sans-serif instead.
export function mmdcArgv(mmdcPath: string, mmd: string, svg: string): string[] {
  return [mmdcPath, '-i', mmd, '-o', svg, '-b', 'white', '-q', '--no-font-embed']
}

export function mmdcEnv(mmdcPath: string, path: string | undefined, home: string | undefined): Record<string, string> {
  const env: Record<string, string> = { PATH: `${dirname(mmdcPath)}:${path ?? '/usr/bin:/bin'}` }
  if (home) env.HOME = home
  return env
}

export function failureOf(run: { exitCode: number; stderr: string; stdout: string }): RenderFailure {
  const lines = (run.stderr || run.stdout).trim().split('\n')
  const firstFrame = lines.findIndex(line => STACK_FRAME.test(line))
  const text = (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).join('\n').trim().slice(0, 2000)
  return {
    ok: false,
    kind: PARSE_ERROR.test(text) ? 'syntax' : 'failed',
    message: text || `mmdc exited with code ${run.exitCode}.`,
  }
}

export function rejectionOf(err: unknown): RenderFailure {
  const msg = err instanceof Error ? err.message : String(err)
  return /tim(e|ed) ?out|still running/i.test(msg)
    ? { ok: false, kind: 'timeout', message: `Rendering took longer than ${RENDER_TIMEOUT_MS / 1000}s and was stopped. Simplify the diagram or split it.` }
    : { ok: false, kind: 'failed', message: `mmdc could not run: ${msg}` }
}

export function locatedPath(run: { exitCode: number; stdout: string }): string | null {
  const line = run.stdout.trim().split('\n').pop()?.trim() ?? ''
  return run.exitCode === 0 && line.startsWith('/') ? line : null
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
