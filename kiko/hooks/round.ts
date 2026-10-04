// Kiko's brain: the pure rules of a round (opponent names, knowledge in and out, the
// band's clock, the record and the K.O. line), with no `$`, so the tests drive it directly.
import type { BeatKind, KikoRecord, Mode, Round } from '../types'

export const IDLE: Round = {
  phase: 'idle', n: 0, turnId: null, opponent: '', startedAt: 0, endedAt: null, mode: 'requesting', status: '',
  tokensIn: 0, tokensOut: 0, reads: 0, writes: 0, seq: 0, beat: null, record: '0-0 | streak 0', frame: 0, beatAt: 0,
}

export const EMPTY_RECORD: KikoRecord = { wins: 0, streak: 0, bestStreak: 0, fastestMs: null, biggestTokens: 0, recent: [] }

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
const lastSegment = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? p

export function classifyTool(tool: string, input: unknown): { kind: 'in' | 'out' | 'dodge'; label: string } {
  const args = (input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = str('file_path') || str('notebook_path') || str('path')
  let host = ''
  try { host = str('url') ? new URL(str('url')).host : '' } catch { host = '' }
  const label = clip(path ? lastSegment(path) : str('pattern') || str('query') || host || tool)
  if (IN_TOOLS.has(tool)) return { kind: 'in', label }
  if (OUT_TOOLS.has(tool)) return { kind: 'out', label }
  if (tool.startsWith('mcp__')) {
    const short = clip(tool.slice(tool.lastIndexOf('__') + 2))
    if (/(read|search|get|list|fetch|query|find)/i.test(short)) return { kind: 'in', label: short }
    if (/(write|create|update|edit|delete|send|post|set|add)/i.test(short)) return { kind: 'out', label: short }
    return { kind: 'dodge', label: short }
  }
  return { kind: 'dodge', label: clip(tool) }
}

const BEAT: Record<'in' | 'out' | 'dodge', BeatKind> = { in: 'chomp', out: 'punch', dodge: 'dodge' }

export function beatFor(round: Round, kind: 'in' | 'out' | 'dodge', label: string, tool: string): Round {
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

export function applyUsage(round: Round, usage: Usage): Round {
  return {
    ...round,
    // Cache reads are the conversation re-read, not new knowledge.
    tokensIn: round.tokensIn + usage.input_tokens + usage.cache_creation_input_tokens,
    tokensOut: round.tokensOut + usage.output_tokens,
  }
}

export function updateRecord(rec: KikoRecord, fight: { ms: number; tokens: number; opponent: string }): KikoRecord {
  const streak = rec.streak + 1
  return {
    wins: rec.wins + 1,
    streak,
    bestStreak: Math.max(rec.bestStreak, streak),
    fastestMs: rec.fastestMs === null ? fight.ms : Math.min(rec.fastestMs, fight.ms),
    biggestTokens: Math.max(rec.biggestTokens, fight.tokens),
    recent: [fight.opponent, ...rec.recent].slice(0, 5),
  }
}

export function isKikoRecord(v: unknown): v is KikoRecord {
  const r = v as KikoRecord | undefined
  return Boolean(r) && typeof r!.wins === 'number' && typeof r!.streak === 'number' && typeof r!.bestStreak === 'number' &&
    typeof r!.biggestTokens === 'number' && Array.isArray(r!.recent)
}



export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function recordLine(rec: KikoRecord): string {
  return `${rec.wins}-0 | streak ${rec.streak}`
}

export function koLine(round: Round, rec: KikoRecord): string {
  const took = mmss((round.endedAt ?? round.startedAt) - round.startedAt)
  return `K.O. ▸ Kiko beats ${round.opponent} in ${took} · read ${round.reads} · wrote ${round.writes} · ` +
    `${fmtTokens(round.tokensIn)} in / ${fmtTokens(round.tokensOut)} out · ${rec.wins}-0`
}

export function oneLine(round: Round): string {
  return `ROUND ${round.n} · KIKO vs. ${round.opponent} · KI ${fmtTokens(round.tokensIn)} · KO ${fmtTokens(round.tokensOut)}`
}

export function statsText(rec: KikoRecord): string {
  return [
    `**Kiko's record: ${rec.wins}-0**`,
    '',
    `- Streak: ${rec.streak} (best ${rec.bestStreak})`,
    `- Fastest K.O.: ${rec.fastestMs === null ? 'none yet' : mmss(rec.fastestMs)}`,
    `- Biggest K.O.: ${fmtTokens(rec.biggestTokens)} tokens`,
    `- Last opponents: ${rec.recent.length ? rec.recent.join(', ') : 'none yet'}`,
  ].join('\n')
}

export type SpinnerKind = 'thinking' | 'in' | 'out' | 'responding' | 'tool' | 'requesting'

export function spinnerKind(engineMode: string, round: Round): SpinnerKind {
  if (engineMode === 'thinking') return 'thinking'
  if (engineMode === 'responding') return 'responding'
  if (engineMode === 'tool-use' || engineMode === 'tool-input') {
    return round.beat?.kind === 'chomp' ? 'in' : round.beat?.kind === 'punch' ? 'out' : 'tool'
  }
  return 'requesting'
}

const WORDS: Record<SpinnerKind, readonly string[]> = {
  thinking: ['Kikonsidering', 'Sizing up the opponent', 'Plotting the combo', 'Reading the ring'],
  in: ['Chomping knowledge', 'Knowledge in', 'Studying the tape', 'Nom-nom-noting'],
  out: ['Winding up the KO', 'Knowledge out', 'Landing the uppercut', 'Jab, jab, cross'],
  responding: ['Trash-talking', 'Ringside commentary', 'Calling the shot', 'Talking the talk'],
  tool: ['Bobbing and weaving', 'Footwork', 'Working the corner', 'Kiko-ing'],
  requesting: ['Kiko-ing', 'Touching gloves', 'Circling', 'Bouncing on toes'],
}

export function spinnerWord(kind: SpinnerKind, n: number): string {
  const words = WORDS[kind]
  return words[Math.abs(n) % words.length]!
}

export type { Mode }
