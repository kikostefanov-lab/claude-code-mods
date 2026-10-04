import { describe, expect, test } from 'claude-code/testing'

import { complete, fakeHost, startSession, step, stepSource } from './testkit'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} }

// What the band shows on the desktop, as text; '' when Kiko lets the engine draw it.
const bandText = async ($: any): Promise<string> => {
  const ui = await $.ui.mount({
    plugin: 'kiko', surface: 'desktop', component: 'AbovePrompt', props: BAND,
    viewport: { columns: 80, rows: 30, isFullscreen: true },
  })
  const code = await ui.find({ type: 'Code' })
  await ui.unmount()
  return code ? String(code.props.source) : ''
}

describe('fight', () => {
  test('a full round: bell, usage, chomp, punch, K.O., record', async ($, on) => {
    const fake = fakeHost(on)
    stepSource(on)
    await startSession($)
    expect(fake.registered).toContain('command:kiko')
    await $.turn.start({ text: 'fix the flaky auth test', turnId: 't1' })
    expect(await bandText($)).toContain('ROUND 1 ── FIGHT!')
    await fake.clock.advance(200 * 8)
    expect(await bandText($)).toContain('ROUND 1 ── KIKO vs. THE FLAKY AUTH TEST')

    const chunks = await step($, on, 't1')
    expect(chunks.map((c: any) => c.kind)).toEqual(['thinking', 'text', 'stop'])
    let band = await bandText($)
    expect(band).toMatch(/KI [█░]+ 100 /)
    expect(band).toMatch(/KO [█░]+ 40 /)
    expect(band).toContain('k i k o')

    await $.tool.call({ tool: 'Read', file_path: '/w/src/app.ts' } as never)
    expect(await bandText($)).toContain('[app.ts]')
    await $.tool.call({ tool: 'Edit', file_path: '/w/src/fix.ts', old_string: 'a', new_string: 'b' } as never)
    await fake.clock.advance(200 * 2)
    expect(await bandText($)).toContain('{fix.ts}')
    expect(fake.tools).toEqual(['Read', 'Edit'])

    await complete($, 't1')
    band = await bandText($)
    expect(band).toContain('K.O.!  Kiko beats THE FLAKY AUTH TEST')
    expect(band).toContain('read 1 | wrote 1 | 100 in / 40 out')
    expect(band).toContain('record 1-0 | streak 1')
    expect(fake.store.get('kiko:record')).toMatchObject({ wins: 1, streak: 1, recent: ['THE FLAKY AUTH TEST'] })

    await fake.clock.advance(5_000)
    expect(await bandText($)).toBe('')
  })

  test('aborted turn ends quietly', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'refactor billing', turnId: 't2' })
    await complete($, 't2', { isAborted: true, reason: 'aborted' })
    expect(await bandText($)).toBe('')
    expect(fake.store.get('kiko:record')).toBeUndefined()
  })

  test('error turn ends quietly', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'deploy', turnId: 't3' })
    await complete($, 't3', { reason: 'error' })
    expect(await bandText($)).toBe('')
    expect(fake.store.get('kiko:record')).toBeUndefined()
  })

  test('subagent events are ignored', async ($, on) => {
    const fake = fakeHost(on)
    stepSource(on)
    await startSession($)
    await $.turn.start({ text: 'main task', turnId: 'main' })
    await step($, on, 'sub', 'agent-1')
    // $.tool.call drops an agentId it is given, so a subagent's tool call can't be raised
    // from a test; the tool.call hook's isSub check is the same one these events take.
    await complete($, 'sub', { agentId: 'agent-1' })
    await fake.clock.advance(200 * 8)
    const band = await bandText($)
    expect(band).toContain('ROUND 1 ── KIKO vs. THE MAIN TASK')
    expect(band).toMatch(/KI [█░]+ 0 /)
    expect(fake.store.get('kiko:record')).toBeUndefined()
  })

  test('a missed turn.complete does not wedge Kiko', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'first problem', turnId: 'a' })
    await $.turn.start({ text: 'second problem', turnId: 'b' })
    await fake.clock.advance(200 * 8)
    expect(await bandText($)).toContain('ROUND 2 ── KIKO vs. THE SECOND PROBLEM')
    await $.turn.start({ text: 'second problem', turnId: 'b' })
    expect(await bandText($)).toContain('ROUND 2 ──')
  })

  test('the K.O. lands even when the engine fails to finish the turn', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'flaky deploy', turnId: 't5' })
    fake.completeFails = true
    await expect(complete($, 't5')).rejects.toBeDefined()
    expect(await bandText($)).toContain('K.O.!')
    expect(fake.store.get('kiko:record')).toMatchObject({ wins: 1 })
  })

  test('a corrupt saved record is left alone, not overwritten', async ($, on) => {
    const fake = fakeHost(on, { 'kiko:record': { wins: 'lots' } })
    await startSession($)
    await $.turn.start({ text: 'x y', turnId: 't6' })
    await complete($, 't6')
    expect(fake.store.get('kiko:record')).toEqual({ wins: 'lots' })
    expect(await bandText($)).toContain('K.O.!')
  })

  test('the stream passes through unchanged', async ($, on) => {
    fakeHost(on)
    stepSource(on)
    await startSession($)
    await $.turn.start({ text: 'x', turnId: 't4' })
    const chunks = await step($, on, 't4')
    expect(chunks).toEqual([
      { kind: 'thinking', index: 0, text: 'hmm' },
      { kind: 'text', index: 1, text: 'Done.' },
      { kind: 'stop', stopReason: 'end_turn', usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'm' } },
    ])
  })

  test('a new turn during the K.O. card starts round 2', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'one', turnId: 'a' })
    await complete($, 'a')
    await $.turn.start({ text: 'two things', turnId: 'b' })
    await fake.clock.advance(200 * 8)
    expect(await bandText($)).toContain('ROUND 2 ── KIKO vs. THE TWO THINGS')
  })
})
