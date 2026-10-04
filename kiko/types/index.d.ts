export type Phase = 'idle' | 'fight' | 'ko'
export type Mode = 'requesting' | 'thinking' | 'responding' | 'tool'
export type BeatKind = 'bell' | 'chomp' | 'punch' | 'dodge'
export type Beat = { id: number; kind: BeatKind; label: string }

export type Round = {
  phase: Phase
  n: number
  turnId: string | null
  opponent: string
  startedAt: number
  endedAt: number | null
  mode: Mode
  status: string
  tokensIn: number
  tokensOut: number
  reads: number
  writes: number
  seq: number
  beat: Beat | null
  record: string
}

export type KikoRecord = {
  wins: number
  streak: number
  bestStreak: number
  fastestMs: number | null
  biggestTokens: number
  recent: string[]
}

declare module 'claude-code' {
  interface PluginState {
    kiko: { round: Round; enabled: boolean }
  }
}
