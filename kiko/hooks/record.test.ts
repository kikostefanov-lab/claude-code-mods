import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_RECORD, isKikoRecord, recordLine, updateRecord } from './record'

describe('record', () => {
  test('updateRecord', () => {
    const one = updateRecord(EMPTY_RECORD, { ms: 42_000, tokens: 14_500, opponent: 'THE A' })
    expect(one).toEqual({ wins: 1, streak: 1, bestStreak: 1, fastestMs: 42_000, biggestTokens: 14_500, recent: ['THE A'] })
    let r = one
    for (let i = 0; i < 6; i++) r = updateRecord(r, { ms: 50_000, tokens: 10, opponent: `THE ${i}` })
    expect(r).toMatchObject({ wins: 7, streak: 7, bestStreak: 7, fastestMs: 42_000, biggestTokens: 14_500 })
    expect(r.recent).toEqual(['THE 5', 'THE 4', 'THE 3', 'THE 2', 'THE 1'])
    expect(isKikoRecord(r)).toBe(true)
    expect(isKikoRecord({ wins: 'x' })).toBe(false)
  })

  test('recordLine', () => {
    expect(recordLine({ ...EMPTY_RECORD, wins: 48, streak: 12, bestStreak: 12 })).toBe('48-0 | streak 12')
  })
})
