import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_RECORD } from './record'
import { IDLE } from './round'
import { fmtTokens, koLine, mmss, spinnerKind, spinnerWord, statsText } from './words'

const fight = { ...IDLE, phase: 'fight' as const, n: 3, opponent: 'THE FLAKY TEST', startedAt: 0, tokensIn: 12_400, tokensOut: 2_100, reads: 3, writes: 2 }

describe('words', () => {
  test('formatting', () => {
    expect(mmss(42_000)).toBe('0:42')
    expect(mmss(125_500)).toBe('2:05')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(12_400)).toBe('12.4k')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
    const rec = { ...EMPTY_RECORD, wins: 48, streak: 12, bestStreak: 12 }
    expect(koLine({ ...fight, endedAt: 42_000 }, rec))
      .toBe('K.O. ▸ Kiko beats THE FLAKY TEST in 0:42 · read 3 · wrote 2 · 12.4k in / 2.1k out · 48-0')
    expect(statsText(rec)).toContain("record: 48-0")
  })

  test('spinner words', () => {
    expect(spinnerKind('thinking', fight)).toBe('thinking')
    expect(spinnerKind('tool-use', { ...fight, beat: { id: 1, kind: 'chomp', label: '' } })).toBe('in')
    expect(spinnerKind('tool-use', { ...fight, beat: { id: 1, kind: 'punch', label: '' } })).toBe('out')
    expect(spinnerKind('responding', fight)).toBe('responding')
    expect(spinnerKind('requesting', fight)).toBe('requesting')
    for (const kind of ['thinking', 'in', 'out', 'responding', 'tool', 'requesting'] as const) {
      expect(spinnerWord(kind, 1).length).toBeGreaterThan(3)
    }
    expect(spinnerWord('thinking', 1)).not.toBe(spinnerWord('thinking', 2))
  })
})
