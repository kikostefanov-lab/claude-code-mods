export function mermaidBlock(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}mermaid\n${source}\n${fence}`
}

export function freeName(taken: ReadonlySet<string>, base: string): string {
  let name = base
  for (let n = 2; taken.has(`${name}.mmd`) || taken.has(`${name}.svg`); n++) name = `${base}-${n}`
  return name
}

// Markdown's own bound: a longer text makes the engine refuse the whole pane.
export const MARKDOWN_LIMIT = 10_000
const SOURCE_BUDGET = 9_800

export function sourceView(source: string): { text: string; isTruncated: boolean } {
  const whole = mermaidBlock(source)
  if (whole.length <= MARKDOWN_LIMIT) return { text: whole, isTruncated: false }
  const lines = source.split('\n')
  let kept = ''
  for (const line of lines) {
    const next = kept ? `${kept}\n${line}` : line
    if (mermaidBlock(next).length > SOURCE_BUDGET) break
    kept = next
  }
  return { text: mermaidBlock(kept.replace(/\n+$/, '') || source.slice(0, SOURCE_BUDGET - 40)), isTruncated: true }
}

export function cleanTitle(title: string): string {
  return title.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
}
