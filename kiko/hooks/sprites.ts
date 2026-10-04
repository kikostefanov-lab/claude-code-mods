import type { Round } from '../types'
import { fmtTokens, mmss } from './round'

export const FRAME_MS = 160
export const BEAT_FRAMES = 6

type Frame = readonly [string, string, string]
const KIKO_W = 9
const FOE_W = 5
const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length))
const kiko = (top: string, face: string, body: string): Frame => [pad(top, KIKO_W), pad(face, KIKO_W), pad(body, KIKO_W)]
const foe = (top: string, face: string, body: string): Frame => [pad(top, FOE_W), pad(face, FOE_W), pad(body, FOE_W)]

const EARS = ' /\\_/\\'
const ARMS = ' /| |\\'

export const SPRITES = {
  guard: [kiko(EARS, '( o.o )', ARMS), kiko(EARS, '( o.o )', ' \\| |/')],
  thinking: [
    kiko('  ?', '( o.o )', ARMS), kiko('    ?', '( @.@ )', ARMS), kiko('  ? ?', '( -.- )', ARMS), kiko('    ?', '( @.@ )', ARMS),
  ],
  responding: [kiko(EARS, '( o.o )', ARMS), kiko(EARS, '( oOo )', ARMS), kiko(EARS, '( o-o )', ARMS)],
  chomp: [kiko(EARS, '( O.O )', ARMS), kiko(EARS, '( O.O )', ARMS), kiko(EARS, '( >.< )', ARMS), kiko(EARS, '( ^.^ )', ARMS)],
  punch: [kiko(EARS, '( >.< )', ARMS), kiko(EARS, '( >.< )', ' /| |=>'), kiko(EARS, '( ^.^ )', ' /| |=>')],
  dodge: [kiko(EARS, '( >.> )', ARMS), kiko(EARS, '( <.< )', ARMS)],
} as const

export const FOE = {
  idle: [foe(' ,_,', '(o_o)', ' / \\'), foe(' ,_,', '(-_o)', ' / \\')],
  hit: [foe(' ,_,', '(x_x)', ' \\ /'), foe('  ,_,', ' (x_x', '  \\ /')],
} as const

export const KO_LETTERS: readonly string[] = ['╦╔═ ╔═╗  ', '╠╩╗ ║ ║  ', '╩ ╩o╚═╝o ']

export function isArtChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return ch.length === 1 && ((c >= 0x20 && c <= 0x7e) || (c >= 0x2500 && c <= 0x259f) || c === 0x2039 || c === 0x203a)
}

export function fitRow(text: string, columns: number): string {
  return text.length >= columns ? text.slice(0, columns) : text + ' '.repeat(columns - text.length)
}

const FULL = 200_000

export function bar(value: number, width: number): string {
  const fraction = Math.min(1, Math.log10(1 + Math.max(0, value)) / Math.log10(1 + FULL))
  const filled = Math.round(fraction * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function header(round: Round, view: { beatStep: number | null; now: number }, columns: number): string {
  const isBell = round.beat?.kind === 'bell' && view.beatStep !== null
  const left = isBell ? ` ROUND ${round.n} ── FIGHT! ` : ` ROUND ${round.n} ── KIKO vs. ${round.opponent} `
  const clock = ` ${mmss((round.endedAt ?? view.now) - round.startedAt)} `
  const fill = Math.max(1, columns - left.length - clock.length)
  return fitRow(left + '─'.repeat(fill) + clock, columns)
}

function bars(round: Round, columns: number): string {
  const label = (name: string, value: number, width: number) => `${name} ${bar(value, width)} ${fmtTokens(value)}`
  const width = Math.max(4, Math.min(12, Math.floor((columns - 24) / 2)))
  const left = ` ${label('KI', round.tokensIn, width)}`
  const right = `${label('KO', round.tokensOut, width)} `
  return fitRow(left + ' '.repeat(Math.max(2, columns - left.length - right.length)) + right, columns)
}

function kikoFrame(round: Round, view: { frame: number; beatStep: number | null }): Frame {
  const beat = round.beat && view.beatStep !== null ? round.beat.kind : null
  if (beat === 'chomp') return SPRITES.chomp[Math.min(view.beatStep! >> 1, 3)]!
  if (beat === 'punch') return SPRITES.punch[Math.min(view.beatStep! >> 1, 2)]!
  if (beat === 'dodge') return SPRITES.dodge[view.beatStep! % 2]!
  const loop = round.mode === 'thinking' ? SPRITES.thinking : round.mode === 'responding' ? SPRITES.responding : SPRITES.guard
  return loop[view.frame % loop.length]!
}

function arena(round: Round, view: { frame: number; beatStep: number | null }, columns: number): string[] {
  const hasFoe = columns >= 60
  const LEFT = 14
  const me = kikoFrame(round, view)
  const step = view.beatStep
  const isHit = round.beat?.kind === 'punch' && step !== null && step >= 3
  const them = isHit ? FOE.hit[step! % 2]! : FOE.idle[(view.frame >> 2) % 2]!
  const gap = Math.max(4, columns - LEFT - me[0].length - (hasFoe ? them[0].length + 2 : 0))
  const lanes = [' '.repeat(LEFT), ' '.repeat(LEFT), ' '.repeat(LEFT)]
  const mid = [' '.repeat(gap), ' '.repeat(gap), ' '.repeat(gap)]
  const put = (row: string, at: number, text: string) => (row.slice(0, at) + text + row.slice(at + text.length)).slice(0, row.length)

  if (round.beat?.kind === 'chomp' && step !== null && step < 4) {
    const item = `[${round.beat.label}]›››`.slice(0, LEFT)
    lanes[1] = put(lanes[1]!, Math.min(step * 3, LEFT - item.length), item)
  }
  if (round.beat?.kind === 'punch' && step !== null && step >= 1 && step < 4) {
    const item = `{${round.beat.label}}`.slice(0, gap)
    mid[1] = put(mid[1]!, Math.min((step - 1) * Math.floor(gap / 3), gap - item.length), item)
    if (step === 3) mid[2] = put(mid[2]!, Math.max(0, gap - 7), '‹ jab!')
  }
  if (round.mode === 'responding' && step === null) {
    const letters = 'k i k o'
    mid[1] = put(mid[1]!, (view.frame * 2) % Math.max(1, gap - letters.length), letters)
  }
  return [0, 1, 2].map(i => fitRow(`${lanes[i]}${me[i]}${mid[i]}${hasFoe ? `${them[i]}  ` : ''}`, columns))
}

export function layout(
  round: Round,
  view: { frame: number; beatStep: number | null; now: number },
  columns: number,
  maxRows = 6,
): string[] {
  const status = fitRow(` > ${round.status || (round.mode === 'thinking' ? 'thinking' : round.mode === 'responding' ? 'replying' : 'circling')}`, columns)
  if (columns < 30) return [header(round, view, columns), status]
  const rows = [header(round, view, columns), bars(round, columns), ...arena(round, view, columns), status]
  return maxRows < 6 ? [rows[0]!, ...rows.slice(2)] : rows
}

export function koCard(round: Round, columns: number): string[] {
  const took = mmss((round.endedAt ?? round.startedAt) - round.startedAt)
  const lines = [
    `K.O.!  Kiko beats ${round.opponent} in ${took}`,
    `read ${round.reads} | wrote ${round.writes} | ${fmtTokens(round.tokensIn)} in / ${fmtTokens(round.tokensOut)} out`,
    `record ${round.record}`,
  ]
  return lines.map((text, i) => fitRow(` ${KO_LETTERS[i]}  ${text}`, columns))
}
