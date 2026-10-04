import { describe, expect, test } from 'claude-code/testing'

import { boardDirFrom, projectKey } from './render'
import { GH, HOME, MMDC, SVG_OK, drawCall as draw, fakeHost, mountPane as mount, startSession } from './testkit'

const BOARD = boardDirFrom(HOME, projectKey('/work'))
const STORE_KEY = `history:${projectKey('/work')}`
const run = ($: any, args: string) => $.command.run({ command: 'whiteboard', args } as never)
const textOf = (r: unknown) => (r as { text: string }).text

describe('doctor', () => {
  test('reports each check', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const text = textOf(await run($, 'doctor'))
    expect(text).toContain('✓ **Claude Code**')
    expect(text).toContain(`✓ **Mermaid (mmdc)**: ${MMDC}`)
    expect(text).toContain('– **D2 (d2)**: not found (optional)')
    expect(text).toContain('brew install d2')
    expect(text).toContain('✓ **Test render**')
    expect(text).toContain('✓ **GitHub CLI (for Share)**')
    expect(text).toContain(BOARD)
  })

  test('flags an old Claude Code and a missing mmdc', async ($, on) => {
    const fake = fakeHost(on)
    fake.engineVersion = '2.1.200'
    fake.mode = 'missing'
    await startSession($)
    const text = textOf(await run($, 'doctor'))
    expect(text).toContain('✗ **Claude Code**: 2.1.200')
    expect(text).toContain('✗ **Mermaid (mmdc)**')
    expect(text).toMatch(/problems/)
  })
})

describe('commands', () => {
  test('arch, flow and schema ask Claude to draw', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    expect(textOf(await run($, 'arch'))).toContain('architecture')
    await run($, 'flow src/app.ts')
    await run($, 'schema')
    expect(fake.prompts).toEqual([])
    await fake.clock.advance(1)
    expect(fake.prompts[0]).toContain('draw its architecture')
    expect(fake.prompts[1]).toContain('Read src/app.ts')
    expect(fake.prompts[2]).toContain('ER or class diagram')
  })

  test('unknown subcommand shows help', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    expect(textOf(await run($, 'frobnicate'))).toContain('/whiteboard arch')
    expect(fake.prompts).toEqual([])
  })

  test('an old Claude Code gets a toast at session start', async ($, on) => {
    const fake = fakeHost(on)
    fake.engineVersion = '2.1.200'
    await startSession($)
    expect(fake.toasts.join('\n')).toContain('built for Claude Code 2.1.286')
  })
})

describe('sharing and copying', () => {
  test('Copy MD copies a fenced block', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Flow', 'graph TD; A-->B')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'copyMd' })
    expect(fake.copies).toEqual(['```mermaid\ngraph TD; A-->B\n```'])
    await ui.unmount()
  })

  test('Share asks first, then creates a secret gist and copies the link', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Shared', 'graph TD; A-->B')
    let ui = await mount($, 'desktop')
    await ui.press({ key: 'share' })
    await ui.unmount()
    expect(fake.gists).toEqual([])
    ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /secret GitHub gist/ })).toBeDefined()
    await ui.press({ key: 'shareYes' })
    await ui.unmount()
    expect(fake.gists[0]).toContain('# Shared')
    expect(fake.gists[0]).toContain('```mermaid\ngraph TD; A-->B\n```')
    expect(fake.copies).toContain('https://gist.github.com/fake123')
    expect(fake.toasts.at(-1)).toContain('link copied')
    expect(fake.runs.find(r => r[0] === GH && r[1] === 'gist')).toEqual([GH, 'gist', 'create', expect.stringMatching(/shared\.md$/), '--desc', 'Shared'])
    ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /secret GitHub gist/ })).toBeUndefined()
    await ui.unmount()
  })

  test('Share can be cancelled', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Private', 'graph TD; A-->B')
    let ui = await mount($, 'terminal')
    await ui.press({ key: 'share' })
    await ui.unmount()
    ui = await mount($, 'terminal')
    await ui.press({ key: 'shareNo' })
    await ui.unmount()
    ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /secret GitHub gist/ })).toBeUndefined()
    await ui.unmount()
    expect(fake.gists).toEqual([])
  })

  test('Share without gh says how to get it', async ($, on) => {
    const fake = fakeHost(on)
    delete fake.onPath.gh
    fake.files.delete(GH)
    await startSession($)
    await draw($, 'NoGh', 'graph TD; A-->B')
    let ui = await mount($, 'desktop')
    await ui.press({ key: 'share' })
    await ui.unmount()
    ui = await mount($, 'desktop')
    await ui.press({ key: 'shareYes' })
    await ui.unmount()
    expect(fake.toasts.at(-1)).toContain('GitHub CLI')
  })
})

describe('versions and revisions', () => {
  test('redraws of a title are versions you can step through', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Auth', 'graph TD; A-->B')
    await draw($, 'auth', 'graph TD; A-->C')
    await draw($, 'Other', 'graph TD; X-->Y')
    let ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /^v\d+\/\d+$/ })).toBeUndefined()
    await ui.press({ key: 'prev' })
    await ui.unmount()
    ui = await mount($, 'desktop')
    expect((await ui.find({ type: 'Text', text: /^v\d+\/\d+$/ }))?.text).toBe('v2/2')
    await ui.press({ key: 'olderVersion' })
    await ui.unmount()
    ui = await mount($, 'desktop')
    expect((await ui.find({ type: 'Text', text: /^v\d+\/\d+$/ }))?.text).toBe('v1/2')
    expect((await ui.find({ type: 'Text', text: /^\d+\/\d+$/ }))?.text).toBe('1/3')
    await ui.unmount()
  })

  test('asking for a change sends Claude a prompt with the current source', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Flow', 'graph TD; A-->B')
    const ui = await mount($, 'desktop')
    await ui.input({ key: 'revise', text: 'make B a database' })
    expect(fake.prompts[0]).toContain('Update the whiteboard diagram "Flow": make B a database')
    expect(fake.prompts[0]).toContain('```mermaid\ngraph TD; A-->B\n```')
    expect(fake.toasts.at(-1)).toContain('Sent to Claude')
    await ui.input({ key: 'revise', text: '   ' })
    expect(fake.prompts).toHaveLength(1)
    await ui.unmount()
  })
})

describe('terminal images', () => {
  test('kitty-protocol terminals get a PNG', async ($, on) => {
    const fake = fakeHost(on, { env: { TERM_PROGRAM: 'ghostty' } })
    fake.surface = 'terminal'
    await startSession($)
    await draw($, 'Pic', 'graph TD; A-->B')
    expect(fake.spawns.some(a => a.some(x => x.endsWith('.png')))).toBe(true)
    const ui = await mount($, 'terminal')
    const image = await ui.find({ type: 'Image' })
    expect(image?.props).toMatchObject({ columns: 80, rows: 20, alt: 'Pic' })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  })

  test('other terminals render no PNG', async ($, on) => {
    const fake = fakeHost(on, { env: { TERM_PROGRAM: 'iTerm.app' } })
    fake.surface = 'terminal'
    await startSession($)
    await draw($, 'Pic', 'graph TD; A-->B')
    expect(fake.spawns.some(a => a.some(x => x.endsWith('.png')))).toBe(false)
  })
})

describe('persistence and cleanup', () => {
  test('history is saved per project', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Saved', 'graph TD; A-->B')
    const saved = fake.store.get(STORE_KEY) as { entries: Array<{ title: string }>; index: number }
    expect(saved.entries.map(e => e.title)).toEqual(['Saved'])
  })

  test('a new session picks the saved history up', async ($, on) => {
    const svgPath = `${BOARD}/old-1.svg`
    const fake = fakeHost(on, {
      store: { [STORE_KEY]: { entries: [{ id: 'old-1', title: 'From yesterday', source: 'graph TD; A-->B', svgPath, svgBytes: SVG_OK.length, createdAt: 1 }], index: 0 } },
    })
    fake.files.set(svgPath, SVG_OK)
    await startSession($)
    const ui = await mount($, 'desktop')
    expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.text === 'From yesterday')).toBe(true)
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })

  test('a corrupt saved history is ignored', async ($, on) => {
    fakeHost(on, { store: { [STORE_KEY]: { entries: 'nope' } } })
    await startSession($)
    const ui = await mount($, 'desktop')
    expect(await ui.find({ type: 'Text', text: /Claude draws here/ })).toBeDefined()
    await ui.unmount()
  })

  test('files of diagrams pushed out of history are removed', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    for (let i = 0; i < 21; i++) await draw($, `D${i}`, `graph TD; A${i}-->B`)
    const svgs = [...fake.files.keys()].filter(k => k.startsWith(BOARD) && k.endsWith('.svg'))
    expect(svgs).toHaveLength(20)
    expect(fake.runs.some(r => r[0] === 'rm')).toBe(true)
  })
})

describe('platforms', () => {
  test('linux uses bash and xdg-open', async ($, on) => {
    const fake = fakeHost(on, { platform: 'linux' })
    await startSession($)
    await draw($, 'L', 'graph TD; A-->B')
    expect(fake.runs).toContainEqual(['/bin/bash', '-lc', 'command -v mmdc'])
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'open' })
    expect(fake.runs.at(-1)![0]).toBe('xdg-open')
    await ui.unmount()
  })

  test('windows uses where and start', async ($, on) => {
    const fake = fakeHost(on, { platform: 'win32' })
    // The engine resolves a drive path against its own cwd on a POSIX test host, so the
    // fake uses a rooted path; locatedPath's own test covers `C:\\...` output.
    fake.onPath.mmdc = '/c/npm/mmdc.cmd'
    fake.files.set('/c/npm/mmdc.cmd', '@echo off')
    await startSession($)
    const r = await draw($, 'W', 'graph TD; A-->B')
    expect(r).toMatchObject({ result: "Drawn 'W' (1/1)." })
    expect(fake.runs).toContainEqual(['where', 'mmdc'])
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'open' })
    expect(fake.runs.at(-1)!.slice(0, 3)).toEqual(['cmd', '/c', 'start'])
    await ui.unmount()
  })
})

describe('themes and languages', () => {
  test('theme and Mermaid config reach mmdc', { options: { theme: 'dark', mermaidConfig: '/team/mermaid.json' } }, async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    const argv = fake.spawns.at(-1)!
    expect(argv).toContain('#1e1e1e')
    expect(argv.slice(-4)).toEqual(['-t', 'dark', '-c', '/team/mermaid.json'])
  })

  test('D2 diagrams render with d2 and export as .d2', async ($, on) => {
    const fake = fakeHost(on)
    fake.onPath.d2 = '/fake/bin/d2'
    fake.files.set('/fake/bin/d2', '#!')
    await startSession($)
    const r = await draw($, 'Net', 'a -> b', 'd2')
    expect(r).toMatchObject({ result: "Drawn 'Net' (1/1)." })
    expect(fake.spawns.at(-1)![0]).toBe('/fake/bin/d2')
    const ui = await mount($, 'terminal')
    expect((await ui.find({ type: 'Markdown' }))?.text.startsWith('```d2\n')).toBe(true)
    await ui.press({ key: 'export' })
    expect(fake.files.get('/work/diagrams/net.d2')).toBe('a -> b\n')
    expect(fake.files.has('/work/diagrams/net.svg')).toBe(true)
    await ui.unmount()
  })

  test('PlantUML diagrams render with plantuml', async ($, on) => {
    const fake = fakeHost(on)
    fake.onPath.plantuml = '/fake/bin/plantuml'
    fake.files.set('/fake/bin/plantuml', '#!')
    await startSession($)
    const r = await draw($, 'Seq', '@startuml\nA -> B\n@enduml', 'plantuml')
    expect(r).toMatchObject({ result: "Drawn 'Seq' (1/1)." })
    expect(fake.spawns.at(-1)!.slice(0, 2)).toEqual(['/fake/bin/plantuml', '-tsvg'])
  })

  test('a missing D2 says how to install it', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const r = await draw($, 'Net', 'a -> b', 'd2')
    expect((r as { deny?: string }).deny).toContain('brew install d2')
  })
})
