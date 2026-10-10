// Kiko's career: wins, streaks and the last few opponents, saved across sessions.
import type { KikoRecord } from '../types'

export const EMPTY_RECORD: KikoRecord = { wins: 0, streak: 0, bestStreak: 0, fastestMs: null, biggestTokens: 0, recent: [] }

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

export function recordLine(rec: KikoRecord): string {
  return `${rec.wins}-0 | streak ${rec.streak}`
}
