import { describe, expect, test } from 'claude-code/testing'

import { fakeHost, startSession } from './testkit'

// The band animates from the hooks module: a 200 ms tick advances the round's frame and
// the band draws the rows (Text on the terminal, one Code block elsewhere).
const BAND = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const mountBand = ($: any, surface: (typeof SURFACES)[number], columns = 80) => $.ui.mount({
  plugin: 'kiko', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns },
  viewport: { columns, rows: 30, isFullscreen: true },
})
const rowsOf = async (ui: any): Promise<string[]> => {
  const code = await ui.find({ type: 'Code' })
  if (code) return String(code.props.source).split('\n')
  return (await ui.findAll({ type: 'Text' })).map((t: any) => t.text as string)
}
const look = async ($: any, surface: (typeof SURFACES)[number], columns = 80) => {
  const ui = await mountBand($, surface, columns)
  const rows = await rowsOf(ui)
  await ui.unmount()
  return rows
}

describe('band animation', () => {
  test('terminal draws Text rows, other surfaces one fixed-width Code block', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'fix the flaky test', turnId: 't1' })
    let ui = await mountBand($, 'terminal')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' })).length).toBe(6)
    for (const t of await ui.findAll({ type: 'Text' })) expect(t.props.wrap).toBe('truncate')
    await ui.unmount()
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      ui = await mountBand($, surface)
      expect(String((await ui.find({ type: 'Code' }))?.props.source).split('\n')).toHaveLength(6)
      await ui.unmount()
    }
  })

  for (const surface of SURFACES) {
    test(`${surface}: rings the bell, then animates and plays beats`, async ($, on) => {
      const fake = fakeHost(on)
      await startSession($)
      await $.turn.start({ text: 'fix the flaky test', turnId: 't1' })
      expect((await look($, surface))[0]).toContain('FIGHT!')
      await fake.clock.advance(200 * 8)
      const after = await look($, surface)
      expect(after[0]).toContain('KIKO vs. THE FLAKY TEST')
      await fake.clock.advance(200)
      expect((await look($, surface)).slice(2, 5).join('\n')).not.toBe(after.slice(2, 5).join('\n'))
      await $.tool.call({ tool: 'Read', file_path: '/w/src/app.ts' } as never)
      expect((await look($, surface)).join('\n')).toContain('[app.ts]')
      await fake.clock.advance(200 * 8)
      expect((await look($, surface)).join('\n')).not.toContain('[app.ts]')
    })
  }

  test('the K.O. card and the fight band fit every width', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'x y z', turnId: 't1' })
    for (const columns of [40, 80, 160]) for (const row of await look($, 'terminal', columns)) expect(row.length).toBeLessThanOrEqual(columns)
    await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 4_000, isAborted: false, reason: 'answer' } as never)
    for (const columns of [40, 80, 160]) {
      const rows = await look($, 'desktop', columns)
      expect(rows).toHaveLength(3)
      expect(rows[0]).toContain('K.O.!')
      for (const row of rows) expect(row.length).toBeLessThanOrEqual(columns)
    }
  })

  test('nothing ticks while idle', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    const before = fake.store.size
    await fake.clock.advance(2_000)
    expect(fake.store.size).toBe(before)
    const ui = await mountBand($, 'desktop')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  })
})
