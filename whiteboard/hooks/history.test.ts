import { describe, expect, test } from 'claude-code/testing'

import type { Entry } from '../types'
import { EMPTY, MAX_ENTRIES, add, current, dropped, isHistory, jumpTo, replace, slug, step } from './history'

const entry = (id: string): Entry => ({
  id, title: `T${id}`, source: 'graph TD; A-->B', svgPath: `/t/${id}.svg`, svgBytes: 10, createdAt: 0,
})

describe('history', () => {
  test('empty has no current entry', () => {
    expect(EMPTY).toEqual({ entries: [], index: -1 })
    expect(current(EMPTY)).toBeUndefined()
  })

  test('add appends and jumps to the new entry', () => {
    const h = add(add(EMPTY, entry('a')), entry('b'))
    expect(h.index).toBe(1)
    expect(current(h)?.id).toBe('b')
  })

  test('add drops the oldest past the cap', () => {
    let h = EMPTY
    for (let i = 0; i < MAX_ENTRIES + 3; i++) h = add(h, entry(String(i)))
    expect(h.entries).toHaveLength(MAX_ENTRIES)
    expect(h.entries[0]?.id).toBe('3')
    expect(h.index).toBe(MAX_ENTRIES - 1)
  })

  test('step clamps at both ends', () => {
    const h = add(add(EMPTY, entry('a')), entry('b'))
    expect(step(h, 1).index).toBe(1)
    expect(step(step(step(h, -1), -1), -1).index).toBe(0)
    expect(step(EMPTY, -1)).toEqual(EMPTY)
  })

  test('replace swaps the entry with the same id and keeps the index', () => {
    const h = step(add(add(EMPTY, entry('a')), entry('b')), -1)
    const r = replace(h, { ...entry('b'), svgBytes: 99 })
    expect(r.index).toBe(0)
    expect(r.entries[1]?.svgBytes).toBe(99)
  })

  test('slug', () => {
    expect(slug('Checkout Sequence')).toBe('checkout-sequence')
    expect(slug('../../etc/passwd')).toBe('etc-passwd')
    expect(slug('Café — Überblick')).toBe('cafe-uberblick')
    expect(slug('🚀🚀')).toBe('diagram')
    expect(slug('')).toBe('diagram')
    expect(slug('x'.repeat(200))).toHaveLength(60)
    expect(slug('a '.repeat(40))).toMatch(/^[a-z0-9-]+$/)
    expect(slug('a '.repeat(40)).endsWith('-')).toBe(false)
  })
})

describe('history (0.2)', () => {
  test('jumpTo moves within range only', () => {
    const h = add(add(EMPTY, entry('a')), entry('b'))
    expect(jumpTo(h, 0).index).toBe(0)
    expect(jumpTo(h, 5)).toBe(h)
    expect(jumpTo(h, -1)).toBe(h)
  })

  test('dropped lists entries the cap pushed out', () => {
    let h = EMPTY
    for (let i = 0; i < MAX_ENTRIES; i++) h = add(h, entry(String(i)))
    expect(dropped(h, add(h, entry('new'))).map(e => e.id)).toEqual(['0'])
  })

  test('isHistory', () => {
    expect(isHistory(add(EMPTY, entry('a')))).toBe(true)
    expect(isHistory({ entries: [{ id: 1 }], index: 0 })).toBe(false)
    expect(isHistory(undefined)).toBe(false)
  })
})
