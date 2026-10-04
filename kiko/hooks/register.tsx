import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { KikoRecord, Round } from '../types'
import {
  EMPTY_RECORD, IDLE, TICK_MS, applyUsage, beatFor, beatStepOf, classifyTool, isKikoRecord, koLine, opponentName,
  recordLine, spinnerKind, spinnerWord, statsText, tick, updateRecord,
} from './round'
import { koCard, layout } from './sprites'
import type { Usage } from './round'

const round = atom({ plugin: 'kiko', key: 'round' } as const, IDLE)
const enabled = atom({ plugin: 'kiko', key: 'enabled' } as const, true)

const RECORD_KEY = 'kiko:record'
const ENABLED_KEY = 'kiko:enabled'

const isSub = (e: unknown) => Boolean((e as { agentId?: string }).agentId)

// The saved record, and whether it may be written back: a failed read or a value that isn't
// a record is shown as a fresh one but never overwritten.
async function loadRecord($: EngineInterface): Promise<{ rec: KikoRecord; isWritable: boolean }> {
  let saved: unknown
  try {
    saved = await $.store.get(RECORD_KEY)
  } catch {
    return { rec: EMPTY_RECORD, isWritable: false }
  }
  if (saved === undefined) return { rec: EMPTY_RECORD, isWritable: true }
  return isKikoRecord(saved) ? { rec: saved, isWritable: true } : { rec: EMPTY_RECORD, isWritable: false }
}

async function startRound($: EngineInterface, text: string, turnId: string): Promise<void> {
  const current = (await read($, round)) ?? IDLE
  // The same turn again is a no-op; a different one starts a new round even if the last
  // turn's turn.complete never came.
  if (current.phase === 'fight' && current.turnId === turnId) return
  const { rec } = await loadRecord($)
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
  const saved = await loadRecord($)
  const rec = updateRecord(saved.rec, { ms: e.durationMs, tokens: r.tokensIn + r.tokensOut, opponent: r.opponent })
  if (saved.isWritable) await $.store.set(RECORD_KEY, rec)
  const done: Round = { ...r, phase: 'ko', endedAt: await $.clock.now(), record: recordLine(rec), status: 'K.O.!' }
  await update($, round, () => done)
  if ((await read($, enabled)) ?? true) {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: koLine(done, rec) }] } }).catch(() => undefined)
  }
}

// The band's clock. Timers only outlive the dispatch that starts them from session.start,
// and the desktop can't run a Client surface module, so the band animates from here: each
// tick advances a fight's frame or ends a stale K.O. card, and writes nothing while idle.
async function tickRound($: EngineInterface): Promise<void> {
  const r = await read($, round)
  if (!r || r.phase === 'idle') return
  const now = await $.clock.now()
  if (tick(r, now)) await update($, round, x => (x ? tick(x, now) ?? x : IDLE))
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
  const { rec } = await loadRecord($)
  if (word === 'stats') return statsText(rec)
  if (word === '') return `Kiko is ${((await read($, enabled)) ?? true) ? 'on' : 'off'} · ${recordLine(rec)}. Try /kiko stats, /kiko off.`
  return 'Usage: /kiko on, /kiko off, /kiko stats'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'kiko', description: 'Kiko, your KIKO fighter: Knowledge In, Knowledge Out', argumentHint: '[on | off | stats]', immediate: true })
      const saved = await $.store.get(ENABLED_KEY).catch(() => undefined)
      await update($, enabled, () => saved !== false)
      const { rec } = await loadRecord($)
      await update($, round, r => ({ ...IDLE, n: r?.n ?? 0, seq: r?.seq ?? 0, record: recordLine(rec) }))
      $.clock.every(TICK_MS, () => void tickRound($).catch(() => undefined))
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
    try {
      return await next(e)
    } finally {
      // The K.O. lands whether or not the chain beneath finished cleanly; its error, if any,
      // still reaches the engine.
      if (!isSub(e)) {
        try {
          await finishRound($, e as never)
        } catch {
          // A failed K.O. leaves the turn's result alone.
        }
      }
    }
  })

  on('command.run', { command: 'kiko' }, async ($, e) => ({ text: await kikoCommand($, e.args ?? '') }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isOn = (await read($, enabled)) ?? true
    const r = (await read($, round)) ?? IDLE
    if (!isOn || r.phase === 'idle' || e.props.hasSurvey) return next(e)
    const columns = Math.max(20, e.props.bodyColumns)
    const rows = r.phase === 'ko'
      ? koCard(r, columns)
      : layout(r, { frame: r.frame, beatStep: beatStepOf(r), now: await $.clock.now() }, columns, e.props.maxRows)
    const els = $.ui.resolve(e)
    // The terminal draws Text in its own fixed-width cells; elsewhere one Code block keeps
    // the columns straight.
    if (e.surface === 'terminal') {
      const { Box, Text } = els
      return (
        <Box flexDirection="column">
          {rows.map(row => <Text wrap="truncate">{row}</Text>)}
        </Box>
      )
    }
    const { Code } = els
    return <Code source={rows.join('\n')} />
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const isOn = (await read($, enabled)) ?? true
    const r = (await read($, round)) ?? IDLE
    if (!isOn || r.phase !== 'fight' || e.props.message) return next(e)
    return next({ ...e, props: { ...e.props, word: spinnerWord(spinnerKind(e.props.mode, r), r.n) } })
  })
}
