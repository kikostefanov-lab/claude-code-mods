// Kiko's hooks: the round's life on the engine, /kiko, and the band and spinner. Everything
// that takes `$` lives in this file, since the engine follows `$` into a function declared
// here but never across an import; the pure rules come from round, record, words and layout.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnCompleteInput } from 'claude-code'

import type { KikoRecord, Mode } from '../types'
import { bandRows } from './layout'
import { EMPTY_RECORD, isKikoRecord, recordLine, updateRecord } from './record'
import {
  IDLE, TICK_MS, afterTool, beatFor, classifyTool, freshSession, isFighting, knockOut, opponentName, startFight, stopFight, tick,
  withMode, withUsage,
} from './round'
import type { Usage } from './round'
import { koLine, spinnerKind, spinnerWord, statsText } from './words'

const round = atom({ plugin: 'kiko', key: 'round' } as const, IDLE)
const enabled = atom({ plugin: 'kiko', key: 'enabled' } as const, true)

const RECORD_KEY = 'kiko:record'
const ENABLED_KEY = 'kiko:enabled'

const KIKO_COMMAND = {
  name: 'kiko',
  description: 'Kiko, your KIKO fighter: Knowledge In, Knowledge Out',
  argumentHint: '[on | off | stats]',
  immediate: true,
} as const

// A subagent's loop carries its agentId; its turns and tool calls aren't Kiko's fight.
const isSub = (e: object): boolean => 'agentId' in e && Boolean(e.agentId)

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

async function setEnabled($: EngineInterface, value: boolean): Promise<void> {
  await update($, enabled, () => value)
  await $.store.set(ENABLED_KEY, value)
}

async function openSession($: EngineInterface): Promise<void> {
  // Kiko is on unless it was switched off; a failed read leaves it on.
  const saved = await $.store.get(ENABLED_KEY).catch(() => undefined)
  await update($, enabled, () => saved !== false)
  const { rec } = await loadRecord($)
  await update($, round, r => freshSession(r, recordLine(rec)))
}

async function startRound($: EngineInterface, text: string, turnId: string): Promise<void> {
  // The same turn again is a no-op; a different one starts a new round even if the last
  // turn's turn.complete never came.
  if (isFighting(await read($, round), turnId)) return
  const { rec } = await loadRecord($)
  const now = await $.clock.now()
  await update($, round, r => startFight(r, { turnId, opponent: opponentName(text), now, record: recordLine(rec) }))
}

async function setMode($: EngineInterface, turnId: string, mode: Mode): Promise<void> {
  await update($, round, r => withMode(r, turnId, mode))
}

async function addUsage($: EngineInterface, turnId: string, usage: Usage): Promise<void> {
  await update($, round, r => withUsage(r, turnId, usage))
}

// Plays the tool's beat; false when no round is on, so the call is left alone after.
async function toolBeat($: EngineInterface, tool: string, input: unknown): Promise<boolean> {
  if (!isFighting(await read($, round))) return false
  const { kind, label } = classifyTool(tool, input)
  await update($, round, r => beatFor(r, kind, label, tool))
  return true
}

async function finishRound($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  const r = await read($, round)
  if (!isFighting(r, e.turnId)) return
  if (e.reason !== 'answer' || e.isAborted) {
    await update($, round, stopFight)
    return
  }
  const saved = await loadRecord($)
  const rec = updateRecord(saved.rec, { ms: e.durationMs, tokens: r.tokensIn + r.tokensOut, opponent: r.opponent })
  if (saved.isWritable) await $.store.set(RECORD_KEY, rec)
  const done = knockOut(r, await $.clock.now(), recordLine(rec))
  await update($, round, () => done)
  if (await read($, enabled)) {
    await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: koLine(done, rec) }] } }).catch(() => undefined)
  }
}

// The band's clock. Timers only outlive the dispatch that starts them from session.start,
// and the desktop can't run a Client surface module, so the band animates from here: each
// tick advances a fight's frame or ends a stale K.O. card, and writes nothing while idle.
async function tickRound($: EngineInterface): Promise<void> {
  const r = await read($, round)
  if (r.phase === 'idle') return
  const now = await $.clock.now()
  if (tick(r, now)) await update($, round, x => tick(x, now) ?? x)
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
  if (word === '') return `Kiko is ${(await read($, enabled)) ? 'on' : 'off'} · ${recordLine(rec)}. Try /kiko stats, /kiko off.`
  return 'Usage: /kiko on, /kiko off, /kiko stats'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register(KIKO_COMMAND)
      await openSession($)
      $.clock.every(TICK_MS, () => void tickRound($).catch(() => undefined))
    } catch {
      // Kiko never stops a session from starting.
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!isSub(e)) await startRound($, e.text, e.turnId).catch(() => undefined)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const r = isSub(e) ? undefined : await read($, round).catch(() => undefined)
    if (!r || !isFighting(r, e.turnId)) return yield* stream
    let mode: Mode | undefined
    for (;;) {
      const item = await stream.next()
      if (item.done) return item.value
      const chunk = item.value
      try {
        if (chunk.kind === 'thinking' || chunk.kind === 'text') {
          const now = chunk.kind === 'thinking' ? 'thinking' : 'responding'
          if (now !== mode) {
            mode = now
            await setMode($, e.turnId, now)
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
    const isOurs = isSub(e) ? false : await toolBeat($, e.tool, e).catch(() => false)
    const result = await next(e)
    // The tool's result goes back unchanged either way.
    if (isOurs) await update($, round, afterTool).catch(() => undefined)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      // The K.O. lands whether or not the chain beneath finished cleanly; its error, if any,
      // still reaches the engine.
      if (!isSub(e)) await finishRound($, e).catch(() => undefined)
    }
  })

  on('command.run', { command: 'kiko' }, async ($, e) => ({ text: await kikoCommand($, e.args ?? '') }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, round)
    if (!(await read($, enabled)) || r.phase === 'idle' || e.props.hasSurvey) return next(e)
    const rows = bandRows(r, await $.clock.now(), Math.max(20, e.props.bodyColumns), e.props.maxRows)
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
    const r = await read($, round)
    if (!(await read($, enabled)) || r.phase !== 'fight' || e.props.message) return next(e)
    return next({ ...e, props: { ...e.props, word: spinnerWord(spinnerKind(e.props.mode, r), r.n) } })
  })
}
