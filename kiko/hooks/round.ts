// Kiko's brain: the pure rules of a round (opponent names, knowledge in and out, the
// band's clock and each change a turn makes to the round), with no `$`, so the tests
// drive it directly.
import type { BeatKind, Mode, Round } from '../types'
import { EMPTY_RECORD, recordLine } from './record'

export const IDLE: Round = {
  phase: 'idle', n: 0, turnId: null, opponent: '', startedAt: 0, endedAt: null, mode: 'requesting', status: '',
  tokensIn: 0, tokensOut: 0, reads: 0, writes: 0, seq: 0, beat: null, record: recordLine(EMPTY_RECORD), frame: 0, beatAt: 0,
}

const STOP = new Set(`a an and are as at be by can could do does fix for from help how i in into is it its just let lets me
  my need now of on or our please should show so some tell than that the then this to up us want was we what when why will
  with would you your make add build create write update change look check new get set run see find think about
  makes give me tell explain`.split(/\s+/))

const NAME_MAX = 28

export function opponentName(text: string): string {
  const words = text
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/<\/?[a-z][\w-]*[^>]*>/g, ' ')
    .match(/[a-z][a-z0-9'-]*/g) ?? []
  const kept = words.filter(w => w.length > 1 && !STOP.has(w)).slice(0, 3)
  if (kept.length === 0) return 'THE UNKNOWN BUG'
  let name = `THE ${kept.join(' ').toUpperCase()}`
  while (name.length > NAME_MAX && name.includes(' ', 4)) name = name.slice(0, name.lastIndexOf(' '))
  return name.slice(0, NAME_MAX)
}

const IN_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LS', 'NotebookRead'])
const OUT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const clip = (s: string, n = 20) => (s.length > n ? s.slice(0, n) : s)
// Labels land in fixed-width art: anything but printable ASCII becomes '?'.
const ascii = (s: string) => s.replace(/[^\x20-\x7e]/gu, '?')
const lastSegment = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? p

export type ToolKind = 'in' | 'out' | 'dodge'

export function classifyTool(tool: string, input: unknown): { kind: ToolKind; label: string } {
  const args = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = str('file_path') || str('notebook_path') || str('path')
  let host = ''
  try { host = str('url') ? new URL(str('url')).host : '' } catch { host = '' }
  const label = clip(ascii(path ? lastSegment(path) : str('pattern') || str('query') || host || tool))
  if (IN_TOOLS.has(tool)) return { kind: 'in', label }
  if (OUT_TOOLS.has(tool)) return { kind: 'out', label }
  if (tool.startsWith('mcp__')) {
    const short = clip(ascii(tool.slice(tool.lastIndexOf('__') + 2)))
    if (/(read|search|get|list|fetch|query|find)/i.test(short)) return { kind: 'in', label: short }
    if (/(write|create|update|edit|delete|send|post|set|add)/i.test(short)) return { kind: 'out', label: short }
    return { kind: 'dodge', label: short }
  }
  return { kind: 'dodge', label: clip(ascii(tool)) }
}

const BEAT: Record<ToolKind, BeatKind> = { in: 'chomp', out: 'punch', dodge: 'dodge' }

export function beatFor(round: Round, kind: ToolKind, label: string, tool: string): Round {
  const seq = round.seq + 1
  const status = kind === 'in' ? `reading ${label}` : kind === 'out' ? `editing ${label}` : `running ${tool}`
  return {
    ...round,
    seq,
    mode: 'tool',
    status,
    reads: round.reads + (kind === 'in' ? 1 : 0),
    writes: round.writes + (kind === 'out' ? 1 : 0),
    beat: { id: seq, kind: BEAT[kind], label },
    beatAt: round.frame,
  }
}

export const TICK_MS = 200
export const BEAT_FRAMES = 6
export const KO_CARD_MS = 5_000

// Which frame of its move the current beat is on, or null once it has played out.
export function beatStepOf(round: Round): number | null {
  if (!round.beat) return null
  const step = round.frame - round.beatAt
  return step >= 0 && step < BEAT_FRAMES ? step : null
}

// One tick of the band's clock: the next frame of a fight, the end of a stale K.O. card,
// or null when nothing changes (idle, or a card still showing).
export function tick(round: Round, now: number): Round | null {
  if (round.phase === 'fight') return { ...round, frame: round.frame + 1 }
  if (round.phase === 'ko' && round.endedAt !== null && now - round.endedAt >= KO_CARD_MS) return { ...round, phase: 'idle' }
  return null
}

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export function applyUsage(round: Round, usage: Usage): Round {
  return {
    ...round,
    // Cache reads are the conversation re-read, not new knowledge.
    tokensIn: round.tokensIn + count(usage.input_tokens) + count(usage.cache_creation_input_tokens),
    tokensOut: round.tokensOut + count(usage.output_tokens),
  }
}

// A round in progress, and when a turn is named, that turn's.
export function isFighting(round: Round, turnId?: string): boolean {
  return round.phase === 'fight' && (turnId === undefined || round.turnId === turnId)
}

// A new session keeps the round count and beat ids and shows the saved record.
export function freshSession(round: Round, record: string): Round {
  return { ...IDLE, n: round.n, seq: round.seq, record }
}

export function startFight(prev: Round, fight: { turnId: string; opponent: string; now: number; record: string }): Round {
  const seq = prev.seq + 1
  return {
    ...IDLE, n: prev.n + 1, seq, turnId: fight.turnId, phase: 'fight', opponent: fight.opponent, startedAt: fight.now,
    status: 'touching gloves', beat: { id: seq, kind: 'bell', label: '' }, record: fight.record,
  }
}

export function withMode(round: Round, turnId: string, mode: Mode): Round {
  return isFighting(round, turnId) && round.mode !== mode ? { ...round, mode, status: '' } : round
}

export function withUsage(round: Round, turnId: string, usage: Usage): Round {
  return isFighting(round, turnId) ? applyUsage(round, usage) : round
}

// Back to waiting on the model once a tool has answered.
export function afterTool(round: Round): Round {
  return isFighting(round) ? { ...round, mode: 'requesting', status: '' } : round
}

export function knockOut(round: Round, now: number, record: string): Round {
  return { ...round, phase: 'ko', endedAt: now, record, status: 'K.O.!' }
}

export function stopFight(round: Round): Round {
  return { ...round, phase: 'idle' }
}
