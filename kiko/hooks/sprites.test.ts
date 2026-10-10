import { describe, expect, test } from 'claude-code/testing'

import { BAG, KO_LETTERS, SPRITES, isArtChar } from './sprites'

describe('sprites', () => {
  test('every frame is the same size and uses only art characters', () => {
    const all: (readonly string[])[] = [...Object.values(SPRITES).flat(), ...Object.values(BAG).flat(), KO_LETTERS]
    const width = (f: readonly string[]) => f[0]!.length
    for (const f of Object.values(SPRITES).flat()) {
      expect(f).toHaveLength(3)
      expect(f.every(row => row.length === width(SPRITES.guard[0]!))).toBe(true)
    }
    for (const f of Object.values(BAG).flat()) {
      expect(f).toHaveLength(3)
      expect(f.every(row => row.length === width(BAG.idle[0]!))).toBe(true)
    }
    for (const f of all) for (const row of f) for (const ch of row) expect(isArtChar(ch), `bad char ${JSON.stringify(ch)}`).toBe(true)
  })

  test('isArtChar', () => {
    expect(isArtChar('a')).toBe(true)
    expect(isArtChar('█')).toBe(true)
    expect(isArtChar('╦')).toBe(true)
    expect(isArtChar('›')).toBe(true)
    expect(isArtChar('ノ')).toBe(false)
    expect(isArtChar('·')).toBe(false)
    expect(isArtChar('😀')).toBe(false)
  })
})
