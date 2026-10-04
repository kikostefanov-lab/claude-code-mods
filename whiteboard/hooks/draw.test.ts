import { describe, expect, test } from 'claude-code/testing'

import { MAX_INLINE_SVG, boardDirFrom, projectKey } from './render'
import { HOME, MMDC, SVG_OK, drawCall as draw, errorText, fakeHost, startSession } from './testkit'

const BOARD = boardDirFrom(HOME, projectKey('/work'))
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

  test('renders into the per-project board with the agreed argv, then removes the input file', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Argv', 'graph TD; A-->B')
    const argv = fake.spawns.at(-1)!
    expect(argv[0]).toBe(MMDC)
    expect(argv[2]).toMatch(new RegExp(`^${BOARD}/[a-z0-9]+-[0-9a-f]{6}\\.mmd$`))
    expect(argv.slice(3)).toEqual(['-o', argv[2]!.replace(/\.mmd$/, '.svg'), '-b', 'white', '-q', '--no-font-embed'])
    expect(fake.files.get(argv[4]!)).toBe(SVG_OK)
    expect(fake.files.has(argv[2]!)).toBe(false)
  })

  test('accepts the 0.1 `mermaid` argument', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const r = await $.tool.call({ tool: 'mcp__whiteboard__draw', title: 'Old', mermaid: 'graph TD; A-->B' } as never)
    expect(r).toMatchObject({ result: "Drawn 'Old' (1/1)." })
  })

  test('strips code fences', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Fenced', '```mermaid\ngraph TD; A-->B\n```')
    expect(fake.writes.find(w => w.path.endsWith('.mmd'))?.text).toBe('graph TD; A-->B')
  })

  test('syntax error comes back as an error, without the stack, and is not recorded', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'syntax'
    const r = await draw($, 'Broken', 'sequenceDiagram\n  A-->>')
    expect(errorText(r)).toContain('Parse error on line 2')
    expect(errorText(r)).not.toContain('Parser.parseError')
    expect([...fake.files.keys()].filter(k => k.startsWith(BOARD))).toEqual([])
    fake.mode = 'ok'
    const ok = await draw($, 'Fixed', 'sequenceDiagram\n  A->>B: hi')
    expect(ok).toMatchObject({ result: "Drawn 'Fixed' (1/1)." })
  })

  test('validates input', async ($, on) => {
    fakeHost(on)
    await startSession($)
    expect(errorText(await draw($, 'T', '   '))).toContain('source')
    expect(errorText(await draw($, '', 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'x'.repeat(81), 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'T', 42))).toContain('source')
    expect(errorText(await draw($, 'T', 'a -> b', 'graphviz'))).toContain('language')
  })

  test('missing mmdc gives the install hint', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'missing'
    expect(errorText(await draw($, 'T', 'graph TD; A-->B'))).toContain('npm i -g @mermaid-js/mermaid-cli')
  })

  test('a stopped render (timeout or interrupt) comes back as an error', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'stopped'
    expect(errorText(await draw($, 'Slow', 'graph TD; A-->B'))).toContain('longer than 20s or was interrupted')
  })

  test('locates via login shell', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    expect(fake.runs).toContainEqual(['/bin/zsh', '-lc', 'command -v mmdc'])
  })

  test('configured path skips the shell', { options: { mmdcPath: MMDC } }, async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    expect(fake.runs.some(r => r[2] === 'command -v mmdc')).toBe(false)
  })

  test('locates mmdc once and caches it', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'A', 'graph TD; A-->B')
    await draw($, 'B', 'graph TD; A-->B')
    expect(fake.runs.filter(r => r[2] === 'command -v mmdc')).toHaveLength(1)
  })

  test('a cached path that disappeared is looked up again', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'A', 'graph TD; A-->B')
    fake.files.delete(MMDC)
    fake.files.set('/new/bin/mmdc', '#!')
    fake.onPath.mmdc = '/new/bin/mmdc'
    const r = await draw($, 'B', 'graph TD; A-->B')
    expect(r).toMatchObject({ result: "Drawn 'B' (2/2)." })
    expect(fake.spawns.at(-1)![0]).toBe('/new/bin/mmdc')
  })

  test('falls back to the newest nvm install when the login shell finds nothing', async ($, on) => {
    const fake = fakeHost(on)
    delete fake.onPath.mmdc
    for (const v of ['v18.20.0', 'v22.9.0', 'v22.10.1']) fake.files.set(`${HOME}/.nvm/versions/node/${v}/bin/node`, '')
    fake.files.set(`${HOME}/.nvm/versions/node/v22.9.0/bin/mmdc`, '#!')
    fake.files.set(`${HOME}/.nvm/versions/node/v18.20.0/bin/mmdc`, '#!')
    await startSession($)
    const r = await draw($, 'Nvm', 'graph TD; A-->B')
    expect(r).toMatchObject({ result: "Drawn 'Nvm' (1/1)." })
    expect(fake.spawns.at(-1)![0]).toBe(`${HOME}/.nvm/versions/node/v22.9.0/bin/mmdc`)
  })

  test('oversized SVG is kept with a note', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.svg = `<svg>${'x'.repeat(MAX_INLINE_SVG + 1)}</svg>`
    const r = await draw($, 'Huge', 'graph TD; A-->B')
    expect(resultOf(r)).toMatch(/^Drawn 'Huge' \(1\/1\)\. The SVG is too large/)
  })

  test('a refused pane still reports the diagram as drawn', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.denyOpen = true
    const r = await draw($, 'Refused', 'graph TD; A-->B')
    expect(resultOf(r)).toMatch(/^Drawn 'Refused' \(1\/1\)\. The pane did not open/)
  })

  test('pane not placed', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.placePane = false
    const r = await draw($, 'Narrow', 'graph TD; A-->B')
    expect(resultOf(r)).toContain('/whiteboard')
  })
})
