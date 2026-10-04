import type { Entry, History } from '../types'

export const MAX_ENTRIES = 20

export const EMPTY: History = { entries: [], index: -1 }

export function add(h: History, entry: Entry): History {
  const entries = [...h.entries, entry].slice(-MAX_ENTRIES)
  return { entries, index: entries.length - 1 }
}

export function step(h: History, delta: -1 | 1): History {
  if (h.entries.length === 0) return h
  const index = Math.min(h.entries.length - 1, Math.max(0, h.index + delta))
  return index === h.index ? h : { ...h, index }
}

export function current(h: History): Entry | undefined {
  return h.index >= 0 ? h.entries[h.index] : undefined
}

export function replace(h: History, entry: Entry): History {
  return { ...h, entries: h.entries.map(e => (e.id === entry.id ? entry : e)) }
}

export function slug(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return s || 'diagram'
}
