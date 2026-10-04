import type { Entry, History } from '../types'
import type { Language } from './render'

const FENCE: Record<Language, string> = { mermaid: 'mermaid', d2: 'd2', plantuml: 'plantuml' }

export function fenceBlock(language: Language, source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${FENCE[language]}\n${source}\n${fence}`
}

export function mermaidBlock(source: string): string {
  return fenceBlock('mermaid', source)
}

export function freeName(taken: ReadonlySet<string>, base: string, exts: readonly string[] = ['mmd', 'svg']): string {
  let name = base
  for (let n = 2; exts.some(ext => taken.has(`${name}.${ext}`)); n++) name = `${base}-${n}`
  return name
}

// Markdown's own bound: a longer text makes the engine refuse the whole pane.
export const MARKDOWN_LIMIT = 10_000
const SOURCE_BUDGET = 9_800

export function sourceView(source: string, language: Language = 'mermaid'): { text: string; isTruncated: boolean } {
  const whole = fenceBlock(language, source)
  if (whole.length <= MARKDOWN_LIMIT) return { text: whole, isTruncated: false }
  let kept = ''
  for (const line of source.split('\n')) {
    const next = kept ? `${kept}\n${line}` : line
    if (fenceBlock(language, next).length > SOURCE_BUDGET) break
    kept = next
  }
  return { text: fenceBlock(language, kept.replace(/\n+$/, '') || source.slice(0, SOURCE_BUDGET - 40)), isTruncated: true }
}

export function cleanTitle(title: string): string {
  return title.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function languageOf(entry: Entry): Language {
  return entry.language ?? 'mermaid'
}

// Versions are the entries that share a title (case and spacing aside).
export function versionInfo(h: History, entry: Entry): { n: number; of: number; older?: number; newer?: number } {
  const key = entry.title.toLowerCase()
  const same = h.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.title.toLowerCase() === key)
  const at = same.findIndex(({ e }) => e.id === entry.id)
  return { n: at + 1, of: same.length, older: same[at - 1]?.i, newer: same[at + 1]?.i }
}

export function revisePrompt(entry: Entry, request: string): string {
  const language = languageOf(entry)
  return [
    `Update the whiteboard diagram "${entry.title}": ${request.trim()}`,
    '',
    `Redraw it with the whiteboard draw tool, same title and language (${language}). Current source:`,
    '',
    fenceBlock(language, entry.source),
  ].join('\n')
}

export function gistMarkdown(entry: Entry): string {
  return `# ${entry.title}\n\n${fenceBlock(languageOf(entry), entry.source)}\n`
}

export type CommandPlan =
  | { kind: 'open' }
  | { kind: 'doctor' }
  | { kind: 'help' }
  | { kind: 'prompt'; text: string; note: string }

export const COMMAND_HINT = '[arch | flow <file or area> | schema | doctor]'

export function parseCommand(args: string): CommandPlan {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const target = rest.join(' ').trim()
  switch (word.toLowerCase()) {
    case '':
      return { kind: 'open' }
    case 'doctor':
      return { kind: 'doctor' }
    case 'arch':
      return {
        kind: 'prompt',
        note: 'Asking Claude to draw the architecture of this project.',
        text: "Explore this project and draw its architecture on the whiteboard: one clear C4-style or flowchart diagram of the main components and how they talk to each other. Use the whiteboard draw tool.",
      }
    case 'flow':
      return {
        kind: 'prompt',
        note: `Asking Claude to draw the flow of ${target || 'this project'}.`,
        text: target
          ? `Read ${target} and draw its main control flow on the whiteboard as a sequence diagram or flowchart. Use the whiteboard draw tool.`
          : "Find this project's main entry point and draw its main control flow on the whiteboard as a sequence diagram or flowchart. Use the whiteboard draw tool.",
      }
    case 'schema':
      return {
        kind: 'prompt',
        note: "Asking Claude to draw this project's data model.",
        text: "Find this project's data model (database schema, types or models) and draw it on the whiteboard as an ER or class diagram. Use the whiteboard draw tool.",
      }
    default:
      return { kind: 'help' }
  }
}

export function helpText(): string {
  return [
    '**/whiteboard** opens the pane. Subcommands:',
    '- `/whiteboard arch`: Claude draws this project\'s architecture',
    '- `/whiteboard flow <file or area>`: Claude draws a control flow',
    '- `/whiteboard schema`: Claude draws the data model',
    '- `/whiteboard doctor`: checks renderers, Claude Code version and setup',
  ].join('\n')
}

export type Check = { label: string; ok: boolean | null; detail: string }

export function formatDoctor(checks: readonly Check[]): string {
  const mark = (ok: boolean | null) => (ok === true ? '✓' : ok === false ? '✗' : '–')
  const failed = checks.filter(c => c.ok === false).length
  return [
    `**Whiteboard doctor**: ${failed === 0 ? 'all good' : `${failed} problem${failed === 1 ? '' : 's'}`}`,
    '',
    ...checks.map(c => `- ${mark(c.ok)} **${c.label}**: ${c.detail}`),
  ].join('\n')
}
