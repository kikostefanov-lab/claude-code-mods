import { describe, expect, test } from 'claude-code/testing'

import {
  EMPTY_RECORD, IDLE, applyUsage, beatFor, classifyTool, fmtTokens, isKikoRecord, koLine, mmss, oneLine,
  opponentName, recordLine, spinnerKind, spinnerWord, statsText, updateRecord,
} from './round'

const fight = { ...IDLE, phase: 'fight' as const, n: 3, opponent: 'THE FLAKY TEST', startedAt: 0, tokensIn: 12_400, tokensOut: 2_100, reads: 3, writes: 2 }

describe('round', () => {
  test('opponentName', () => {
    expect(opponentName('fix the flaky auth test please')).toBe('THE FLAKY AUTH TEST')
    expect(opponentName('Can you refactor the Payment Service?')).toBe('THE REFACTOR PAYMENT SERVICE')
    expect(opponentName('Café menu broken')).toBe('THE CAFE MENU BROKEN')
    expect(opponentName('Think about what makes a good boxing nickname, then give me three')).toBe('THE GOOD BOXING NICKNAME')
    expect(opponentName('`x()` ??')).toBe('THE UNKNOWN BUG')
    expect(opponentName('')).toBe('THE UNKNOWN BUG')
    expect(opponentName('supercalifragilistic expialidocious antidisestablishmentarianism').length).toBeLessThanOrEqual(28)
  })

  test('classifyTool', () => {
    expect(classifyTool('Read', { file_path: '/a/b/app.ts' })).toEqual({ kind: 'in', label: 'app.ts' })
    expect(classifyTool('Grep', { pattern: 'TODO' })).toEqual({ kind: 'in', label: 'TODO' })
    expect(classifyTool('WebFetch', { url: 'https://docs.example.com/x' })).toEqual({ kind: 'in', label: 'docs.example.com' })
    expect(classifyTool('Edit', { file_path: '/a/fix.ts' })).toEqual({ kind: 'out', label: 'fix.ts' })
    expect(classifyTool('Write', { file_path: 'notes.md' })).toEqual({ kind: 'out', label: 'notes.md' })
    expect(classifyTool('Bash', { command: 'npm test' })).toEqual({ kind: 'dodge', label: 'Bash' })
    expect(classifyTool('mcp__gh__search_issues', {})).toEqual({ kind: 'in', label: 'search_issues' })
    expect(classifyTool('mcp__gh__create_issue', {})).toEqual({ kind: 'out', label: 'create_issue' })
    expect(classifyTool('Read', { file_path: '/x/a-really-long-file-name-here.tsx' }).label).toHaveLength(20)
  })

  test('beatFor counts and numbers beats', () => {
    const a = beatFor(fight, 'in', 'app.ts', 'Read')
    expect(a).toMatchObject({ reads: 4, writes: 2, seq: 1, mode: 'tool', beat: { id: 1, kind: 'chomp', label: 'app.ts' }, status: 'reading app.ts' })
    const b = beatFor(a, 'out', 'fix.ts', 'Edit')
    expect(b).toMatchObject({ writes: 3, seq: 2, beat: { id: 2, kind: 'punch' }, status: 'editing fix.ts' })
    expect(beatFor(b, 'dodge', 'Bash', 'Bash')).toMatchObject({ seq: 3, beat: { kind: 'dodge' }, status: 'running Bash' })
  })

  test('applyUsage adds a step', () => {
    const u = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, model: 'm' }
    // Cache reads are the conversation re-read, not new knowledge: KI counts what's new.
    expect(applyUsage(IDLE, u)).toMatchObject({ tokensIn: 110, tokensOut: 50 })
  })

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

  test('formatting', () => {
    expect(mmss(42_000)).toBe('0:42')
    expect(mmss(125_500)).toBe('2:05')
    expect(fmtTokens(950)).toBe('950')
    expect(fmtTokens(12_400)).toBe('12.4k')
    expect(fmtTokens(2_500_000)).toBe('2.5M')
    const rec = { ...EMPTY_RECORD, wins: 48, streak: 12, bestStreak: 12 }
    expect(recordLine(rec)).toBe('48-0 | streak 12')
    expect(koLine({ ...fight, endedAt: 42_000 }, rec))
      .toBe('K.O. ▸ Kiko beats THE FLAKY TEST in 0:42 · read 3 · wrote 2 · 12.4k in / 2.1k out · 48-0')
    expect(oneLine(fight)).toBe('ROUND 3 · KIKO vs. THE FLAKY TEST · KI 12.4k · KO 2.1k')
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
