import { describe, expect, test } from 'claude-code/testing'

import { complete, fakeHost, startSession } from './testkit'

const BAND = { hasSurvey: false, isWorking: true, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} }
const SPIN = { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }

const mountBand = ($: any, surface = 'desktop') => $.ui.mount({
  plugin: 'kiko', surface, component: 'AbovePrompt', props: BAND, viewport: { columns: 80, rows: 30, isFullscreen: true },
})
const mountSpinner = ($: any, props: object = SPIN) => $.ui.mount({
  plugin: 'kiko', surface: 'terminal', component: 'Spinner', props, viewport: { columns: 80, rows: 30, isFullscreen: true },
})
const run = ($: any, args: string) => $.command.run({ command: 'kiko', args } as never)

describe('band, spinner and /kiko', () => {
  test('idle: the band and spinner fall through', async ($, on) => {
    fakeHost(on)
    await startSession($)
    const band = await mountBand($)
    expect(await band.find({ type: 'Code' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await band.unmount()
    const spin = await mountSpinner($)
    expect((await spin.find({ type: 'Text' }))?.text).toBe('spin:Sauteing')
    await spin.unmount()
  })

  test('a survey in the band is left alone', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'x', turnId: 't1' })
    const band = await $.ui.mount({ plugin: 'kiko', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
    expect(await band.find({ type: 'Code' })).toBeUndefined()
    await band.unmount()
  })

  test('fighting: spinner words, but not over an engine message', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'x', turnId: 't1' })
    let spin = await mountSpinner($)
    expect((await spin.find({ type: 'Text' }))?.text).toMatch(/^spin:(Kikonsidering|Sizing up the opponent|Plotting the combo|Reading the ring)$/)
    await spin.unmount()
    spin = await mountSpinner($, { ...SPIN, message: 'Compacting' })
    expect((await spin.find({ type: 'Text' }))?.text).toBe('spin:Sauteing')
    await spin.unmount()
  })

  test('/kiko runs at once, even mid-turn', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    expect(fake.commandSpecs.find(c => c.name === 'kiko')).toMatchObject({ immediate: true })
  })

  test('/kiko off and on, saved', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    expect((await run($, 'off') as { text: string }).text).toContain('off')
    expect(fake.store.get('kiko:enabled')).toBe(false)
    await $.turn.start({ text: 'x', turnId: 't1' })
    const band = await mountBand($)
    expect(await band.find({ type: 'Code' })).toBeUndefined()
    await band.unmount()
    await run($, 'on')
    expect(fake.store.get('kiko:enabled')).toBe(true)
  })

  test('off mid-fight: no notice, but the win counts', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await run($, 'off')
    await complete($, 't1')
    expect(fake.store.get('kiko:record')).toMatchObject({ wins: 1 })
  })

  test('/kiko stats and status', async ($, on) => {
    fakeHost(on, { 'kiko:record': { wins: 48, streak: 12, bestStreak: 20, fastestMs: 9_000, biggestTokens: 180_000, recent: ['THE A'] } })
    await startSession($)
    const stats = (await run($, 'stats') as { text: string }).text
    expect(stats).toContain('48-0')
    expect(stats).toContain('best 20')
    expect(stats).toContain('0:09')
    expect((await run($, '') as { text: string }).text).toBe('Kiko is on · 48-0 | streak 12. Try /kiko stats, /kiko off.')
    expect((await run($, 'wat') as { text: string }).text).toContain('/kiko on')
  })
})
