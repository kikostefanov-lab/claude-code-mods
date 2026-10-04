import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'
import { EMPTY, add } from './history'
import {
  MAX_INLINE_SVG, MISSING_HINT, RENDER_TIMEOUT_MS, boardDirFrom, failureOf, locatedPath, mmdcArgv, mmdcEnv,
  rejectionOf, stripFences,
} from './render'
import type { RenderResult } from './render'

export const PANE = 'whiteboard'
export const TOOL = 'mcp__whiteboard__draw'

const history = atom({ plugin: 'whiteboard', key: 'history' } as const, EMPTY)
const mmdcPath = atom({ plugin: 'whiteboard', key: 'mmdcPath' } as const, null)

const DESCRIPTION = [
  "Draw a Mermaid diagram on the user's whiteboard pane, beside the conversation.",
  'Use it whenever a diagram explains a design, structure or process better than prose:',
  'UML class, sequence, state and ER diagrams, flowcharts, gantt charts, C4-style architecture.',
  'Pass the raw Mermaid source (no ``` fences) and a short title (at most 80 characters).',
  'The diagram is rendered before this tool returns: a Mermaid syntax error comes back as an error,',
  'so fix the source and call again. Earlier diagrams stay in the pane history.',
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80, description: 'Short title shown above the diagram.' },
    mermaid: {
      type: 'string',
      description: 'Mermaid source starting with the diagram type (sequenceDiagram, classDiagram, flowchart TD, ...).',
    },
  },
  required: ['title', 'mermaid'],
  additionalProperties: false,
}

async function newId($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('')
  return `${now.toString(36)}-${rand}`
}

async function boardDir($: EngineInterface): Promise<string> {
  return boardDirFrom(await $.env.get('TMPDIR'), await $.session.id())
}

async function locateMmdc($: EngineInterface): Promise<string | null> {
  const run = await $.process.run(['/bin/zsh', '-lc', 'command -v mmdc'], { timeoutMs: 10_000 }).catch(() => undefined)
  return run ? locatedPath(run) : null
}

async function renderMermaid(
  $: EngineInterface,
  req: { source: string; dir: string; id: string; mmdcPath: string | null },
): Promise<RenderResult> {
  if (!req.mmdcPath || !(await $.fs.exists(req.mmdcPath))) return { ok: false, kind: 'missing', message: MISSING_HINT }
  const mmd = `${req.dir}/${req.id}.mmd`
  const svg = `${req.dir}/${req.id}.svg`
  await $.fs.write(mmd, req.source)
  const env = mmdcEnv(req.mmdcPath, await $.env.get('PATH'), await $.env.get('HOME'))

  let run
  try {
    run = await $.process.run(mmdcArgv(req.mmdcPath, mmd, svg), { timeoutMs: RENDER_TIMEOUT_MS, env })
  } catch (err) {
    return rejectionOf(err)
  }
  if (run.exitCode !== 0) return failureOf(run)

  const stat = await $.fs.stat(svg).catch(() => undefined)
  if (!stat || stat.kind !== 'file') return { ok: false, kind: 'failed', message: 'mmdc reported success but wrote no SVG.' }
  return { ok: true, svgPath: svg, svgBytes: stat.size }
}

async function mmdcFor($: EngineInterface, configured: string): Promise<string | null> {
  if (configured) return configured
  const cached = await read($, mmdcPath)
  if (cached) return cached
  const found = await locateMmdc($)
  if (found) await update($, mmdcPath, () => found)
  return found
}

export const register: Register = (on, options) => {
  const configured = typeof options.mmdcPath === 'string' ? options.mmdcPath.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'draw', description: DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const args = e as unknown as { title?: unknown; mermaid?: unknown }
    const title = typeof args.title === 'string' ? args.title.trim() : ''
    const source = typeof args.mermaid === 'string' ? stripFences(args.mermaid) : ''
    if (!source) return { deny: 'draw needs `mermaid`: the Mermaid source of the diagram.' }
    if (!title || title.length > 80) return { deny: 'draw needs a `title` of 1 to 80 characters.' }

    const id = await newId($)
    const out = await renderMermaid($, { source, dir: await boardDir($), id, mmdcPath: await mmdcFor($, configured) })
    if (!out.ok) return { deny: out.message }

    const entry: Entry = { id, title, source, svgPath: out.svgPath, svgBytes: out.svgBytes, createdAt: await $.clock.now() }
    await update($, history, h => add(h ?? EMPTY, entry))
    const h = (await read($, history)) ?? EMPTY
    const at = h.entries.findIndex(x => x.id === id) + 1

    const opened = await $.ui.open({ id: PANE, title: 'Whiteboard' })
    const notes = [
      out.svgBytes > MAX_INLINE_SVG
        ? 'The SVG is too large to show inline: the pane shows its Mermaid source and an Open button. Consider splitting the diagram.'
        : '',
      opened.isPlaced ? '' : `The pane did not open (${opened.reason}); tell the user to run /whiteboard to see it.`,
    ].filter(Boolean)

    return { result: [`Drawn '${title}' (${at}/${h.entries.length}).`, ...notes].join(' ') }
  }).catch(() => ({ deny: 'The whiteboard hit an unexpected error while drawing. Try again; if it repeats, tell the user.' }))
}
