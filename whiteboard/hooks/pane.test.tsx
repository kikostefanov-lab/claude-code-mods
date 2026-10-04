import { describe, expect, test } from 'claude-code/testing'

import { drawCall as draw, fakeHost, mountPane as mount, startSession } from './testkit'

const SURFACES = ['terminal', 'desktop'] as const
const POSITION = { type: 'Text', text: /^\d+\/\d+$/ }
const titleIs = async (ui: any, title: string) => (await ui.findAll({ type: 'Text' })).some((t: any) => t.text === title)

describe('pane', () => {
  test('empty state', async ($, on) => {
    fakeHost(on)
    await startSession($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /Claude draws here/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('desktop shows SVG, terminal shows source', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Flow', 'graph TD; A-->B')
    const desk = await mount($, 'desktop')
    expect(await desk.find({ type: 'Svg' })).toBeDefined()
    expect(await desk.find({ type: 'Markdown' })).toBeUndefined()
    await desk.unmount()
    const term = await mount($, 'terminal')
    expect((await term.find({ type: 'Markdown' }))?.text).toContain('graph TD; A-->B')
    expect(await term.find({ type: 'Svg' })).toBeUndefined()
    await term.unmount()
  })

  test('mobile draws the SVG and no text field', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Flow', 'graph TD; A-->B')
    const ui = await mount($, 'mobile')
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.unmount()
  })

  test('prev/next walk history and clamp', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'First', 'graph TD; A-->B')
    await draw($, 'Second', 'graph TD; C-->D')
    for (const surface of SURFACES) {
      let ui = await mount($, surface)
      expect((await ui.find(POSITION))?.text).toBe('2/2')
      expect(await titleIs(ui, 'Second')).toBe(true)
      await ui.press({ key: 'prev' })
      await ui.press({ key: 'prev' })
      await ui.unmount()
      ui = await mount($, surface)
      expect((await ui.find(POSITION))?.text).toBe('1/2')
      expect(await titleIs(ui, 'First')).toBe(true)
      await ui.press({ key: 'next' })
      await ui.unmount()
    }
  })

  test('fence longer than any backtick run', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Ticks', 'graph TD; A["```code```"]-->B')
    const ui = await mount($, 'terminal')
    const text = (await ui.find({ type: 'Markdown' }))?.text ?? ''
    expect(text.startsWith('````mermaid\n')).toBe(true)
    expect(text.endsWith('\n````')).toBe(true)
    await ui.unmount()
  })

  test('/whiteboard is registered and opens the pane', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    expect(fake.registered).toContain('command:whiteboard')
    const r = await $.command.run({ command: 'whiteboard', args: '' } as never)
    expect(fake.panes).toContain('whiteboard')
    expect(r).toMatchObject({ text: 'Whiteboard opened.' })
  })
})
