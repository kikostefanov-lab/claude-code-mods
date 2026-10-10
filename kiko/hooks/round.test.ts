import { describe, expect, test } from 'claude-code/testing'

import {
  IDLE, afterTool, applyUsage, beatFor, beatStepOf, classifyTool, freshSession, isFighting, knockOut, opponentName, startFight,
  stopFight, tick, withMode, withUsage,
} from './round'

const fight = { ...IDLE, phase: 'fight' as const, n: 3, opponent: 'THE FLAKY TEST', startedAt: 0, tokensIn: 12_400, tokensOut: 2_100, reads: 3, writes: 2 }

describe('round', () => {
  test('opponentName', () => {
    expect(opponentName('fix the flaky auth test please')).toBe('THE FLAKY AUTH TEST')
    expect(opponentName('Can you refactor the Payment Service?')).toBe('THE REFACTOR PAYMENT SERVICE')
    expect(opponentName('Café menu broken')).toBe('THE CAFE MENU BROKEN')
    expect(opponentName('Think about what makes a good boxing nickname, then give me three')).toBe('THE GOOD BOXING NICKNAME')
    expect(opponentName('`x()` ??')).toBe('THE UNKNOWN BUG')
    expect(opponentName('<task-notification>\n<summary>Background command "Watch CI" completed</summary>')).toBe('THE BACKGROUND COMMAND WATCH')
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
    // Labels land in fixed-width art: anything but printable ASCII becomes '?', so a
    // wide or split character can't push a row past the band.
    expect(classifyTool('Read', { file_path: '/x/日本語.md' }).label).toBe('???.md')
    expect(classifyTool('Grep', { pattern: 'x🚀y' }).label).toBe('x?y')
  })

  test('beatFor counts and numbers beats', () => {
    const a = beatFor(fight, 'in', 'app.ts', 'Read')
    expect(a).toMatchObject({ reads: 4, writes: 2, seq: 1, mode: 'tool', beat: { id: 1, kind: 'chomp', label: 'app.ts' }, status: 'reading app.ts' })
    const b = beatFor(a, 'out', 'fix.ts', 'Edit')
    expect(b).toMatchObject({ writes: 3, seq: 2, beat: { id: 2, kind: 'punch' }, status: 'editing fix.ts' })
    expect(beatFor(b, 'dodge', 'Bash', 'Bash')).toMatchObject({ seq: 3, beat: { kind: 'dodge' }, status: 'running Bash' })
  })

  test('beats start at the current frame and play for 6 frames', () => {
    const a = beatFor({ ...fight, frame: 10 }, 'in', 'app.ts', 'Read')
    expect(a.beatAt).toBe(10)
    expect(beatStepOf(a)).toBe(0)
    expect(beatStepOf({ ...a, frame: 15 })).toBe(5)
    expect(beatStepOf({ ...a, frame: 16 })).toBeNull()
    expect(beatStepOf({ ...fight, beat: null })).toBeNull()
  })

  test('tick advances a fight, ends a stale K.O. card, leaves idle alone', () => {
    expect(tick({ ...fight, frame: 4 }, 0)).toMatchObject({ frame: 5 })
    const ko = { ...fight, phase: 'ko' as const, endedAt: 1_000 }
    expect(tick(ko, 5_999)).toBeNull()
    expect(tick(ko, 6_000)).toMatchObject({ phase: 'idle' })
    expect(tick(IDLE, 0)).toBeNull()
  })

  test('applyUsage tolerates a partial usage', () => {
    expect(applyUsage(IDLE, { input_tokens: 5 } as never)).toMatchObject({ tokensIn: 5, tokensOut: 0 })
  })

  test('applyUsage adds a step', () => {
    const u = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10, model: 'm' }
    // Cache reads are the conversation re-read, not new knowledge: KI counts what's new.
    expect(applyUsage(IDLE, u)).toMatchObject({ tokensIn: 110, tokensOut: 50 })
  })

  test('a turn starts, moves and ends a round', () => {
    const r = startFight({ ...IDLE, n: 2, seq: 7 }, { turnId: 't1', opponent: 'THE A', now: 5, record: '1-0 | streak 1' })
    expect(r).toMatchObject({ phase: 'fight', n: 3, seq: 8, turnId: 't1', opponent: 'THE A', startedAt: 5, beat: { id: 8, kind: 'bell' } })
    expect(isFighting(r)).toBe(true)
    expect(isFighting(r, 't2')).toBe(false)
    expect(withMode(r, 't1', 'thinking')).toMatchObject({ mode: 'thinking', status: '' })
    expect(withMode(r, 't2', 'thinking')).toBe(r)
    expect(withUsage(r, 't1', { input_tokens: 5, output_tokens: 2 } as never)).toMatchObject({ tokensIn: 5, tokensOut: 2 })
    expect(withUsage(r, 't2', { input_tokens: 5 } as never)).toBe(r)
    expect(afterTool(beatFor(r, 'in', 'a.ts', 'Read'))).toMatchObject({ mode: 'requesting', status: '' })
    expect(afterTool(IDLE)).toBe(IDLE)
    expect(knockOut(r, 9, '2-0 | streak 2')).toMatchObject({ phase: 'ko', endedAt: 9, record: '2-0 | streak 2', status: 'K.O.!' })
    expect(stopFight(r).phase).toBe('idle')
    expect(freshSession(r, '2-0 | streak 2')).toEqual({ ...IDLE, n: 3, seq: 8, record: '2-0 | streak 2' })
  })
})
