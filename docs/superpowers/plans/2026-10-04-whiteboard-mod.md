# Whiteboard Mod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that gives Claude a `draw` tool which renders Mermaid diagrams locally with `mmdc` and shows them in a "Whiteboard" side pane with flip-through history, Export, Copy and Open.

**Architecture:** One plugin of function hooks. Pure history logic (`history.ts`), the only `mmdc`-touching code (`render.ts`), pane button actions (`actions.ts`) and the engine wiring (`register.tsx`) are separate files. History lives in `$.state`; rendered SVGs live on disk in a per-session temp dir.

**Tech Stack:** Claude Code function-hooks API (early access, engine 2.1.286; CLI 2.1.284), TypeScript/TSX ES modules, `@mermaid-js/mermaid-cli` (`mmdc`), `claude plugin validate` / `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-04-whiteboard-mod-design.md`

**API reference (read when a step's call shape is in doubt):** `/private/tmp/claude-501/bundled-skills/2.1.286/db763d93575313b88ec3c8c03131e02d/plugin-authoring/types/claude-code.d.ts` (grep the name: `'fs.read': {`, `export type PaneOpenArgs`, `declare module 'claude-code/testing'`). If that path is gone (app restarted), load the `plugin-authoring` skill again and use the new path it prints.

## Global Constraints

- Plugin name `whiteboard`; tool `draw` (model sees `mcp__whiteboard__draw`); command `/whiteboard`; pane id `whiteboard`, pane title `Whiteboard`.
- Hooks modules have no DOM and no Node: everything outside goes through `$`. No `Date.now`/`setTimeout` — use `$.clock`.
- `$.state` refs must be **literals in source**: `{ plugin: 'whiteboard', key: 'history' } as const`.
- History cap **20**; title **1–80** chars; render timeout **20000 ms**; inline SVG limit **131072** (bytes, conservative for chars).
- `mmdc` argv: `[mmdc, '-i', <id>.mmd, '-o', <id>.svg, '-b', 'white', '-q']` — argv only, never a shell string containing Mermaid text.
- Temp dir: `$TMPDIR/claude-whiteboard/<session-id>/`. Export dir: `diagrams/` under the session's working directory.
- Hotkeys: `h` previous, `l` next, `o` open.
- Source of truth: `~/Projects/mods/whiteboard/` (git). Hot-reload copy: `~/.claude/dev-mods/40750022-ac16-47f2-afb4-ab4ab3efba36/whiteboard/` (rsync, never edited directly).

## Deviations from the spec (deliberate, small)

1. Source lives in the repo from the first task and is rsynced into the dev-mods folder for hot reload, instead of being built there and moved at the end — gives git history per task.
2. `mmdc` is located lazily on the first draw (and cached once found) rather than at `session.start`, so session start stays fast and an install made mid-session is picked up.
3. `$.process.run` takes no abort signal; interruption relies on the engine abandoning the dispatch, and the 20 s `timeoutMs` bounds the child.
4. The "real mmdc" integration test is a shell smoke script (`scripts/smoke-mmdc.sh`): `claude plugin test` runs with no process access, so it cannot launch `mmdc`.
5. Export/Copy/Open/Re-render helpers live in `hooks/actions.ts` (focused file) rather than in `register.tsx`.

## Review Focus

1. **Claude wraps the Mermaid in ``` fences** — expected: fences stripped, diagram renders. Pinned in Task 3 (`strips code fences`).
2. **Hostile or odd titles** (`../../etc/passwd`, emoji only, 200 chars) — expected: slug stays `[a-z0-9-]`, ≤ 60 chars, export lands under `diagrams/`. Pinned in Task 1 (`slug`) and Task 5 (`export stays under diagrams/`).
3. **Mermaid source containing backticks** — expected: the terminal's Markdown fence still encloses it. Pinned in Task 4 (`fence longer than any backtick run`).
4. **Desktop app's PATH lacks nvm** — expected: `mmdc` found via `zsh -lc`, or via the `mmdcPath` option without spawning a shell. Pinned in Task 2 (`configured path skips the shell`, `locates via login shell`).
5. **Pane cannot open unasked** (narrow terminal) — expected: diagram still recorded, tool result tells Claude to have the user run `/whiteboard`. Pinned in Task 3 (`pane not placed`).

---

## File Structure

```
whiteboard/
  .claude-plugin/plugin.json   manifest: name, version, description, types, userConfig.mmdcPath
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/history.ts             pure: EMPTY, add, step, current, replace, slug
  hooks/render.ts              stripFences, boardDir, locateMmdc, renderMermaid, constants
  hooks/actions.ts             mermaidBlock, exportEntry, copyEntry, openEntry
  hooks/register.tsx           engine wiring: session.start, tool.call, command.run, ui.render
  hooks/testkit.ts             test-only fake host (fs, process, ui, state, env, clock)
  hooks/history.test.ts
  hooks/render.test.ts
  hooks/draw.test.ts
  hooks/pane.test.tsx
  hooks/actions.test.tsx
  types/index.d.ts             PluginState contract + Entry/History types
  scripts/smoke-mmdc.sh        real-mmdc smoke test
```

---

### Task 1: Probe the test kit, scaffold the plugin, history logic

**Files:**
- Create: `whiteboard/.claude-plugin/plugin.json`, `whiteboard/hooks/hooks.json`, `whiteboard/types/index.d.ts`, `whiteboard/hooks/history.ts`, `whiteboard/hooks/history.test.ts`, `whiteboard/hooks/register.tsx` (stub)
- Scratch (not committed): `<scratchpad>/probe/`

**Interfaces:**
- Produces: `type Entry = { id: string; title: string; source: string; svgPath: string; svgBytes: number; createdAt: number }`, `type History = { entries: Entry[]; index: number }` (from `whiteboard/types`); `EMPTY: History`, `MAX_ENTRIES = 20`, `add(h, entry): History`, `step(h, delta: -1 | 1): History`, `current(h): Entry | undefined`, `replace(h, entry): History`, `slug(title): string` (from `hooks/history.ts`).
- Produces (probe findings, written into `whiteboard/hooks/testkit.ts` in Task 2): whether test-kit `state` works without stubs (A), whether `$.tool.call` reaches a plugin tool without a `tool.register` stub (B), and the return form of op-event stubs (C).

- [ ] **Step 1: Write the probe plugin** (scratchpad, throwaway)

`<scratchpad>/probe/.claude-plugin/plugin.json`:
```json
{ "name": "probe", "version": "0.0.1", "description": "test-kit probe", "types": "./types/index.d.ts" }
```
`<scratchpad>/probe/hooks/hooks.json`:
```json
{ "modules": ["./register.ts"] }
```
`<scratchpad>/probe/types/index.d.ts`:
```ts
declare module 'claude-code' {
  interface PluginState {
    probe: { n: number }
  }
}
export {}
```
`<scratchpad>/probe/hooks/register.ts`:
```ts
import { read, update } from 'claude-code'
import type { Register } from 'claude-code'

const n = { plugin: 'probe', key: 'n' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'echo', description: 'Echo.', inputSchema: { type: 'object' } })
    return next(e)
  })
  on('tool.call', { tool: 'mcp__probe__echo' }, async $ => {
    await update($, n, x => (x ?? 0) + 1)
    const text = await $.fs.read('/x')
    return { result: `n=${await read($, n)} text=${text}` }
  })
}
```
`<scratchpad>/probe/hooks/probe.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

test('A+B+C: state, tool reach, op stub form', async ($, on) => {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', () => ({ value: 'hello' }))
  await $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true })
  const r = await $.tool.call({ tool: 'mcp__probe__echo' } as never)
  expect(r).toMatchObject({ result: 'n=1 text=hello' })
})
```

- [ ] **Step 2: Run the probe and record the findings**

Run: `claude plugin test <scratchpad>/probe`
Read the result and failure text, then decide:
- **Passes:** A = state works natively, B = no `tool.register` stub needed, C = op stubs return `{ value }`. Use testkit as written in Task 2 with `STUB_STATE = false`, `STUB_TOOL_REGISTER = false`.
- **Fails naming `state.get`/`state.set` ("bottom hook")** → A false: set `STUB_STATE = true` in Task 2's testkit.
- **Fails naming `tool.register`** → add `on('tool.register', ($, e) => v({ tool: 'mcp__probe__' + e.name }))` to the probe, rerun; if that passes, set `STUB_TOOL_REGISTER = true`. If it now fails with "no tool has that name", stop and report to the user — tool tests then need another route.
- **`text=[object Object]` or a type error on `fs.read`** → C is bare values: change testkit's `v` to `const v = <T>(x: T) => x`.
Rerun after each adjustment until it passes. Write the three findings as a comment at the top of Task 2's `testkit.ts`.

- [ ] **Step 3: Scaffold the plugin files**

`whiteboard/.claude-plugin/plugin.json`:
```json
{
  "name": "whiteboard",
  "version": "0.1.0",
  "description": "Claude draws Mermaid diagrams (UML, flowcharts, sequences) into a side pane with history, export and copy.",
  "types": "./types/index.d.ts",
  "userConfig": {
    "mmdcPath": {
      "type": "string",
      "title": "mmdc path",
      "description": "Absolute path to mermaid-cli's mmdc. Leave empty to find it through your login shell.",
      "default": ""
    }
  }
}
```
`whiteboard/hooks/hooks.json`:
```json
{ "modules": ["./register.tsx"] }
```
`whiteboard/types/index.d.ts`:
```ts
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
```
`whiteboard/hooks/register.tsx` (stub, replaced in Task 3):
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 4: Write the failing history tests**

`whiteboard/hooks/history.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import type { Entry } from '../types'
import { EMPTY, MAX_ENTRIES, add, current, replace, slug, step } from './history'

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
```

- [ ] **Step 5: Run to verify it fails**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 6: Implement `history.ts`**

`whiteboard/hooks/history.ts`:
```ts
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
```

- [ ] **Step 7: Run tests and validate**

Run: `claude plugin test ~/Projects/mods/whiteboard && claude plugin validate ~/Projects/mods/whiteboard`
Expected: all history tests PASS; validate reports no errors (it may note the module registers no hooks yet). If validate rejects the `userConfig` shape, fix the manifest to the shape its message names.

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "feat(whiteboard): scaffold plugin and history logic"
```

---

### Task 2: Test kit and `render.ts`

**Files:**
- Create: `whiteboard/hooks/testkit.ts`, `whiteboard/hooks/render.ts`, `whiteboard/hooks/render.test.ts`

**Interfaces:**
- Consumes: probe findings A/B/C from Task 1.
- Produces (`render.ts`): `RENDER_TIMEOUT_MS = 20000`, `MAX_INLINE_SVG = 131072`, `MISSING_HINT: string`, `type RenderResult = { ok: true; svgPath: string; svgBytes: number } | { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }`, `stripFences(text): string`, `dirname(path): string`, `boardDir($): Promise<string>`, `locateMmdc($): Promise<string | null>`, `renderMermaid($, { source, dir, id, mmdcPath }): Promise<RenderResult>`.
- Produces (`testkit.ts`): `MMDC = '/fake/bin/mmdc'`, `SVG_OK`, `type MmdcMode = 'ok' | 'syntax' | 'timeout' | 'missing'`, `type Fake = { files: Map<string,string>; runs: string[][]; toasts: string[]; copies: string[]; opens: string[]; panes: string[]; mode: MmdcMode; svg: string; placePane: boolean }`, `fakeHost(on): Fake`, `startSession($): Promise<void>`, `asEngine($): EngineInterface`, `errorText(r): string | undefined`.

- [ ] **Step 1: Write the test kit**

`whiteboard/hooks/testkit.ts` (top comment records Task 1's findings; flip the two flags and `v` to match them):
```ts
// Test-kit probe findings (Task 1): A state=<native|stubbed>, B tool.register=<native|stubbed>, C op stubs return <{ value }|bare>
import type { EngineInterface, On } from 'claude-code'
import { mock } from 'claude-code/testing'

const STUB_STATE = false
const STUB_TOOL_REGISTER = false
const v = <T>(x: T) => ({ value: x })

export const MMDC = '/fake/bin/mmdc'
export const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text y="20">ok</text></svg>'

export type MmdcMode = 'ok' | 'syntax' | 'timeout' | 'missing'
export type Fake = {
  files: Map<string, string>
  runs: string[][]
  toasts: string[]
  copies: string[]
  opens: string[]
  panes: string[]
  mode: MmdcMode
  svg: string
  placePane: boolean
}

const parent = (p: string) => (p.lastIndexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : '/')
const ran = (stdout: string, exitCode = 0, stderr = '') =>
  ({ exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false })

export function fakeHost(on: On): Fake {
  const fake: Fake = {
    files: new Map([[MMDC, '#!/usr/bin/env node']]),
    runs: [], toasts: [], copies: [], opens: [], panes: [],
    mode: 'ok', svg: SVG_OK, placePane: true,
  }
  mock.clock(on, { now: 1_760_000_000_000 })
  mock.env(on, { TMPDIR: '/tmp/', PATH: '/usr/bin:/bin', HOME: '/Users/test' })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => v('sess-1'))
  on('command.register', () => v(undefined))
  if (STUB_TOOL_REGISTER) on('tool.register', ($, e) => v({ tool: `mcp__whiteboard__${e.name}` }))

  on('fs.exists', ($, e) => v(
    (fake.mode !== 'missing' || e.path !== MMDC) &&
      (fake.files.has(e.path) || [...fake.files.keys()].some(k => k.startsWith(`${e.path}/`))),
  ))
  on('fs.write', ($, e) => { fake.files.set(e.path, e.text); return v(undefined) })
  on('fs.read', ($, e) => {
    const text = fake.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return v(text)
  })
  on('fs.stat', ($, e) => {
    const text = fake.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return v({ kind: 'file', size: text.length, mtimeMs: 0, isLink: false })
  })
  on('fs.list', ($, e) => v([...fake.files.keys()]
    .filter(k => parent(k) === e.path)
    .map(k => ({ name: k.slice(e.path.length + 1), kind: 'file', size: fake.files.get(k)!.length, mtimeMs: 0, isLink: false }))))

  on('process.run', ($, e) => {
    const argv = [...e.argv]
    fake.runs.push(argv)
    if (argv[0] === '/bin/zsh') return v(ran(`${MMDC}\n`))
    if (argv[0] === 'open') { fake.opens.push(argv[1]!); return v(ran('')) }
    if (fake.mode === 'timeout') throw new Error('process timed out after 20000 ms')
    if (fake.mode === 'syntax') {
      return v(ran('', 1, "Error: Parse error on line 2:\n...A-->>\n------^\nExpecting 'TXT', got 'NEWLINE'"))
    }
    fake.files.set(argv[argv.indexOf('-o') + 1]!, fake.svg)
    return v(ran(''))
  })

  on('ui.open', ($, e) => {
    fake.panes.push(e.id)
    return v(fake.placePane ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is narrower than 144 columns' })
  })
  on('ui.toast', ($, e) => { fake.toasts.push(e.text); return v(undefined) })
  on('ui.copy', ($, e) => { fake.copies.push(e.text); return v({ isCopied: true }) })

  if (STUB_STATE) {
    const cells = new Map<string, { value: unknown; version: number }>()
    const at = (e: { plugin: string; key: string; id?: string }) => `${e.plugin}/${e.key}/${e.id ?? ''}`
    on('state.get', ($, e) => v(cells.get(at(e)) ?? { value: undefined, version: 0 }))
    on('state.set', ($, e) => {
      const cur = cells.get(at(e)) ?? { value: undefined, version: 0 }
      if (e.ifVersion !== undefined && e.ifVersion !== cur.version) return v({ isSet: false, version: cur.version })
      cells.set(at(e), { value: e.value, version: cur.version + 1 })
      return v({ isSet: true, version: cur.version + 1 })
    })
  }
  return fake
}

export async function startSession($: { session: { start: (e: never) => Promise<unknown> } }): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
}

export const asEngine = ($: unknown) => $ as EngineInterface

export function errorText(r: unknown): string | undefined {
  const x = r as { deny?: string; isError?: boolean; text?: string }
  return x.deny ?? (x.isError ? x.text : undefined)
}
```

- [ ] **Step 2: Write the failing render tests**

`whiteboard/hooks/render.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { MAX_INLINE_SVG, boardDir, dirname, locateMmdc, renderMermaid, stripFences } from './render'
import { MMDC, SVG_OK, asEngine, fakeHost } from './testkit'

const SRC = 'sequenceDiagram\n  A->>B: hi'

describe('render', () => {
  test('stripFences', () => {
    expect(stripFences('```mermaid\ngraph TD\n  A-->B\n```')).toBe('graph TD\n  A-->B')
    expect(stripFences('  graph TD; A-->B  ')).toBe('graph TD; A-->B')
    expect(stripFences('~~~\nflowchart LR\n~~~')).toBe('flowchart LR')
  })

  test('dirname', () => {
    expect(dirname('/a/b/mmdc')).toBe('/a/b')
    expect(dirname('/mmdc')).toBe('/')
  })

  test('boardDir is per session under TMPDIR', async ($, on) => {
    fakeHost(on)
    expect(await boardDir(asEngine($))).toBe('/tmp/claude-whiteboard/sess-1')
  })

  test('renders to <id>.svg with the agreed argv', async ($, on) => {
    const fake = fakeHost(on)
    const out = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x1', mmdcPath: MMDC })
    expect(out).toEqual({ ok: true, svgPath: '/tmp/b/x1.svg', svgBytes: SVG_OK.length })
    expect(fake.files.get('/tmp/b/x1.mmd')).toBe(SRC)
    expect(fake.runs.at(-1)).toEqual([MMDC, '-i', '/tmp/b/x1.mmd', '-o', '/tmp/b/x1.svg', '-b', 'white', '-q'])
  })

  test('syntax error carries mmdc stderr', async ($, on) => {
    const fake = fakeHost(on)
    fake.mode = 'syntax'
    const out = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x2', mmdcPath: MMDC })
    expect(out).toMatchObject({ ok: false, kind: 'syntax', message: expect.stringContaining('Parse error on line 2') })
  })

  test('missing mmdc gives the install hint', async ($, on) => {
    const fake = fakeHost(on)
    fake.mode = 'missing'
    const a = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x3', mmdcPath: MMDC })
    const b = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x4', mmdcPath: null })
    for (const out of [a, b]) {
      expect(out).toMatchObject({ ok: false, kind: 'missing', message: expect.stringContaining('npm i -g @mermaid-js/mermaid-cli') })
    }
  })

  test('timeout', async ($, on) => {
    const fake = fakeHost(on)
    fake.mode = 'timeout'
    const out = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x5', mmdcPath: MMDC })
    expect(out).toMatchObject({ ok: false, kind: 'timeout' })
  })

  test('reports size of a large SVG', async ($, on) => {
    const fake = fakeHost(on)
    fake.svg = `<svg>${'x'.repeat(MAX_INLINE_SVG + 10)}</svg>`
    const out = await renderMermaid(asEngine($), { source: SRC, dir: '/tmp/b', id: 'x6', mmdcPath: MMDC })
    expect(out.ok && out.svgBytes > MAX_INLINE_SVG).toBe(true)
  })

  test('locates via login shell', async ($, on) => {
    const fake = fakeHost(on)
    expect(await locateMmdc(asEngine($))).toBe(MMDC)
    expect(fake.runs.at(-1)).toEqual(['/bin/zsh', '-lc', 'command -v mmdc'])
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 4: Implement `render.ts`**

`whiteboard/hooks/render.ts`:
```ts
import type { EngineInterface } from 'claude-code'

export const RENDER_TIMEOUT_MS = 20_000
export const MAX_INLINE_SVG = 131_072
export const MISSING_HINT =
  'mmdc (mermaid-cli) was not found. Install it with `npm i -g @mermaid-js/mermaid-cli`, or set the whiteboard plugin option `mmdcPath` to its absolute path.'

const PARSE_ERROR = /Parse error|Syntax error|Lexical error|No diagram type detected|UnknownDiagramError/i

export type RenderResult =
  | { ok: true; svgPath: string; svgBytes: number }
  | { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }

export function stripFences(text: string): string {
  const t = text.trim()
  const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(t)
  return (m ? m[2]! : t).trim()
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '/'
}

export async function boardDir($: EngineInterface): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  return `${tmp}/claude-whiteboard/${await $.session.id()}`
}

export async function locateMmdc($: EngineInterface): Promise<string | null> {
  try {
    const r = await $.process.run(['/bin/zsh', '-lc', 'command -v mmdc'], { timeoutMs: 10_000 })
    const line = r.stdout.trim().split('\n').pop()?.trim() ?? ''
    return r.exitCode === 0 && line.startsWith('/') ? line : null
  } catch {
    return null
  }
}

export async function renderMermaid(
  $: EngineInterface,
  req: { source: string; dir: string; id: string; mmdcPath: string | null },
): Promise<RenderResult> {
  if (!req.mmdcPath || !(await $.fs.exists(req.mmdcPath))) {
    return { ok: false, kind: 'missing', message: MISSING_HINT }
  }
  const mmd = `${req.dir}/${req.id}.mmd`
  const svg = `${req.dir}/${req.id}.svg`
  await $.fs.write(mmd, req.source)

  const path = (await $.env.get('PATH')) ?? '/usr/bin:/bin'
  const home = await $.env.get('HOME')
  const env: Record<string, string> = { PATH: `${dirname(req.mmdcPath)}:${path}` }
  if (home) env.HOME = home

  let run
  try {
    run = await $.process.run([req.mmdcPath, '-i', mmd, '-o', svg, '-b', 'white', '-q'], {
      timeoutMs: RENDER_TIMEOUT_MS,
      env,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return /tim(e|ed) ?out|still running/i.test(msg)
      ? { ok: false, kind: 'timeout', message: `Rendering took longer than ${RENDER_TIMEOUT_MS / 1000}s and was stopped. Simplify the diagram or split it.` }
      : { ok: false, kind: 'failed', message: `mmdc could not run: ${msg}` }
  }

  if (run.exitCode !== 0) {
    const text = (run.stderr || run.stdout).trim().slice(0, 2000)
    return {
      ok: false,
      kind: PARSE_ERROR.test(text) ? 'syntax' : 'failed',
      message: text || `mmdc exited with code ${run.exitCode}.`,
    }
  }

  const stat = await $.fs.stat(svg).catch(() => undefined)
  if (!stat || stat.kind !== 'file') {
    return { ok: false, kind: 'failed', message: 'mmdc reported success but wrote no SVG.' }
  }
  return { ok: true, svgPath: svg, svgBytes: stat.size }
}
```

- [ ] **Step 5: Run tests**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: history + render tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "feat(whiteboard): mmdc renderer and test kit"
```

---

### Task 3: The `draw` tool

**Files:**
- Modify: `whiteboard/hooks/register.tsx` (replace stub)
- Create: `whiteboard/hooks/draw.test.ts`

**Interfaces:**
- Consumes: `history.ts` (`EMPTY`, `add`), `render.ts` (`MAX_INLINE_SVG`, `boardDir`, `locateMmdc`, `renderMermaid`, `stripFences`), testkit.
- Produces: `PANE = 'whiteboard'`, `TOOL = 'mcp__whiteboard__draw'`, state atoms `history` / `mmdcPath`, `mmdcFor($, configured)`, tool result text `Drawn '<title>' (<n>/<total>).` plus optional notes. Task 4 adds the pane hook and command to this same file.

- [ ] **Step 1: Write the failing tool tests**

`whiteboard/hooks/draw.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { MAX_INLINE_SVG } from './render'
import { MMDC, errorText, fakeHost, startSession } from './testkit'

const TOOL = 'mcp__whiteboard__draw'
const draw = ($: any, title: unknown, mermaid: unknown) => $.tool.call({ tool: TOOL, title, mermaid } as never)

describe('draw', () => {
  test('renders, records and opens the pane', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    const r = await draw($, 'Login flow', 'sequenceDiagram\n  U->>S: login')
    expect(r).toMatchObject({ result: "Drawn 'Login flow' (1/1)." })
    expect(fake.panes).toEqual(['whiteboard'])
    expect([...fake.files.keys()].some(k => k.endsWith('.svg'))).toBe(true)
    const r2 = await draw($, 'Second', 'graph TD; A-->B')
    expect(r2).toMatchObject({ result: "Drawn 'Second' (2/2)." })
  })

  test('strips code fences', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Fenced', '```mermaid\ngraph TD; A-->B\n```')
    const mmd = [...fake.files.entries()].find(([k]) => k.endsWith('.mmd'))
    expect(mmd?.[1]).toBe('graph TD; A-->B')
  })

  test('syntax error comes back as an error and is not recorded', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'syntax'
    const r = await draw($, 'Broken', 'sequenceDiagram\n  A-->>')
    expect(errorText(r)).toContain('Parse error on line 2')
    fake.mode = 'ok'
    const ok = await draw($, 'Fixed', 'sequenceDiagram\n  A->>B: hi')
    expect(ok).toMatchObject({ result: "Drawn 'Fixed' (1/1)." })
  })

  test('validates input', async ($, on) => {
    fakeHost(on)
    await startSession($)
    expect(errorText(await draw($, 'T', '   '))).toContain('mermaid')
    expect(errorText(await draw($, '', 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'x'.repeat(81), 'graph TD; A-->B'))).toContain('title')
    expect(errorText(await draw($, 'T', 42))).toContain('mermaid')
  })

  test('missing mmdc gives the install hint', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.mode = 'missing'
    expect(errorText(await draw($, 'T', 'graph TD; A-->B'))).toContain('npm i -g @mermaid-js/mermaid-cli')
  })

  test('configured path skips the shell', { options: { mmdcPath: MMDC } }, async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'T', 'graph TD; A-->B')
    expect(fake.runs.some(r => r[0] === '/bin/zsh')).toBe(false)
  })

  test('locates mmdc once and caches it', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'A', 'graph TD; A-->B')
    await draw($, 'B', 'graph TD; A-->B')
    expect(fake.runs.filter(r => r[0] === '/bin/zsh')).toHaveLength(1)
  })

  test('oversized SVG is kept with a note', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.svg = `<svg>${'x'.repeat(MAX_INLINE_SVG + 1)}</svg>`
    const r = await draw($, 'Huge', 'graph TD; A-->B')
    expect((r as { result: string }).result).toMatch(/^Drawn 'Huge' \(1\/1\)\. The SVG is too large/)
  })

  test('pane not placed', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    fake.placePane = false
    const r = await draw($, 'Narrow', 'graph TD; A-->B')
    expect((r as { result: string }).result).toContain('/whiteboard')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: draw tests FAIL (tool not registered / no hook answers).

- [ ] **Step 3: Implement the tool in `register.tsx`**

`whiteboard/hooks/register.tsx`:
```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'
import { EMPTY, add } from './history'
import { MAX_INLINE_SVG, boardDir, locateMmdc, renderMermaid, stripFences } from './render'

export const PANE = 'whiteboard'
export const TOOL = 'mcp__whiteboard__draw'

const history = atom({ plugin: 'whiteboard', key: 'history' } as const, EMPTY)
const mmdcPath = atom({ plugin: 'whiteboard', key: 'mmdcPath' } as const, null)

const DESCRIPTION = [
  "Draw a Mermaid diagram on the user's whiteboard pane, beside the conversation.",
  'Use it whenever a diagram explains a design, structure or process better than prose:',
  'UML class, sequence, state and ER diagrams, flowcharts, gantt charts, C4-style architecture.',
  'Pass the raw Mermaid source (no ``` fences) and a short title (at most 80 characters).',
  'The diagram is rendered before this tool returns: a Mermaid syntax error comes back as an error,',
  'so fix the source and call again. Earlier diagrams stay in the pane history.',
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80, description: 'Short title shown above the diagram.' },
    mermaid: {
      type: 'string',
      description: 'Mermaid source starting with the diagram type (sequenceDiagram, classDiagram, flowchart TD, ...).',
    },
  },
  required: ['title', 'mermaid'],
  additionalProperties: false,
}

async function newId($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('')
  return `${now.toString(36)}-${rand}`
}

async function mmdcFor($: EngineInterface, configured: string): Promise<string | null> {
  if (configured) return configured
  const cached = await read($, mmdcPath)
  if (cached) return cached
  const found = await locateMmdc($)
  if (found) await update($, mmdcPath, () => found)
  return found
}

export const register: Register = (on, options) => {
  const configured = typeof options.mmdcPath === 'string' ? options.mmdcPath.trim() : ''

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'draw', description: DESCRIPTION, inputSchema: INPUT_SCHEMA })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const args = e as unknown as { title?: unknown; mermaid?: unknown }
    const title = typeof args.title === 'string' ? args.title.trim() : ''
    const source = typeof args.mermaid === 'string' ? stripFences(args.mermaid) : ''
    if (!source) return { deny: 'draw needs `mermaid`: the Mermaid source of the diagram.' }
    if (!title || title.length > 80) return { deny: 'draw needs a `title` of 1 to 80 characters.' }

    const id = await newId($)
    const out = await renderMermaid($, { source, dir: await boardDir($), id, mmdcPath: await mmdcFor($, configured) })
    if (!out.ok) return { deny: out.message }

    const entry: Entry = { id, title, source, svgPath: out.svgPath, svgBytes: out.svgBytes, createdAt: await $.clock.now() }
    await update($, history, h => add(h ?? EMPTY, entry))
    const h = (await read($, history)) ?? EMPTY
    const at = h.entries.findIndex(x => x.id === id) + 1

    const opened = await $.ui.open({ id: PANE, title: 'Whiteboard' })
    const notes = [
      out.svgBytes > MAX_INLINE_SVG
        ? 'The SVG is too large to show inline: the pane shows its Mermaid source and an Open button. Consider splitting the diagram.'
        : '',
      opened.isPlaced ? '' : `The pane did not open (${opened.reason}); tell the user to run /whiteboard to see it.`,
    ].filter(Boolean)

    return { result: [`Drawn '${title}' (${at}/${h.entries.length}).`, ...notes].join(' ') }
  }).catch(() => ({ deny: 'The whiteboard hit an unexpected error while drawing. Try again; if it repeats, tell the user.' }))
}
```

- [ ] **Step 4: Run tests and validate**

Run: `claude plugin test ~/Projects/mods/whiteboard && claude plugin validate ~/Projects/mods/whiteboard`
Expected: all PASS; validate lists hooks `session.start`, `tool.call`, state keys `whiteboard.history` / `whiteboard.mmdcPath`, no refusals. If a test sees `isError`/`text` instead of `deny`, `errorText` already covers it; if `result` arrives wrapped differently, adjust the assertion to `errorText`'s sibling shape and note it in testkit's header comment.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "feat(whiteboard): draw tool renders and records diagrams"
```

---

### Task 4: The pane, navigation and `/whiteboard`

**Files:**
- Create: `whiteboard/hooks/actions.ts` (only `mermaidBlock` in this task), `whiteboard/hooks/pane.test.tsx`
- Modify: `whiteboard/hooks/register.tsx`

**Interfaces:**
- Consumes: Task 3's `register.tsx` (`PANE`, `history`, `configured`), `history.ts` (`current`, `step`), `render.ts` (`MAX_INLINE_SVG`).
- Produces: `mermaidBlock(source): string`; pane element keys `prev`, `next`, `position`, `title`, `export`, `copy`, `open`, `rerender`, `note`, `diagram` (Svg) / `source` (Markdown); command `whiteboard`. Task 5 attaches handlers to `export`, `copy`, `open`, `rerender`.

- [ ] **Step 1: Write the failing pane tests**

`whiteboard/hooks/pane.test.tsx`:
```tsx
import { describe, expect, test } from 'claude-code/testing'

import { fakeHost, startSession } from './testkit'

const SURFACES = ['terminal', 'desktop'] as const
const PROPS = {
  title: 'Whiteboard', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
const mount = ($: any, surface: (typeof SURFACES)[number] | 'vscode') =>
  $.ui.mount({
    plugin: 'whiteboard', surface, component: 'Pane', requestId: 'whiteboard', props: PROPS,
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  })
const draw = ($: any, title: string, mermaid: string) =>
  $.tool.call({ tool: 'mcp__whiteboard__draw', title, mermaid } as never)

describe('pane', () => {
  test('empty state', async ($, on) => {
    fakeHost(on)
    await startSession($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /Claude draws here/ })).toBeDefined()
      await ui.unmount()
    }
  })

  test('desktop shows SVG, terminal shows source', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Flow', 'graph TD; A-->B')
    const desk = await mount($, 'desktop')
    expect(await desk.find({ type: 'Svg', key: 'diagram' })).toBeDefined()
    expect(await desk.find({ type: 'Markdown' })).toBeUndefined()
    await desk.unmount()
    const term = await mount($, 'terminal')
    expect((await term.find({ type: 'Markdown', key: 'source' }))?.text).toContain('graph TD; A-->B')
    expect(await term.find({ type: 'Svg' })).toBeUndefined()
    await term.unmount()
  })

  test('prev/next walk history and clamp', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'First', 'graph TD; A-->B')
    await draw($, 'Second', 'graph TD; C-->D')
    for (const surface of SURFACES) {
      let ui = await mount($, surface)
      expect((await ui.find({ key: 'position' }))?.text).toBe('2/2')
      expect((await ui.find({ key: 'title' }))?.text).toBe('Second')
      await ui.press({ key: 'prev' })
      await ui.press({ key: 'prev' })
      await ui.unmount()
      ui = await mount($, surface)
      expect((await ui.find({ key: 'position' }))?.text).toBe('1/2')
      expect((await ui.find({ key: 'title' }))?.text).toBe('First')
      await ui.press({ key: 'next' })
      await ui.unmount()
    }
  })

  test('fence longer than any backtick run', async ($, on) => {
    fakeHost(on)
    await startSession($)
    await draw($, 'Ticks', 'graph TD; A["```code```"]-->B')
    const ui = await mount($, 'terminal')
    const text = (await ui.find({ key: 'source' }))?.text ?? ''
    expect(text.startsWith('````mermaid\n')).toBe(true)
    expect(text.endsWith('\n````')).toBe(true)
    await ui.unmount()
  })

  test('/whiteboard opens the pane', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    const r = await $.command.run({ command: 'whiteboard', args: '' } as never)
    expect(fake.panes).toContain('whiteboard')
    expect(r).toMatchObject({ text: 'Whiteboard opened.' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: pane tests FAIL (no render hook; engine draws its own / elements not found).

- [ ] **Step 3: Implement `mermaidBlock`**

`whiteboard/hooks/actions.ts`:
```ts
export function mermaidBlock(source: string): string {
  const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}mermaid\n${source}\n${fence}`
}
```

- [ ] **Step 4: Add the pane and command to `register.tsx`**

Add to the imports:
```tsx
import { EMPTY, add, current, step } from './history'
import { mermaidBlock } from './actions'
```
(replacing the previous `import { EMPTY, add } from './history'` line).

Add below `INPUT_SCHEMA`:
```tsx
const EMPTY_HINT =
  'Claude draws here when a diagram would help: ask for a sequence, class, state or ER diagram, a flowchart or an architecture sketch.'
```

Inside `register`, after the `session.start` hook's `$.tool.register(...)` line, add:
```tsx
    await $.command.register({ name: 'whiteboard', description: "Open the whiteboard pane with Claude's diagrams" })
```

Inside `register`, after the `tool.call` hook, add:
```tsx
  on('command.run', { command: 'whiteboard' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Whiteboard', focus: true })
    return { text: opened.isPlaced ? 'Whiteboard opened.' : `Whiteboard could not open: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const h = (await read($, history)) ?? EMPTY
    const entry = current(h)
    if (!entry) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{EMPTY_HINT}</Text>
        </Box>
      )
    }

    const Svg = 'Svg' in els ? els.Svg : undefined
    const isMissing = !(await $.fs.exists(entry.svgPath))
    const isTooLarge = entry.svgBytes > MAX_INLINE_SVG
    const svg = Svg && !isMissing && !isTooLarge ? await $.fs.read(entry.svgPath).catch(() => undefined) : undefined
    const note = isMissing
      ? 'Render missing (temp files were cleaned up).'
      : Svg && isTooLarge
        ? 'Too large to show inline: press Open to view it.'
        : ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="prev" hotkey="h" plain label="◀" dimColor={h.index <= 0}
            onPress={() => update($, history, x => step(x ?? EMPTY, -1))} />
          <Text key="position">{`${h.index + 1}/${h.entries.length}`}</Text>
          <Button key="next" hotkey="l" plain label="▶" dimColor={h.index >= h.entries.length - 1}
            onPress={() => update($, history, x => step(x ?? EMPTY, 1))} />
          <Text key="title" bold>{entry.title}</Text>
          <Button key="export" label="Export" onPress={() => undefined} />
          <Button key="copy" label="Copy" onPress={() => undefined} />
          <Button key="open" hotkey="o" label="Open" onPress={() => undefined} />
        </Box>
        {note ? (
          <Box flexDirection="row" gap={1}>
            <Text key="note" dimColor>{note}</Text>
            {isMissing ? <Button key="rerender" label="Re-render" onPress={() => undefined} /> : null}
          </Box>
        ) : null}
        {Svg && svg !== undefined
          ? <Svg key="diagram" source={svg} alt={entry.title} />
          : <Markdown key="source" text={mermaidBlock(entry.source)} />}
      </Box>
    )
  })
```

- [ ] **Step 5: Run tests and validate**

Run: `claude plugin test ~/Projects/mods/whiteboard && claude plugin validate ~/Projects/mods/whiteboard`
Expected: all PASS. If a mount rejects with "a tree that does not validate", the reason names the element/prop: fix that prop (e.g. a `Svg` with `key` not allowed → drop `key="diagram"` and in the test find by `{ type: 'Svg' }`). If `find({ key: 'position' })` returns the old value after `press`, the remount already covers it; if presses themselves fail, check that `update` is imported from `'claude-code'`.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "feat(whiteboard): pane with history navigation and /whiteboard"
```

---

### Task 5: Export, Copy, Open, Re-render

**Files:**
- Modify: `whiteboard/hooks/actions.ts`, `whiteboard/hooks/register.tsx`
- Create: `whiteboard/hooks/actions.test.tsx`

**Interfaces:**
- Consumes: `slug` (history.ts), `renderMermaid`/`boardDir` (render.ts), `mmdcFor`/`history`/`configured` (register.tsx), pane keys from Task 4.
- Produces: `exportEntry($, entry): Promise<string>` (toast text), `copyEntry($, entry, surface): Promise<string>`, `openEntry($, entry): Promise<string | undefined>`; `replace` used for re-render.

- [ ] **Step 1: Write the failing action tests**

`whiteboard/hooks/actions.test.tsx`:
```tsx
import { describe, expect, test } from 'claude-code/testing'

import { fakeHost, startSession } from './testkit'

const PROPS = {
  title: 'Whiteboard', isFocused: true, bodyColumns: 80, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}
const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'whiteboard', surface, component: 'Pane', requestId: 'whiteboard', props: PROPS,
    viewport: { columns: 160, rows: 50, isFullscreen: true },
  })
const draw = ($: any, title: string, mermaid: string) =>
  $.tool.call({ tool: 'mcp__whiteboard__draw', title, mermaid } as never)
const svgPathOf = (files: Map<string, string>) => [...files.keys()].find(k => k.startsWith('/tmp/claude-whiteboard/') && k.endsWith('.svg'))!

describe('actions', () => {
  test('export writes .mmd and .svg, suffixing on collision', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Auth Flow', 'sequenceDiagram\n  A->>B: hi')
    fake.files.set('diagrams/auth-flow.mmd', 'old')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'export' })
    expect(fake.files.get('diagrams/auth-flow-2.mmd')).toBe('sequenceDiagram\n  A->>B: hi\n')
    expect(fake.files.get('diagrams/auth-flow-2.svg')).toContain('<svg')
    expect(fake.toasts.at(-1)).toContain('diagrams/auth-flow-2')
    await ui.unmount()
  })

  test('export stays under diagrams/', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, '../../etc/passwd', 'graph TD; A-->B')
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'export' })
    const written = [...fake.files.keys()].filter(k => !k.startsWith('/'))
    expect(written).toEqual(['diagrams/etc-passwd.mmd', 'diagrams/etc-passwd.svg'])
    await ui.unmount()
  })

  test('copy puts the source on the clipboard', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'C', 'graph TD; A-->B')
    const ui = await mount($, 'desktop')
    await ui.press({ key: 'copy' })
    expect(fake.copies).toEqual(['graph TD; A-->B'])
    expect(fake.toasts.at(-1)).toBe('Copied the Mermaid source.')
    await ui.unmount()
  })

  test('open opens the SVG from the temp dir', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'O', 'graph TD; A-->B')
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'open' })
    expect(fake.opens).toEqual([svgPathOf(fake.files)])
    await ui.unmount()
  })

  test('missing render: note, then re-render restores it', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'M', 'graph TD; A-->B')
    const svg = svgPathOf(fake.files)
    fake.files.delete(svg)
    let ui = await mount($, 'desktop')
    expect((await ui.find({ key: 'note' }))?.text).toMatch(/Render missing/)
    await ui.press({ key: 'rerender' })
    await ui.unmount()
    expect(fake.files.has(svg)).toBe(true)
    ui = await mount($, 'desktop')
    expect(await ui.find({ key: 'note' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  })

  test('export without an SVG writes the .mmd and says so', async ($, on) => {
    const fake = fakeHost(on)
    await startSession($)
    await draw($, 'Gone', 'graph TD; A-->B')
    fake.files.delete(svgPathOf(fake.files))
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'export' })
    expect(fake.files.has('diagrams/gone.mmd')).toBe(true)
    expect(fake.files.has('diagrams/gone.svg')).toBe(false)
    expect(fake.toasts.at(-1)).toContain('SVG missing')
    await ui.unmount()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `claude plugin test ~/Projects/mods/whiteboard`
Expected: action tests FAIL (handlers are no-ops).

- [ ] **Step 3: Implement the actions**

Append to `whiteboard/hooks/actions.ts`:
```ts
import type { EngineInterface, RenderSurface } from 'claude-code'

import type { Entry } from '../types'
import { slug } from './history'

const EXPORT_DIR = 'diagrams'

async function freeBase($: EngineInterface, base: string): Promise<string> {
  const taken = new Set(
    (await $.fs.exists(EXPORT_DIR)) ? (await $.fs.list(EXPORT_DIR)).map(f => f.name) : [],
  )
  let name = base
  for (let n = 2; taken.has(`${name}.mmd`) || taken.has(`${name}.svg`); n++) name = `${base}-${n}`
  return name
}

export async function exportEntry($: EngineInterface, entry: Entry): Promise<string> {
  const path = `${EXPORT_DIR}/${await freeBase($, slug(entry.title))}`
  const svg = await $.fs.read(entry.svgPath).catch(() => undefined)
  await $.fs.write(`${path}.mmd`, `${entry.source}\n`)
  if (svg === undefined) return `Exported ${path}.mmd (SVG missing: press Re-render, then export again).`
  await $.fs.write(`${path}.svg`, svg)
  return `Exported ${path}.mmd and ${path}.svg`
}

export async function copyEntry($: EngineInterface, entry: Entry, surface: RenderSurface): Promise<string> {
  const r = await $.ui.copy({ text: entry.source, surface })
  return r.isCopied ? 'Copied the Mermaid source.' : `Could not copy: ${r.reason}`
}

export async function openEntry($: EngineInterface, entry: Entry): Promise<string | undefined> {
  if (!(await $.fs.exists(entry.svgPath))) return 'Render missing: press Re-render first.'
  const r = await $.process.run(['open', entry.svgPath], { timeoutMs: 5_000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? undefined : 'Could not open the SVG.'
}
```
Move the `import` lines to the top of `actions.ts` (above `mermaidBlock`).

- [ ] **Step 4: Wire the handlers in `register.tsx`**

Update imports:
```tsx
import { EMPTY, add, current, replace, step } from './history'
import { copyEntry, exportEntry, mermaidBlock, openEntry } from './actions'
```
Add inside `register`, before the `ui.render` hook:
```tsx
  const rerender = async ($: EngineInterface, entry: Entry) => {
    const out = await renderMermaid($, { source: entry.source, dir: await boardDir($), id: entry.id, mmdcPath: await mmdcFor($, configured) })
    if (!out.ok) { $.ui.toast(`Re-render failed: ${out.message.split('\n')[0]}`); return }
    await update($, history, h => replace(h ?? EMPTY, { ...entry, svgPath: out.svgPath, svgBytes: out.svgBytes }))
  }
```
Replace the four placeholder `onPress={() => undefined}` handlers in the pane:
```tsx
          <Button key="export" label="Export" onPress={async () => $.ui.toast(await exportEntry($, entry))} />
          <Button key="copy" label="Copy" onPress={async p => $.ui.toast(await copyEntry($, entry, p.surface))} />
          <Button key="open" hotkey="o" label="Open" onPress={async () => {
            const problem = await openEntry($, entry)
            if (problem) $.ui.toast(problem)
          }} />
```
and
```tsx
            {isMissing ? <Button key="rerender" label="Re-render" onPress={() => rerender($, entry)} /> : null}
```

- [ ] **Step 5: Run tests and validate**

Run: `claude plugin test ~/Projects/mods/whiteboard && claude plugin validate ~/Projects/mods/whiteboard`
Expected: all PASS, no refusals.

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "feat(whiteboard): export, copy, open and re-render"
```

---

### Task 6: Install mmdc, smoke test, verify in the real app

**Files:**
- Create: `whiteboard/scripts/smoke-mmdc.sh`

**Interfaces:**
- Consumes: the finished plugin; the `PARSE_ERROR` regex in `render.ts` (validated against real stderr here).

- [ ] **Step 1: Install mermaid-cli** (user already approved)

Run: `npm i -g @mermaid-js/mermaid-cli && zsh -lc 'command -v mmdc && mmdc --version'`
Expected: a path under `~/.nvm/versions/node/v22.22.1/bin/mmdc` and a version number. If the Chromium download fails, report the npm error to the user and stop.

- [ ] **Step 2: Write the smoke script**

`whiteboard/scripts/smoke-mmdc.sh`:
```bash
#!/bin/zsh -l
# Renders one good and one broken diagram with the real mmdc, using the plugin's argv.
set -euo pipefail
MMDC=$(command -v mmdc)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

printf 'sequenceDiagram\n  Alice->>Bob: hi\n' > "$tmp/good.mmd"
"$MMDC" -i "$tmp/good.mmd" -o "$tmp/good.svg" -b white -q
head -c 400 "$tmp/good.svg" | grep -q '<svg' || { echo "FAIL: no <svg> in output"; exit 1; }
echo "OK: rendered $(wc -c < "$tmp/good.svg" | tr -d ' ') bytes"

printf 'sequenceDiagram\n  Alice-->>\n' > "$tmp/bad.mmd"
if "$MMDC" -i "$tmp/bad.mmd" -o "$tmp/bad.svg" -b white -q 2> "$tmp/err"; then
  echo "FAIL: broken diagram rendered"; exit 1
fi
grep -qiE 'parse error|syntax error|lexical error|no diagram type detected|unknowndiagramerror' "$tmp/err" \
  && echo "OK: syntax error recognised" \
  || { echo "FAIL: stderr not matched by PARSE_ERROR:"; cat "$tmp/err"; exit 1; }
```

- [ ] **Step 3: Run it**

Run: `chmod +x ~/Projects/mods/whiteboard/scripts/smoke-mmdc.sh && ~/Projects/mods/whiteboard/scripts/smoke-mmdc.sh`
Expected: two `OK:` lines. If the second fails with unmatched stderr, add the distinguishing phrase to `PARSE_ERROR` in `render.ts` and to the grep, rerun the smoke script and `claude plugin test`.

- [ ] **Step 4: Commit**

```bash
cd ~/Projects/mods && git add whiteboard && git commit -m "test(whiteboard): real mmdc smoke script"
```

- [ ] **Step 5: Load into this session with hot reload**

Run: `rsync -a --delete ~/Projects/mods/whiteboard/ ~/.claude/dev-mods/40750022-ac16-47f2-afb4-ab4ab3efba36/whiteboard/`
The engine asks the user "Enable hot reloading for this session?" — the user picks **Enable for this session**. The mod loads when the turn ends. (Every later code change: edit in the repo, rerun this rsync.)

- [ ] **Step 6: Manual verification in the desktop Code tab** (next turn, after the load notice)

Call `mcp__whiteboard__draw` three times and check each with the user:
1. A sequence diagram (e.g. the draw flow of this mod itself) → pane opens, SVG rendered on white, `1/1`.
2. A class diagram of `Entry`/`History`/`RenderResult` → `2/2`; ◀ shows the first again.
3. A deliberately broken diagram → error comes back; Claude fixes and redraws in the same turn; history has no broken entry.
Then the user presses Export (files appear under `diagrams/`), Copy (paste somewhere), Open (browser shows the SVG). Delete the exported `diagrams/` folder afterwards if the user doesn't want it.
Any defect: fix in the repo with a failing test first, rerun tests, rsync, retry.

---

### Task 7: Load it everywhere

**Files:**
- Modify (with the user's explicit OK): `~/.claude/settings.json` (`env` block)

- [ ] **Step 1: Ask the user** to approve adding `CLAUDE_CODE_PLUGIN_DIRS` = `/Users/kikostefanov/Projects/mods/whiteboard` to the `env` block of `~/.claude/settings.json`. If the key already exists, append with `:`. Do not proceed without a yes.

- [ ] **Step 2: Apply the change**

Read `~/.claude/settings.json`, then edit it to include:
```json
"env": {
  "CLAUDE_CODE_PLUGIN_DIRS": "/Users/kikostefanov/Projects/mods/whiteboard"
}
```
merged into any existing `env` object (keep every other key).

- [ ] **Step 3: Remove the hot-reload copy** so the next session doesn't load the plugin twice

Run: `rm -rf ~/.claude/dev-mods/40750022-ac16-47f2-afb4-ab4ab3efba36/whiteboard`

- [ ] **Step 4: CLI check** (user runs it, in iTerm2)

```bash
claude --plugin-dir ~/Projects/mods/whiteboard
```
Ask Claude for a small flowchart; run `/whiteboard` if the window is under 144 columns. Expected: the pane shows the Mermaid source and Open (`o`) opens the SVG in the browser. Then a fresh desktop session confirms the plugin loads from settings without the flag.

- [ ] **Step 5: Commit any fixes**

```bash
cd ~/Projects/mods && git add -A whiteboard && git commit -m "chore(whiteboard): post-verification fixes" || echo "nothing to commit"
```
