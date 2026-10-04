export type Entry = {
  id: string
  title: string
  source: string
  /** Absent on entries saved before 0.2.0: Mermaid. */
  language?: 'mermaid' | 'd2' | 'plantuml'
  svgPath: string
  svgBytes: number
  /** A PNG for kitty-protocol terminals, when one was rendered. */
  pngPath?: string
  pngWidth?: number
  pngHeight?: number
  createdAt: number
}

export type History = { entries: Entry[]; index: number }

declare module 'claude-code' {
  interface PluginState {
    whiteboard: {
      history: History
      /** Located renderer and tool binaries by name (mmdc, d2, plantuml, gh). */
      bins: Record<string, string>
      /** The entry whose Share is waiting for a yes, if any. */
      shareConfirm: string | null
    }
  }
}
