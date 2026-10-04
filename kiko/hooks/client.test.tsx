import { describe, expect, test } from 'claude-code/testing'

import { complete, fakeHost, startSession } from './testkit'

// Inline test plugins live in a temp folder and can't name ./kiko.tsx, so the Client is
// exercised through the real plugin's band, driven by real turn and tool events.
const BAND = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} }

const mountBand = ($: any, surface: 'terminal' | 'desktop', columns = 80) => $.ui.mount({
  plugin: 'kiko', surface, component: 'AbovePrompt', props: { ...BAND, bodyColumns: columns },
  viewport: { columns, rows: 30, isFullscreen: true },
})
const rowsOf = async (ui: any) => (await ui.findAll({ type: 'Text', in: 'kiko' })).map((t: any) => t.text as string)

describe('client', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`${surface}: rings the bell, then animates and plays beats`, async ($, on) => {
      fakeHost(on)
      await startSession($)
      await $.turn.start({ text: 'fix the flaky test', turnId: 't1' })
      const ui = await mountBand($, surface)
      expect((await rowsOf(ui))[0]).toContain('FIGHT!')
      await ui.advance(160 * 8)
      const after = await rowsOf(ui)
      expect(after[0]).toContain('KIKO vs. THE FLAKY TEST')
      const arenaA = after.slice(2, 5).join('\n')
      await ui.advance(160)
      expect((await rowsOf(ui)).slice(2, 5).join('\n')).not.toBe(arenaA)
      await $.tool.call({ tool: 'Read', file_path: '/w/src/app.ts' } as never)
      await ui.redraw()
      expect((await rowsOf(ui)).join('\n')).toContain('[app.ts]')
      await ui.advance(160 * 8)
      expect((await rowsOf(ui)).join('\n')).not.toContain('[app.ts]')
      await ui.unmount()
    })

    test(`${surface}: K.O. card fits every width`, async ($, on) => {
      fakeHost(on)
      await startSession($)
      await $.turn.start({ text: 'fix the flaky test', turnId: 't1' })
      await complete($, 't1')
      for (const columns of [40, 80, 160]) {
        const ui = await mountBand($, surface, columns)
        const rows = await rowsOf(ui)
        expect(rows).toHaveLength(3)
        expect(rows[0]).toContain('K.O.!')
        for (const row of rows) expect(row.length).toBeLessThanOrEqual(columns)
        await ui.unmount()
      }
    })

    test(`${surface}: the fight band fits every width`, async ($, on) => {
      fakeHost(on)
      await startSession($)
      await $.turn.start({ text: 'x y z', turnId: 't1' })
      for (const columns of [40, 80, 160]) {
        const ui = await mountBand($, surface, columns)
        for (const row of await rowsOf(ui)) expect(row.length).toBeLessThanOrEqual(columns)
        await ui.unmount()
      }
    })
  }
})
