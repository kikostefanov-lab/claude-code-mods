import { describe, expect, test } from 'claude-code/testing'

import { USAGE, complete, fakeHost, startSession, step, stepSource } from './testkit'

const roundOf = async ($: any) => {
  // Read through the band: the plugin's own read of its state, as drawn props.
  const ui = await $.ui.mount({
    plugin: 'kiko', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} },
    viewport: { columns: 80, rows: 30, isFullscreen: true },
  })
  const client = await ui.find({ type: 'Client' })
  await ui.unmount()
  return client?.props.props as Record<string, any> | undefined
}

describe('fight', () => {
  test('a full round: bell, chomp, punch, usage, K.O., record, notice', async ($, on) => {
    const fake = fakeHost(on)
    stepSource(on)
    await startSession($)
    expect(fake.registered).toContain('command:kiko')
    await $.turn.start({ text: 'fix the flaky auth test', turnId: 't1' })
    let r = await roundOf($)
    expect(r).toMatchObject({ phase: 'fight', n: 1, opponent: 'THE FLAKY AUTH TEST', beat: { kind: 'bell' } })

    const chunks = await step($, on, 't1')
    expect(chunks.map((c: any) => c.kind)).toEqual(['thinking', 'text', 'stop'])
    r = await roundOf($)
    expect(r).toMatchObject({ mode: 'responding', tokensIn: 1000, tokensOut: 40 })

    await $.tool.call({ tool: 'Read', file_path: '/w/src/app.ts' } as never)
    r = await roundOf($)
    expect(r).toMatchObject({ reads: 1, beat: { kind: 'chomp', label: 'app.ts' }, mode: 'requesting' })
    await $.tool.call({ tool: 'Edit', file_path: '/w/src/fix.ts', old_string: 'a', new_string: 'b' } as never)
    r = await roundOf($)
    expect(r).toMatchObject({ writes: 1, beat: { kind: 'punch', label: 'fix.ts' } })
    expect(fake.tools).toEqual(['Read', 'Edit'])

    await complete($, 't1')
    r = await roundOf($)
    expect(r).toMatchObject({ phase: 'ko', record: '1-0 | streak 1' })
    expect(fake.store.get('kiko:record')).toMatchObject({ wins: 1, streak: 1, recent: ['THE FLAKY AUTH TEST'] })

    await fake.clock.advance(5_000)
    expect(await roundOf($)).toBeUndefined()
  })

  test('aborted turn ends quietly', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'refactor billing', turnId: 't2' })
    await complete($, 't2', { isAborted: true, reason: 'aborted' })
    expect(await roundOf($)).toBeUndefined()
    expect(fake.store.get('kiko:record')).toBeUndefined()
  })

  test('error turn ends quietly', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'deploy', turnId: 't3' })
    await complete($, 't3', { reason: 'error' })
    expect(await roundOf($)).toBeUndefined()
  })

  test('subagent events are ignored', async ($, on) => {
    const fake = fakeHost(on)
    stepSource(on)
    await startSession($)
    await $.turn.start({ text: 'main task', turnId: 'main' })
    await $.turn.start({ text: 'sub task', turnId: 'sub' })
    await step($, on, 'sub', 'agent-1')
    // $.tool.call drops an agentId it is given, so a subagent's tool call can't be raised
    // from a test; the tool.call hook's isSub check is the same one these events take.
    await complete($, 'sub', { agentId: 'agent-1' })
    const r = await roundOf($)
    expect(r).toMatchObject({ phase: 'fight', n: 1, opponent: 'THE MAIN TASK', reads: 0, tokensIn: 0 })
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
      { kind: 'stop', stopReason: 'end_turn', usage: USAGE },
    ])
  })

  test('a new turn during the K.O. card starts round 2', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'one', turnId: 'a' })
    await complete($, 'a')
    await $.turn.start({ text: 'two things', turnId: 'b' })
    expect(await roundOf($)).toMatchObject({ phase: 'fight', n: 2, opponent: 'THE TWO THINGS' })
  })
})
