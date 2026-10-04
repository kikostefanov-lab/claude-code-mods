# Whiteboard mod — design

**Date:** 2026-10-04
**Status:** Draft, awaiting review
**Context:** First mod in the "explore what Claude Code mods can do" effort. It exercises the model-callable tool API (`$.tool.register` + `tool.call`), the side pane (`$.ui.open` + `ui.render` on `Pane`), session state (`$.state`), host processes (`$.process.run`) and files (`$.fs`).

## Goal

Let Claude show designs and processes as diagrams (UML class/sequence/state/ER, flowcharts, gantt, C4-style) in a side pane while the conversation continues. Claude writes Mermaid; the mod renders it locally and keeps a flip-through history for the session.

**Success:** the user asks "show me the auth flow as a sequence diagram"; within a couple of seconds a rendered diagram appears in the pane; the user can flip back to earlier diagrams, export one to files, or copy its source — without leaving the conversation.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Diagram language | Mermaid |
| Renderer | Local `mmdc` (`@mermaid-js/mermaid-cli`), installed globally via npm. No remote rendering service. |
| History | Session-only, flip-through ◀ ▶, capped at 20 diagrams |
| Persistence | None automatic. Manual **Export** button only. |
| Syntax errors | Tool call renders synchronously and returns `mmdc`'s error to Claude, which fixes and redraws in the same turn. Failed renders never enter history. |
| Surfaces | Desktop Code tab (primary) and VS Code: rendered SVG. Terminal CLI: Mermaid source + **Open** button (user's terminals, iTerm2 and Terminal.app, lack the kitty graphics protocol). |

### Out of scope (v1)

- Inline PNG for kitty-protocol terminals (Ghostty, kitty) — easy follow-up.
- Persisting history across sessions.
- Diagram languages other than Mermaid (PlantUML, D2, Graphviz).
- Editing diagrams from the pane.

## User-facing behaviour

**Tool (for Claude):** `draw({ title, mermaid })`, listed to the model as `mcp__whiteboard__draw`. Description tells Claude to use it whenever a diagram would explain a design, structure or process better than prose, to keep titles short, and that errors come back for correction.

**Pane** ("Whiteboard"), toolbar then body:

```
◀  3/5  ▶   Checkout sequence          [Export] [Copy] [Open]
┌──────────────────────────────────────────────────────────┐
│  desktop / vscode: rendered SVG on a white card          │
│  terminal: Mermaid source in a code block                │
└──────────────────────────────────────────────────────────┘
```

- ◀ ▶ step through history (hotkeys `h`/`l`); disabled at the ends.
- **Export** writes `diagrams/<title-slug>.mmd` and `diagrams/<title-slug>.svg` under the session's working directory, adding `-2`, `-3`… on name collision; toasts the written path.
- **Copy** puts the Mermaid source on the clipboard of the surface pressed (`$.ui.copy`).
- **Open** (hotkey `o`) opens the rendered SVG in the default app via `open <path>`.
- Empty state (no diagrams yet): one line explaining that Claude draws here when asked for a diagram.

**Command:** `/whiteboard` opens (or focuses) the pane. A user-initiated open seats at any terminal width; the automatic open on first draw seats as a sidebar only where the surface docks panes (terminal fullscreen layout at ≥144 columns, desktop always).

## Architecture

Plugin folder `whiteboard/`:

```
whiteboard/
  .claude-plugin/plugin.json   name, version, description, "types", userConfig
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           engine wiring: tool, command, pane, buttons
  hooks/render.ts              Mermaid → SVG via mmdc
  hooks/history.ts             pure functions over the history list
  hooks/*.test.ts              claude plugin test suites
  types/index.d.ts             PluginState contract
```

### `history.ts` — pure, no `$`

```ts
type Entry = { id: string; title: string; source: string; svgPath: string; svgBytes: number; createdAt: number }
type History = { entries: Entry[]; index: number }   // index = -1 when empty

add(h, entry): History        // appends, jumps to it, drops oldest past 20
step(h, delta: -1 | 1): History  // clamps to [0, entries.length-1]
current(h): Entry | undefined
slug(title): string           // lowercase, [a-z0-9-], ≤ 60 chars, "diagram" if empty
```

### `render.ts` — the only module that touches `mmdc`

```ts
renderMermaid($, { source, dir, id, mmdcPath, signal }):
  Promise<{ ok: true; svgPath: string; svgBytes: number }
        | { ok: false; kind: 'syntax' | 'missing' | 'timeout' | 'failed'; message: string }>
```

1. `$.fs.write(<dir>/<id>.mmd, source)`.
2. `$.process.run([mmdcPath, '-i', mmd, '-o', svg, '-b', 'white', '-q'], { timeoutMs: 20000, env: { PATH } })` — argv, never a shell. `PATH` is prefixed with `mmdcPath`'s directory so its `#!/usr/bin/env node` shebang finds the node it was installed with.
3. Non-zero exit → `syntax` when stderr carries Mermaid's parse error (`Parse error`, `Syntax error`, `Lexical error`), else `failed`; message is stderr trimmed to ~2 KB.
4. Start failure (ENOENT) → `missing`; rejection on timeout → `timeout`.
5. Success → `$.fs.stat` the SVG for its size.

### Locating `mmdc`

The desktop app's process `PATH` may not include nvm's bin directory. At `session.start`:

1. If the `mmdcPath` userConfig option is set, use it.
2. Else run `["/bin/zsh", "-lc", "command -v mmdc"]` once (the user's login shell, which loads nvm) and cache the absolute path in `$.state`.
3. If neither yields a path, `draw` answers with the `missing` error and the install hint.

### State contract (`types/index.d.ts`)

```ts
interface PluginState {
  whiteboard: {
    history: History        // entries + index, as above
    mmdcPath: string | null // resolved at session.start
  }
}
```

SVG bytes stay on disk in `$TMPDIR/claude-whiteboard/<session-id>/`; state holds paths and metadata only. All history writes go through `update($, ref, fn)` so concurrent draws both land.

### `register.tsx` — wiring

- `session.start`: resolve `mmdcPath`; ensure the temp dir; `$.tool.register('draw', …)` (awaited, so it is listed from turn one); `$.command.register({ name: 'whiteboard', … })`.
- `tool.call` on `{ tool: 'mcp__whiteboard__draw' }`: validate input (non-empty `mermaid`, `title` ≤ 80 chars), mint an id, `renderMermaid` with `next.signal`. On `ok`: `update` history with `add`, `$.ui.open({ id: 'whiteboard', title: 'Whiteboard' })`, answer `{ result: "Drawn '<title>' (n/total)" }` (plus a note when the SVG is too large to show inline). On failure: answer `{ deny: <message> }` so Claude reads it as an error result.
- `command.run` for `whiteboard`: open the pane.
- `ui.render` on `{ component: 'Pane', requestId: 'whiteboard' }`: read history from state (subscribes the pane to redraws); resolve elements for `e.surface`; draw toolbar + body:
  - `desktop` / `vscode` / `mobile`: `$.fs.read(svgPath)` → `<Svg source alt={title} />` on a white box; when `svgBytes > 131072` or the file is missing, fall back to the terminal body plus a note.
  - `terminal`: `<Markdown text={"```mermaid\n" + source + "\n```"} />`.
- Button handlers (closures over `$`, writing via `update`): prev, next, Export (`$.fs.list`/`stat` to pick a free name, two `$.fs.write`s, `$.ui.toast`), Copy (`$.ui.copy({ text: source, surface: e.surface })`), Open (`$.process.run(['open', svgPath])`), Re-render (re-runs `renderMermaid` for the current entry when its SVG is missing).

## Error handling

| Case | Behaviour |
|---|---|
| Mermaid syntax error | Error result to Claude with `mmdc`'s message; history unchanged. |
| `mmdc` not found | Error result: "mmdc not found — install with `npm i -g @mermaid-js/mermaid-cli` or set the whiteboard `mmdcPath` option." |
| Render exceeds 20 s / user interrupts | Process stopped; error result (`timeout` / aborted). |
| SVG > 131,072 chars | Kept in history; pane shows source + **Open**; tool result says it is too large to show inline. |
| Concurrent draws | Distinct ids; `update` retries on version conflict. |
| Export name collision | Numeric suffix; toast shows the real path. |
| SVG file missing (tmp cleaned) | Pane shows source + "render missing" + **Re-render**. |
| Hook throws unexpectedly | Engine skips the hook and logs a dim line; `.catch` on the `tool.call` registration answers `{ deny }` with a generic message so Claude is never left with an unanswered tool. |

**Safety:** Mermaid text only ever reaches a file, never argv or a shell. Mermaid's default `securityLevel: strict` applies; the surfaces additionally strip scripts from `Svg`. Export writes only under the session's working directory; Open only opens files under the mod's own temp dir.

## Testing

1. **Unit — `history.ts`:** cap at 20 drops the oldest; `step` clamps at both ends; `add` jumps to the new entry; `slug` edge cases (empty, unicode, long titles).
2. **Engine — `claude plugin test`,** with a hook beneath the plugin on `process.run` faking `mmdc`:
   - valid draw → history has the entry, pane opened, result text `Drawn 'X' (1/1)`;
   - syntax error → `deny` carrying the stderr text, history unchanged;
   - missing binary → install hint; timeout → timeout error;
   - oversized SVG → entry kept, pane draws the fallback;
   - pane tests looped over `['terminal', 'desktop'] as const`: desktop draws `Svg`, terminal draws `Markdown`; ◀ ▶ move the index and title; Export writes both files and suffixes on collision; Copy calls `ui.copy` with the source.
3. **Integration:** one test runs the real `mmdc` on a small sequence diagram and checks the output starts with `<svg`; skipped when `mmdc` is not on the resolved path.
4. **Manual, in the real app:** with hot reloading on in the build session, draw a sequence diagram, a class diagram and a deliberately broken one; confirm render, history, Export, Copy, and the self-corrected redraw in the Code tab. Then one CLI session via `claude --plugin-dir` to confirm the source view and **Open**.

## Delivery

1. Install the renderer: `npm i -g @mermaid-js/mermaid-cli` (with the user's go-ahead).
2. Build in this session's dev-mods folder so edits hot-reload while iterating; `claude plugin validate` and `claude plugin test` stay green.
3. Move the finished plugin to `~/Projects/mods/whiteboard/` (this repo, the source of truth).
4. With the user's go-ahead, add that path to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, so both the CLI and the desktop app load it in every session.
