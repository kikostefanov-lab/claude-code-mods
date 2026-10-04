// Test-kit notes (from the whiteboard): op stubs answer { value } or { deny }; registrations
// must be stubbed; event stubs (turn.*, tool.call, session.append) answer the event's result.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

const v = <T>(x: T) => ({ value: x })

export type Fake = {
  clock: MockClock
  store: Map<string, unknown>
  registered: string[]
  tools: string[]
}

export function fakeHost(on: On, store: Record<string, unknown> = {}): Fake {
  const fake = { store: new Map(Object.entries(store)), registered: [], tools: [] } as unknown as Fake
  fake.clock = mock.clock(on, { now: 1_760_000_000_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => { fake.registered.push(`command:${e.name}`); return v(undefined) })
  on('store.get', ($, e) => v(fake.store.get(e.key)))
  on('store.set', ($, e) => { fake.store.set(e.key, e.value); return v(undefined) })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', ($, e) => { fake.tools.push(e.tool); return { result: 'ok' } })
  // What the engine would draw when Kiko falls through: marker trees the tests can find.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['engine band'] }) as never)
  on('ui.render', { component: 'Spinner' }, ($, e) => ({ type: 'Text', props: {}, children: [`spin:${(e.props as { word: string }).word}`] }) as never)
  return fake
}

// The test's own registrar can't hook session.append, so an inline plugin records each
// notice into the fake store and declines to store the row.
export const NOTICES = {
  name: 'notices',
  register(on: any) {
    on('session.append', async ($: any, e: any) => {
      const prev = ((await $.store.get('test:notices')) as string[] | undefined) ?? []
      await $.store.set('test:notices', [...prev, e.message.content[0]?.text ?? ''])
      return { deny: 'recorded by the test' }
    })
  },
}

export const noticesOf = (fake: Fake) => (fake.store.get('test:notices') as string[] | undefined) ?? []

export async function startSession($: any): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
}

export const USAGE = { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, model: 'm' }

// Plays one model step: thinking, then text, then stop with usage; drains the stream.
export async function step($: any, on: On, turnId: string, agentId?: string): Promise<unknown[]> {
  const seen: unknown[] = []
  const stream = $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const chunk of stream) seen.push(chunk)
  return seen
}

export function stepSource(on: On): void {
  on('turn.step', async function* ($, e) {
    yield { kind: 'thinking', index: 0, text: 'hmm' }
    yield { kind: 'text', index: 1, text: 'Done.' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: USAGE }
    return { turnId: e.turnId, index: e.index, answer: 'Done.', toolUses: [], stopReason: 'end_turn', usage: USAGE }
  } as never)
}

export const complete = ($: any, turnId: string, extra: object = {}) =>
  $.turn.complete({ turnId, answer: 'Done.', durationMs: 42_000, isAborted: false, reason: 'answer', ...extra })
