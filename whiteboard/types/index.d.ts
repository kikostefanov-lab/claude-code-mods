export type Entry = {
  id: string
  title: string
  source: string
  svgPath: string
  svgBytes: number
  createdAt: number
}

export type History = { entries: Entry[]; index: number }

declare module 'claude-code' {
  interface PluginState {
    whiteboard: { history: History; mmdcPath: string | null }
  }
}
