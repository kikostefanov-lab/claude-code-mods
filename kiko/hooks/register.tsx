import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { KikoRecord, Round } from '../types'
import {
  EMPTY_RECORD, IDLE, applyUsage, beatFor, classifyTool, isKikoRecord, koLine, oneLine, opponentName, recordLine,
  spinnerKind, spinnerWord, statsText, updateRecord,
} from './round'
import type { Usage } from './round'

const round = atom({ plugin: 'kiko', key: 'round' } as const, IDLE)
const enabled = atom({ plugin: 'kiko', key: 'enabled' } as const, true)

const RECORD_KEY = 'kiko:record'
const ENABLED_KEY = 'kiko:enabled'
const KO_CARD_MS = 5_000

const isSub = (e: unknown) => Boolean((e as { agentId?: string }).agentId)

async function loadRecord($: EngineInterface): Promise<KikoRecord> {
  const saved = await $.store.get(RECORD_KEY).catch(() => undefined)
  return isKikoRecord(saved) ? saved : EMPTY_RECORD
}

async function startRound($: EngineInterface, text: string, turnId: string): Promise<void> {
  const current = (await read($, round)) ?? IDLE
  if (current.phase === 'fight') return
  const rec = await loadRecord($)
  const now = await $.clock.now()
  await update($, round, r => {
    const prev = r ?? IDLE
    const seq = prev.seq + 1
    return {
      ...IDLE, n: prev.n + 1, seq, turnId, phase: 'fight', opponent: opponentName(text), startedAt: now,
      status: 'touching gloves', beat: { id: seq, kind: 'bell', label: '' }, record: recordLine(rec),
    }
  })
}

async function setMode($: EngineInterface, turnId: string, mode: Round['mode']): Promise<void> {
  await update($, round, r => (r && r.turnId === turnId && r.phase === 'fight' && r.mode !== mode ? { ...r, mode, status: '' } : r ?? IDLE))
}

async function addUsage($: EngineInterface, turnId: string, usage: Usage): Promise<void> {
  await update($, round, r => (r && r.turnId === turnId && r.phase === 'fight' ? applyUsage(r, usage) : r ?? IDLE))
}

async function finishRound($: EngineInterface, e: { turnId: string; reason: string; isAborted: boolean; durationMs: number }): Promise<void> {
  const r = await read($, round)
  if (!r || r.phase !== 'fight' || r.turnId !== e.turnId) return
  if (e.reason !== 'answer' || e.isAborted) {
    await update($, round, x => ({ ...(x ?? IDLE), phase: 'idle' }))
    return
  }
  const rec = updateRecord(await loadRecord($), { ms: e.durationMs, tokens: r.tokensIn + r.tokensOut, opponent: r.opponent })
  await $.store.set(RECORD_KEY, rec)
  const done: Round = { ...r, phase: 'ko', endedAt: await $.clock.now(), record: recordLine(rec), status: 'K.O.!' }
  await update($, round, () => done)
  if ((await read($, enabled)) ?? true) {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: koLine(done, rec) }] } }).catch(() => undefined)
  }
}

// Timers only outlive the dispatch that starts them from session.start, so the K.O. card
// is cleared by a sweep started there rather than a timer set at the K.O.
async function sweepKo($: EngineInterface): Promise<void> {
  const r = await read($, round)
  if (!r || r.phase !== 'ko' || r.endedAt === null) return
  if ((await $.clock.now()) - r.endedAt < KO_CARD_MS) return
  await update($, round, x => (x && x.phase === 'ko' && x.endedAt === r.endedAt ? { ...x, phase: 'idle' } : x ?? IDLE))
}

async function setEnabled($: EngineInterface, value: boolean): Promise<void> {
  await update($, enabled, () => value)
  await $.store.set(ENABLED_KEY, value)
}

async function kikoCommand($: EngineInterface, args: string): Promise<string> {
  const word = args.trim().toLowerCase()
  if (word === 'on') {
    await setEnabled($, true)
    return 'Kiko is on. Ding ding!'
  }
  if (word === 'off') {
    await setEnabled($, false)
    return 'Kiko is off. The record still counts; /kiko on to bring Kiko back.'
  }
  const rec = await loadRecord($)
  if (word === 'stats') return statsText(rec)
  if (word === '') return `Kiko is ${((await read($, enabled)) ?? true) ? 'on' : 'off'} · ${recordLine(rec)}. Try /kiko stats, /kiko off.`
  return 'Usage: /kiko on, /kiko off, /kiko stats'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'kiko', description: 'Kiko, your KIKO fighter: Knowledge In, Knowledge Out', argumentHint: '[on | off | stats]' })
      const saved = await $.store.get(ENABLED_KEY).catch(() => undefined)
      await update($, enabled, () => saved !== false)
      const rec = await loadRecord($)
      await update($, round, r => ({ ...IDLE, n: r?.n ?? 0, seq: r?.seq ?? 0, record: recordLine(rec) }))
      $.clock.every(500, () => void sweepKo($).catch(() => undefined))
    } catch {
      // Kiko never stops a session from starting.
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!isSub(e)) {
      try {
        await startRound($, e.text, e.turnId)
      } catch {
        // A failed round start leaves the turn alone.
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const r = isSub(e) ? undefined : await read($, round).catch(() => undefined)
    if (!r || r.phase !== 'fight' || r.turnId !== e.turnId) return yield* stream
    let mode: Round['mode'] | undefined
    for (;;) {
      const item = await stream.next()
      if (item.done) return item.value
      const chunk = item.value
      try {
        if (chunk.kind === 'thinking' || chunk.kind === 'text') {
          const next_ = chunk.kind === 'thinking' ? 'thinking' : 'responding'
          if (next_ !== mode) {
            mode = next_
            await setMode($, e.turnId, next_)
          }
        } else if (chunk.kind === 'stop' && chunk.usage) {
          await addUsage($, e.turnId, chunk.usage)
        }
      } catch {
        // Watching the stream never changes it.
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    let isOurs = false
    try {
      const r = isSub(e) ? undefined : await read($, round)
      if (r && r.phase === 'fight') {
        isOurs = true
        const { kind, label } = classifyTool(e.tool, e)
        await update($, round, x => beatFor(x ?? IDLE, kind, label, e.tool))
      }
    } catch {
      isOurs = false
    }
    const result = await next(e)
    if (isOurs) {
      try {
        await update($, round, x => (x && x.phase === 'fight' ? { ...x, mode: 'requesting', status: '' } : x ?? IDLE))
      } catch {
        // The tool's result goes back unchanged either way.
      }
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!isSub(e)) {
      try {
        await finishRound($, e as never)
      } catch {
        // A failed K.O. leaves the turn's result alone.
      }
    }
    return result
  })

  on('command.run', { command: 'kiko' }, async ($, e) => ({ text: await kikoCommand($, e.args ?? '') }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOn = (await read($, enabled)) ?? true
    const r = (await read($, round)) ?? IDLE
    if (!isOn || r.phase === 'idle' || e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const columns = Math.max(20, e.props.bodyColumns)
    // The terminal and desktop draw a Client; other tables list one that draws nothing.
    if ((e.surface === 'terminal' || e.surface === 'desktop') && 'Client' in els) {
      const { Client } = els
      return <Client key="kiko" module="./kiko.tsx" props={{ ...r, columns, maxRows: e.props.maxRows }} />
    }
    const { Text } = els
    return <Text>{oneLine(r)}</Text>
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const isOn = (await read($, enabled)) ?? true
    const r = (await read($, round)) ?? IDLE
    if (!isOn || r.phase !== 'fight' || e.props.message) return next(e)
    return next({ ...e, props: { ...e.props, word: spinnerWord(spinnerKind(e.props.mode, r), r.n) } })
  })
}
