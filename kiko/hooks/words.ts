// What Kiko says: times and token counts, the K.O. line, /kiko stats and the spinner words.
import type { KikoRecord, Round } from '../types'

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function koLine(round: Round, rec: KikoRecord): string {
  const took = mmss((round.endedAt ?? round.startedAt) - round.startedAt)
  return `K.O. ▸ Kiko beats ${round.opponent} in ${took} · read ${round.reads} · wrote ${round.writes} · ` +
    `${fmtTokens(round.tokensIn)} in / ${fmtTokens(round.tokensOut)} out · ${rec.wins}-0`
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
