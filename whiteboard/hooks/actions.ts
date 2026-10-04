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
