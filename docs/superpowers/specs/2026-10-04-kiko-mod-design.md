# Kiko mod: design

**Date:** 2026-10-04
**Status:** Draft, awaiting review
**Context:** The second mod in `claude-code-mods`, and a fun one. It exercises the parts of the mods API the whiteboard didn't: the `AbovePrompt` band, a `Client` surface module with its own frame clock, the `Spinner` site, `turn.start` / `turn.step` / `turn.complete`, observing `tool.call`, `$.session.usage`, `$.session.append` notices and `$.store`.

## Goal

While Claude works, a small TUI critter called **Kiko** fights the user's problem in a band above the prompt. Every turn is a boxing round. **K-I-K-O** stands for **Knowledge In, Knowledge Out**: what Claude reads is knowledge in, what it writes is knowledge out, and "K.O." is the knockout at the end of the turn.

**Success:** you send a prompt and the band opens with "ROUND n, KIKO vs. THE FLAKY TEST". Kiko chomps file names as Claude reads them, punches when Claude edits, has swirly eyes while Claude thinks, and talks while Claude replies. When the turn ends, a "K.O.!" card shows for a few seconds, a one-line fight record stays in the transcript, and Kiko's career record grows.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Concept | Kiko the critter is the fighter; each turn is a round; K.O. finish |
| Look | Text-frame TUI art, the same Kiko on the terminal and the desktop Code tab |
| Animation driver | A `Client` surface module animates locally on its own frame clock; the hooks module only sends events |
| Visibility | The band shows only while a turn runs, plus the K.O. card for about 5 s. A K.O. notice line stays in the transcript |
| Toggle | `/kiko on`, `/kiko off`, saved across sessions |
| Extras | Career record (saved across sessions); opponents named from the prompt |
| Not chosen | Losses and draws; sound effects |

### Out of scope (v1)

- Losses and draws: an interrupted or failed turn ends quietly, with no record change.
- Sound.
- Animation in VS Code and mobile, which have no `Client`. They get the spinner words and the K.O. line only.
- Rounds for subagent turns.
- Model calls of any kind (opponent names are worked out locally).

## User-facing behaviour

### The band (5 rows, single-width characters only; no emoji)

```
 ROUND 3 ── KIKO vs. THE FLAKY TEST ────────────────── 0:42
 KI ████████░░░░ 12.4k                     KO ███░░░░░░░ 2.1k
    [app.ts]›››    /\_/\                     ,_,
                  ( o.o )ノ    ‹ jab!       (x_x)
 ▸ reading src/app.ts
```

- **Header:** round number, the opponent's name and the elapsed time (m:ss).
- **Bars:** **KI** is input tokens and **KO** is output tokens, both on a log scale. KO also drains the opponent.
- **Arena:** Kiko is a 3-line cat-ish critter with ears for the K. The opponent is a 2-line bug-blob that wobbles when hit.
- **Status line:** what's happening now (`reading src/app.ts`, `editing hooks/x.ts`, `thinking`, `replying`, `running Bash`).
- **Narrow bands:** under 60 columns the arena drops the opponent and the bars shorten. Under 30 columns only the header and status line remain.

### Kiko's moves (2–4 frames each, about 6 fps)

| Claude is | Mode / beat | Kiko does |
|---|---|---|
| waiting on the API | `requesting` | bobs in a guard stance, shifting a column left and right |
| thinking | `thinking` | eyes cycle `o.o → @.@ → -.-`, with `? ?` bubbles |
| reading or searching | `chomp` beat | the file name slides in from the left (`[app.ts]›››`); Kiko opens wide `( O.O )` and chomps |
| editing or writing | `punch` beat | an arm extends, `{fix.ts}` flies right, the opponent shows `(x_x)` |
| replying | `responding` | talking mouth `( o▽o )`, letters drift right |
| running another tool | `dodge` beat | sidestep, with the tool's name on the status line |
| the turn starts | `bell` beat | "ROUND n ── FIGHT!" flashes for about 1 s |

A beat plays once (about 1 s) and then the current mode's loop resumes.

### The K.O. card (about 5 s after a turn Claude finished)

```
 ╦╔═ ╔═╗      K.O.!  Kiko beats THE FLAKY TEST in 0:42
 ╠╩╗ ║ ║      read 3 · wrote 2 · 12.4k in / 2.1k out
 ╩ ╩o╚═╝o     record 48-0 · streak 12
```

### The transcript line

One `system` notice per K.O. Claude never reads it, so it costs no context:

`K.O. ▸ Kiko beats THE FLAKY TEST in 0:42 · read 3 · wrote 2 · 12.4k in / 2.1k out · 48-0`

### Spinner words

The spinner word is replaced with a Kiko word chosen by mode, rotating through a small list per mode, for example:

- **thinking:** "Kikonsidering", "Sizing up the opponent"
- **reading:** "Chomping knowledge"
- **writing:** "Winding up the KO"
- **replying:** "Trash-talking"
- **otherwise:** "Kiko-ing"

A `message` the engine is showing (a state override) is left alone.

### Commands

- `/kiko`: status (on or off, record, current streak).
- `/kiko on`, `/kiko off`: toggle, saved across sessions.
- `/kiko stats`: the career record. Wins, current and best streak, fastest K.O., biggest K.O. (most tokens) and the last 5 opponents.

## Architecture

```
kiko/
  .claude-plugin/plugin.json   name, version, description, types
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           hooks module: observers, band, spinner, /kiko, record
  hooks/kiko.tsx               Client surface module: frame clock, sprites, beats, K.O. card
  hooks/sprites.ts             pure: frames, bars, block letters, fit-to-width layout
  hooks/round.ts               pure: opponent names, tool classification, beats, record, K.O. line, spinner words
  hooks/testkit.ts             test-only fake host
  hooks/*.test.ts(x)
  types/index.d.ts             PluginState contract
```

As learned on the whiteboard, `$` stays in `register.tsx`, in top-level functions of that file only. `round.ts` and `sprites.ts` are pure and tested directly. `kiko.tsx` has no `$`: it gets plain-data props and draws with `surface.elements`.

### State contract

```ts
type Phase = 'idle' | 'fight' | 'ko'
type Mode = 'requesting' | 'thinking' | 'responding' | 'tool'
type Beat = { id: number; kind: 'bell' | 'chomp' | 'punch' | 'dodge'; label: string }
type Round = {
  phase: Phase
  n: number              // round number this session
  opponent: string
  startedAt: number      // ms
  endedAt: number | null
  mode: Mode
  status: string         // status line text
  tokensIn: number
  tokensOut: number
  reads: number
  writes: number
  beat: Beat | null
  record: string         // "48-0 · streak 12", for the K.O. card
}
interface PluginState { kiko: { round: Round; enabled: boolean } }
```

Saved across sessions in `$.store`:
- `kiko:enabled` (boolean)
- `kiko:record`: `{ wins, rounds, streak, bestStreak, fastestMs, biggestTokens, recent: string[] }`

### Event flow (main loop only; any event with `agentId` is ignored)

| Event | Handling |
|---|---|
| `session.start` | Register the `/kiko` command; load `enabled` and the record; reset `round` to idle |
| `turn.start` | `n += 1`, `opponent = opponentName(e.text)`, phase `fight`, mode `requesting`, counters zeroed, beat `bell`. Then `next(e)` |
| `turn.step` | An async generator: `for await` over `next(e)`, yield every chunk unchanged; on a `thinking` chunk set mode `thinking`, on a `text` chunk set `responding`, writing only when the mode changes. Return the stream's result |
| `tool.call` | Classify `e.tool` and pick the path or pattern for the label; write the beat, counters, status and mode `tool`; `await next(e)`; then refresh tokens from `$.session.usage()` and set mode back to `requesting`; return the result unchanged |
| `turn.complete` | `next(e)` first. If the reason is `answer` and the turn wasn't aborted: final tokens from `e.usage`, update the record, phase `ko`, append the K.O. notice, then a 5 s `$.clock.after` back to `idle`. Otherwise: `idle` |
| `ui.render` `AbovePrompt` | If `enabled` and phase is `fight` or `ko`, draw `<Client key="kiko" module="./kiko.tsx" props={round} />`; otherwise `next(e)`. VS Code and mobile draw a one-line text status instead |
| `ui.render` `Spinner` | If enabled and fighting, `next({ ...e, props: { ...e.props, word: spinnerWord(mode, n) } })` unless `e.props.message` is set; otherwise `next(e)` |
| `command.run` `kiko` | `on`, `off`, `stats`, or status |

Every observer hook registers a `.catch` that passes through: on `turn.step` and `tool.call` it answers with `next(e)`, and on the renders it draws the engine's own. A Kiko failure never blocks a tool, a turn or the spinner.

### The Client module (`kiko.tsx`)

- **Clock:** on the first call it starts `surface.every(160, tick)` and keeps `{ frame, beatId, beatStartedFrame }` in local state.
- **Beats:** a new `props.beat.id` restarts the beat animation; after about 6 frames it falls back to the mode loop.
- **Layout:** it builds the rows with `layout(props, frame, surface.columns)` from `sprites.ts` and draws each as one `Text`, in a fixed-width font (see Risks).
- **K.O. card:** during phase `ko` it draws the card.

### Pure helpers

- `opponentName(text)`: lower-case, drop stop words and code punctuation, take the first 2–3 remaining words, upper-case, prefix "THE ", cap at 28 characters; fall back to "THE UNKNOWN BUG".
- `classifyTool(tool, input)`:
  - `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` and `mcp__*read*` / `*search*` / `*get*` are **in**.
  - `Edit`, `Write`, `NotebookEdit` and `mcp__*write*` / `*create*` / `*update*` are **out**.
  - Everything else is a **dodge**.
  - The label is the path's last segment, the pattern, or the host, cut to 20 characters.
- `updateRecord(record, round)`, `koLine(round, record)`, `spinnerWord(mode, n)`.
- `layout(round, frame, columns)` returns rows; `bar(value, width)` is log-scaled.

## Error handling

| Case | Behaviour |
|---|---|
| A Kiko hook throws | Its `.catch` passes through; the turn, tool or spinner behaves as without Kiko |
| `$.session.usage()` fails | Keep the last token counts |
| `$.session.append` refused | Skip the transcript line; the card still shows |
| Turn aborted or errored | Phase `idle` immediately; no record change |
| A new turn starts during the K.O. card | Cancel the timer and start the new round |
| The surface has no `Client` (VS Code, mobile) | One-line text band: `ROUND 3 · KIKO vs. … · KI 12.4k · KO 2.1k` |
| The band is too narrow | Graceful layouts at 60 and 30 columns; never wider than `bodyColumns` |
| Hot reload mid-turn | `round` lives in `$.state` and survives; the Client keeps animating from props |

## Testing

1. **Pure:**
   - `opponentName`: stop words, punctuation, empty prompt, long prompt, non-ASCII.
   - `classifyTool`, for each built-in and MCP pattern.
   - `updateRecord`: first win, streak, fastest, biggest, `recent` cap.
   - `koLine`, `spinnerWord`.
   - Sprites: every frame of every move is the same width and height, and contains only single-width printable characters (no emoji or combining marks).
   - `layout` output is never wider than `columns` at 30, 60, 80 and 160.
2. **Hooks module through `claude plugin test`:**
   - A full round (start → a chomp beat from a `Read` → a punch beat from an `Edit` → complete): phase, counts, record in the store, and one appended `system` notice.
   - Aborted and error turns: idle, record unchanged.
   - Subagent events (with `agentId`) are ignored.
   - `turn.step` yields every chunk unchanged, in order, and sets the mode.
   - `/kiko off`: band `next(e)`, spinner untouched, no notice; `/kiko on` restores; `/kiko stats` text.
   - The spinner word is replaced only while fighting and not when `message` is set.
3. **Client module:** mount the band on `terminal` and `desktop` and drive the frame clock with the kit's `advance`. Check that the frames change, a new beat id plays its move then returns to the mode loop, the K.O. card appears in phase `ko`, and the tree fits at 40, 80 and 160 columns.
4. **Live:** hot reload into a session and run a thinking-only turn, a turn with reads and edits, and an interrupted turn; then `/kiko off`, `/kiko on`, `/kiko stats`.

## Risks to probe before building

1. **`Client` on desktop:** does a `Client` module load and tick in the desktop Code tab's band, and does its `surface.every` keep running while the turn streams? If not, fall back to a hooks-side ticker (approach B), limited to about 6 fps.
2. **Fixed-width text on desktop:** is `Text` monospace in the desktop band? If not, draw the arena rows with `Code` (always monospace) and keep `Text` for the header.
3. **Hiding the band:** does answering `next(e)` hide the band between turns on both surfaces?
4. **Stream cost:** observing `turn.step` adds no visible delay; compare a turn's time-to-first-text with Kiko on and off.

## Delivery

Build in `~/Projects/mods/kiko/` on a branch, then rsync it into this session's hot-reload folder to try it. When it's done: add it to `.claude-plugin/marketplace.json`, the README and CI, then merge and push. To load it in every session, the user's `CLAUDE_CODE_PLUGIN_DIRS` gains `:/Users/kikostefanov/Projects/mods/kiko`, with their OK.
