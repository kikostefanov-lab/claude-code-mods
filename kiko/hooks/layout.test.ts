import { describe, expect, test } from 'claude-code/testing'

import { bar, fitRow, koCard, layout } from './layout'
import { IDLE } from './round'

const fight = { ...IDLE, phase: 'fight' as const, n: 3, opponent: 'THE FLAKY TEST', startedAt: 0, tokensIn: 12_400, tokensOut: 2_100, reads: 3, writes: 2, status: 'reading app.ts', record: '48-0 | streak 12' }
const view = (frame: number, beatStep: number | null = null) => ({ frame, beatStep, now: 42_000 })

describe('layout', () => {
  test('bar is log-scaled and exact width', () => {
    expect(bar(0, 10)).toBe('░'.repeat(10))
    expect(bar(200_000, 10)).toBe('█'.repeat(10))
    expect(bar(12_400, 10).length).toBe(10)
    expect(bar(12_400, 10).split('█').length).toBeGreaterThan(bar(100, 10).split('█').length)
  })

  test('fitRow pads and cuts', () => {
    expect(fitRow('abc', 5)).toBe('abc  ')
    expect(fitRow('abcdefg', 5)).toBe('abcde')
  })

  test('layout fits every width and shows the fight', () => {
    for (const columns of [20, 30, 40, 60, 80, 160, 200]) {
      const rows = layout(fight, view(0), columns)
      for (const row of rows) expect(row.length).toBe(columns)
    }
    const wide = layout(fight, view(0), 80)
    expect(wide).toHaveLength(6)
    expect(wide[0]).toContain('ROUND 3')
    expect(wide[0]).toContain('KIKO vs. THE FLAKY TEST')
    expect(wide[0]!.trimEnd().endsWith('0:42')).toBe(true)
    expect(wide[1]).toContain('KI ')
    expect(wide[1]).toContain('12.4k')
    expect(wide[5]).toContain('reading app.ts')
    expect(layout(fight, view(0), 40)).toHaveLength(6)
    expect(layout(fight, view(0), 25)).toHaveLength(2)
    expect(layout(fight, view(0), 80, 5)).toHaveLength(5)
  })

  test('beats show and then end', () => {
    const chomp = { ...fight, beat: { id: 1, kind: 'chomp' as const, label: 'app.ts' } }
    expect(layout(chomp, view(0, 0), 80).join('\n')).toContain('[app.ts]')
    expect(layout(chomp, view(9, null), 80).join('\n')).not.toContain('[app.ts]')
    const punch = { ...fight, beat: { id: 2, kind: 'punch' as const, label: 'fix.ts' } }
    expect(layout(punch, view(0, 2), 80).join('\n')).toContain('{fix.ts}')
    // The bag flashes on the hit, then swings away and back.
    expect(layout(punch, view(0, 3), 80).join('\n')).toContain('│░│')
    expect(layout(punch, view(0, 4), 80)[3]).not.toBe(layout(punch, view(0, 0), 80)[3])
    expect(layout(punch, view(0, null), 80).join('\n')).toContain('│█│')
    const bell = { ...fight, beat: { id: 3, kind: 'bell' as const, label: '' } }
    expect(layout(bell, view(0, 1), 80)[0]).toContain('FIGHT! ─')
    expect(layout(bell, view(0, null), 80)[0]).not.toContain('FIGHT!')
  })

  test('modes animate', () => {
    const thinking = { ...fight, mode: 'thinking' as const }
    const frames = new Set([0, 1, 2, 3].map(f => layout(thinking, view(f), 80).slice(2, 5).join('\n')))
    expect(frames.size).toBeGreaterThan(1)
  })

  test('K.O. card', () => {
    const card = koCard({ ...fight, phase: 'ko', endedAt: 42_000 }, 80)
    expect(card).toHaveLength(3)
    for (const row of card) expect(row.length).toBe(80)
    expect(card[0]).toContain('K.O.!  Kiko beats THE FLAKY TEST in 0:42')
    expect(card[1]).toContain('read 3 | wrote 2 | 12.4k in / 2.1k out')
    expect(card[2]).toContain('record 48-0 | streak 12')
    expect(koCard({ ...fight, phase: 'ko', endedAt: 42_000 }, 30).every(r => r.length === 30)).toBe(true)
  })
})
