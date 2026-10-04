import { describe, expect, test } from 'claude-code/testing'

import { MARKDOWN_LIMIT, cleanTitle, freeName, mermaidBlock, sourceView } from './actions'
import { drawCall as draw, fakeHost, mountPane as mount, startSession } from './testkit'

const svgPathOf = (files: Map<string, string>) =>
  [...files.keys()].find(k => k.includes('/.claude/whiteboard/') && k.endsWith('.svg'))!
const MISSING_NOTE = { type: 'Text', text: /Render missing/ }

describe('actions', () => {
  test('freeName', () => {
    expect(freeName(new Set(), 'a')).toBe('a')
    expect(freeName(new Set(['a.mmd']), 'a')).toBe('a-2')
    expect(freeName(new Set(['a.svg', 'a-2.mmd']), 'a')).toBe('a-3')
  })

  test('mermaidBlock', () => {
    expect(mermaidBlock('graph TD')).toBe('```mermaid\ngraph TD\n```')
  })

  test('sourceView keeps short sources whole', () => {
    expect(sourceView('graph TD')).toEqual({ text: '```mermaid\ngraph TD\n```', isTruncated: false })
  })

  test('sourceView cuts long sources at a line under the Markdown limit', () => {
    const source = ['flowchart TD', ...Array.from({ length: 900 }, (_, i) => `  n${i} --> n${i + 1}`)].join('\n')
    const view = sourceView(source)
    expect(view.isTruncated).toBe(true)
    expect(view.text.length).toBeLessThanOrEqual(MARKDOWN_LIMIT)
    expect(view.text.startsWith('```mermaid\nflowchart TD\n')).toBe(true)
    expect(view.text.endsWith('\n```')).toBe(true)
    expect(view.text).not.toContain('\n\n```')
  })

  test('cleanTitle', () => {
    expect(cleanTitle('Bell\u0007Title\u001b[31m')).toBe('Bell Title [31m')
    expect(cleanTitle('  two\nlines\r\n ')).toBe('two lines')
  })

  test('a long source keeps the pane and its toolbar', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const source = ['flowchart TD', ...Array.from({ length: 900 }, (_, i) => `  n${i} --> n${i + 1}`)].join('\n')
    await draw($, 'Long', source)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Button', key: 'copy' })).toBeDefined()
    expect(((await ui.find({ type: 'Markdown' }))?.text ?? '').length).toBeLessThanOrEqual(MARKDOWN_LIMIT)
    expect(await ui.find({ type: 'Text', text: /Source truncated/ })).toBeDefined()
    await ui.unmount()
  })

  test('a title with control characters still draws', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const r = await draw($, 'Bell\u0007Title\nX', 'graph TD; A-->B')
    expect(r).toMatchObject({ result: "Drawn 'Bell Title X' (1/1)." })
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Button', key: 'copy' })).toBeDefined()
    await ui.unmount()
  })

  test('export that cannot write says so', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'RO', 'graph TD; A-->B')
    fake.denyWorkWrites = true
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'export' })
    expect(fake.toasts.at(-1)).toMatch(/^Export failed: .*EACCES/)
    await ui.unmount()
  })

  test('export writes .mmd and .svg, suffixing on collision', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Auth Flow', 'sequenceDiagram\n  A->>B: hi')
    fake.files.set('/work/diagrams/auth-flow.mmd', 'old')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'export' })
    expect(fake.files.get('/work/diagrams/auth-flow-2.mmd')).toBe('sequenceDiagram\n  A->>B: hi\n')
    expect(fake.files.get('/work/diagrams/auth-flow-2.svg')).toContain('<svg')
    expect(fake.toasts.at(-1)).toContain('diagrams/auth-flow-2')
    await ui.unmount()
  })

  test('export stays under diagrams/', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, '../../etc/passwd', 'graph TD; A-->B')
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'export' })
    const written = [...fake.files.keys()].filter(k => k.startsWith('/work/'))
    expect(written).toEqual(['/work/diagrams/etc-passwd.mmd', '/work/diagrams/etc-passwd.svg'])
    await ui.unmount()
  })

  test('copy puts the source on the clipboard', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'C', 'graph TD; A-->B')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'copy' })
    expect(fake.copies).toEqual(['graph TD; A-->B'])
    expect(fake.toasts.at(-1)).toBe('Copied the diagram source.')
    await ui.unmount()
  })

  test('open opens the SVG from the temp dir', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'O', 'graph TD; A-->B')
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'open' })
    expect(fake.opens).toEqual([svgPathOf(fake.files)])
    await ui.unmount()
  })

  test('missing render: note, then re-render restores it', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'M', 'graph TD; A-->B')
    const svg = svgPathOf(fake.files)
    fake.files.delete(svg)
    let ui = await mount($, 'desktop')
    expect(await ui.find(MISSING_NOTE)).toBeDefined()
    await ui.press({ key: 'rerender' })
    await ui.unmount()
    expect(fake.files.has(svg)).toBe(true)
    ui = await mount($, 'desktop')
    expect(await ui.find(MISSING_NOTE)).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })

  test('export without an SVG writes the .mmd and says so', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Gone', 'graph TD; A-->B')
    fake.files.delete(svgPathOf(fake.files))
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'export' })
    expect(fake.files.has('/work/diagrams/gone.mmd')).toBe(true)
    expect(fake.files.has('/work/diagrams/gone.svg')).toBe(false)
    expect(fake.toasts.at(-1)).toContain('SVG missing')
    await ui.unmount()
  })

  test('open with the render missing says so instead of opening', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'X', 'graph TD; A-->B')
    fake.files.delete(svgPathOf(fake.files))
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'open' })
    expect(fake.opens).toEqual([])
    expect(fake.toasts.at(-1)).toContain('Re-render')
    await ui.unmount()
  })
})
