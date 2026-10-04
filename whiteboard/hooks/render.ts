import type { EngineInterface } from 'claude-code'

export const RENDER_TIMEOUT_MS = 20_000
export const MAX_INLINE_SVG = 131_072
export const MISSING_HINT =
  'mmdc (mermaid-cli) was not found. Install it with `npm i -g @mermaid-js/mermaid-cli`, or set the whiteboard plugin option `mmdcPath` to its absolute path.'

const PARSE_ERROR = /Parse error|Syntax error|Lexical error|No diagram type detected|UnknownDiagramError/i

export type RenderResult =
  | { ok: true; svgPath: string; svgBytes: number }
  | { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }

export function stripFences(text: string): string {
  const t = text.trim()
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(t)
  return (m ? m[2]! : t).trim()
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '/'
}

export async function boardDir($: EngineInterface): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  return `${tmp}/claude-whiteboard/${await $.session.id()}`
}

export async function locateMmdc($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.process.run(['/bin/zsh', '-lc', 'command -v mmdc'], { timeoutMs: 10_000 })
    const line = r.stdout.trim().split('\n').pop()?.trim() ?? ''
    return r.exitCode === 0 && line.startsWith('/') ? line : null
  } catch {
    return null
  }
}

export async function renderMermaid(
  $: EngineInterface,
  req: { source: string; dir: string; id: string; mmdcPath: string | null },
): Promise<RenderResult> {
  if (!req.mmdcPath || !(await $.fs.exists(req.mmdcPath))) {
    return { ok: false, kind: 'missing', message: MISSING_HINT }
  }
  const mmd = `${req.dir}/${req.id}.mmd`
  const svg = `${req.dir}/${req.id}.svg`
  await $.fs.write(mmd, req.source)

  const path = (await $.env.get('PATH')) ?? '/usr/bin:/bin'
  const home = await $.env.get('HOME')
  const env: Record<string, string> = { PATH: `${dirname(req.mmdcPath)}:${path}` }
  if (home) env.HOME = home

  let run
  try {
    run = await $.process.run([req.mmdcPath, '-i', mmd, '-o', svg, '-b', 'white', '-q'], {
      timeoutMs: RENDER_TIMEOUT_MS,
      env,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return /tim(e|ed) ?out|still running/i.test(msg)
      ? { ok: false, kind: 'timeout', message: `Rendering took longer than ${RENDER_TIMEOUT_MS / 1000}s and was stopped. Simplify the diagram or split it.` }
      : { ok: false, kind: 'failed', message: `mmdc could not run: ${msg}` }
  }

  if (run.exitCode !== 0) {
    const text = (run.stderr || run.stdout).trim().slice(0, 2000)
    return {
      ok: false,
      kind: PARSE_ERROR.test(text) ? 'syntax' : 'failed',
      message: text || `mmdc exited with code ${run.exitCode}.`,
    }
  }

  const stat = await $.fs.stat(svg).catch(() => undefined)
  if (!stat || stat.kind !== 'file') {
    return { ok: false, kind: 'failed', message: 'mmdc reported success but wrote no SVG.' }
  }
  return { ok: true, svgPath: svg, svgBytes: stat.size }
}
