import { describe, expect, test } from 'claude-code/testing'

import { MAX_INLINE_SVG } from './render'
import { MMDC, SVG_OK, errorText, fakeHost, startSession } from './testkit'

const TOOL = 'mcp__whiteboard__draw'
const draw = ($: any, title: unknown, mermaid: unknown) => $.tool.call({ tool: TOOL, title, mermaid } as never)
const resultOf = (r: unknown) => (r as { result: string }).result

describe('draw', () => {
  test('renders, records and opens the pane', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    const r = await draw($, 'Login flow', 'sequenceDiagram\n  U->>S: login')
    expect(r).toMatchObject({ result: "Drawn 'Login flow' (1/1)." })
    expect(fake.panes).toEqual(['whiteboard'])
    expect(fake.registered).toContain('tool:draw')
    const r2 = await draw($, 'Second', 'graph TD; A-->B')
    expect(r2).toMatchObject({ result: "Drawn 'Second' (2/2)." })
  })

  test('renders into the per-session temp dir with the agreed argv', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Argv', 'graph TD; A-->B')
    const argv = fake.runs.at(-1)!
    expect(argv[0]).toBe(MMDC)
    expect(argv[1]).toBe('-i')
    expect(argv[2]).toMatch(/^\/tmp\/claude-whiteboard\/sess-1\/[a-z0-9]+-[0-9a-f]{6}\.mmd$/)
    expect(argv.slice(3)).toEqual(['-o', argv[2]!.replace(/\.mmd$/, '.svg'), '-b', 'white', '-q'])
    expect(fake.files.get(argv[2]!)).toBe('graph TD; A-->B')
    expect(fake.files.get(argv[4]!)).toBe(SVG_OK)
  })

  test('strips code fences', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Fenced', '```mermaid\ngraph TD; A-->B\n```')
    const mmd = [...fake.files.entries()].find(([k]) => k.endsWith('.mmd'))
    expect(mmd?.[1]).toBe('graph TD; A-->B')
  })

  test('syntax error comes back as an error and is not recorded', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'syntax'
    const r = await draw($, 'Broken', 'sequenceDiagram\n  A-->>')
    expect(errorText(r)).toContain('Parse error on line 2')
    fake.mode = 'ok'
    const ok = await draw($, 'Fixed', 'sequenceDiagram\n  A->>B: hi')
    expect(ok).toMatchObject({ result: "Drawn 'Fixed' (1/1)." })
  })

  test('validates input', async ($, on) => {
    fakeHost(on)
    await startSession($)
    expect(errorText(await draw($, 'T', '   '))).toContain('mermaid')
    expect(errorText(await draw($, '', 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'x'.repeat(81), 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'T', 42))).toContain('mermaid')
  })

  test('missing mmdc gives the install hint', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'missing'
    expect(errorText(await draw($, 'T', 'graph TD; A-->B'))).toContain('npm i -g @mermaid-js/mermaid-cli')
  })

  test('timeout comes back as an error', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'timeout'
    expect(errorText(await draw($, 'Slow', 'graph TD; A-->B'))).toContain('longer than 20s')
  })

  test('locates via login shell', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    expect(fake.runs[0]).toEqual(['/bin/zsh', '-lc', 'command -v mmdc'])
  })

  test('configured path skips the shell', { options: { mmdcPath: MMDC } }, async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    expect(fake.runs.some(r => r[0] === '/bin/zsh')).toBe(false)
  })

  test('locates mmdc once and caches it', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'A', 'graph TD; A-->B')
    await draw($, 'B', 'graph TD; A-->B')
    expect(fake.runs.filter(r => r[0] === '/bin/zsh')).toHaveLength(1)
  })

  test('oversized SVG is kept with a note', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.svg = `<svg>${'x'.repeat(MAX_INLINE_SVG + 1)}</svg>`
    const r = await draw($, 'Huge', 'graph TD; A-->B')
    expect(resultOf(r)).toMatch(/^Drawn 'Huge' \(1\/1\)\. The SVG is too large/)
  })

  test('pane not placed', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.placePane = false
    const r = await draw($, 'Narrow', 'graph TD; A-->B')
    expect(resultOf(r)).toContain('/whiteboard')
  })
})
