// Kiko's art: a boxer with block gloves up, a punching bag, and the K.O. letters. Every
// frame of a figure is the same size and uses only art characters (see isArtChar).

export type Frame = readonly [string, string, string]

const KIKO_W = 11
const BAG_W = 6
const pad = (s: string, w: number) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length))
// `x` shifts the figure right, for bobbing and sidesteps.
const kiko = (top: string, face: string, legs: string, x = 0): Frame => {
  const at = ' '.repeat(x)
  return [pad(at + top, KIKO_W), pad(at + face, KIKO_W), pad(at + legs, KIKO_W)]
}
const bag = (fill: string, x: number): Frame => {
  const at = ' '.repeat(x)
  return [pad(`${at}┌┴┐`, BAG_W), pad(`${at}│${fill}│`, BAG_W), pad(`${at}└─┘`, BAG_W)]
}

const HEAD = '  .---.'
const STANCE = '   / \\'
const LUNGE = '   /  \\'
// Gloves up either side of the face; a face is five characters, `(o.o)`.
const guard = (face: string) => `▄█${face}█▄`
const reach = (face: string) => `▄█${face}==█▄`

export const SPRITES = {
  guard: [kiko(HEAD, guard('(o.o)'), STANCE), kiko(HEAD, guard('(o.o)'), STANCE, 1)],
  thinking: [
    kiko(`${HEAD} ?`, guard('(o.o)'), STANCE), kiko(`${HEAD}  ?`, guard('(@.@)'), STANCE),
    kiko(`${HEAD} ? ?`, guard('(-.-)'), STANCE), kiko(`${HEAD}  ?`, guard('(@.@)'), STANCE),
  ],
  responding: [kiko(HEAD, guard('(o.o)'), STANCE), kiko(HEAD, guard('(oOo)'), STANCE), kiko(HEAD, guard('(o-o)'), STANCE)],
  // Gloves open for the incoming file, then clamp on it.
  chomp: [
    kiko(HEAD, '▀█(O.O)█▀', STANCE), kiko(HEAD, '▀█(O.O)█▀', STANCE),
    kiko(HEAD, guard('(>.<)'), STANCE), kiko(HEAD, guard('(^.^)'), STANCE),
  ],
  punch: [kiko(HEAD, guard('(>.<)'), STANCE), kiko(HEAD, reach('(>.<)'), LUNGE), kiko(HEAD, reach('(^.^)'), LUNGE)],
  dodge: [kiko(HEAD, guard('(>.>)'), STANCE), kiko(HEAD, guard('(<.<)'), STANCE, 2)],
} as const

// The bag hangs still; a hit flashes it and swings it right, then it swings back.
export const BAG = {
  idle: [bag('█', 1)],
  hit: [bag('░', 2), bag('█', 3), bag('█', 2)],
} as const

export const KO_LETTERS: readonly string[] = ['╦╔═ ╔═╗  ', '╠╩╗ ║ ║  ', '╩ ╩o╚═╝o ']

export function isArtChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return ch.length === 1 && ((c >= 0x20 && c <= 0x7e) || (c >= 0x2500 && c <= 0x259f) || c === 0x2039 || c === 0x203a)
}
