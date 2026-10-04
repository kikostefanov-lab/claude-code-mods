export function mermaidBlock(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}mermaid\n${source}\n${fence}`
}
