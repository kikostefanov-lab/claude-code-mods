# Claude Code mods

[![CI](https://github.com/kikostefanov-lab/claude-code-mods/actions/workflows/ci.yml/badge.svg)](https://github.com/kikostefanov-lab/claude-code-mods/actions/workflows/ci.yml)

Experiments with **Claude Code mods**: plugins of function hooks that add live panes, bands, status lines, toasts, tools and hooks inside Claude Code (terminal CLI and the desktop Code tab), and hot-reload while you build them.

> The mods API is **early access** and changes between releases. Everything here was built and tested against Claude Code **2.1.286**. Run `/whiteboard doctor` if something looks off.

| Mod | What it does |
|---|---|
| [`whiteboard/`](whiteboard) | Gives Claude a `draw` tool: Mermaid, D2 and PlantUML diagrams rendered locally and shown in a side pane, with history, versions, export, copy and share. |

---

## Whiteboard

Ask Claude for a diagram (*"show me the auth flow as a sequence diagram"*, *"draw the class structure of this module"*) or run `/whiteboard arch`, and it appears in a **Whiteboard** pane beside the conversation. Rendering is local: nothing leaves your machine unless you press **Share**.

```
◀  3/5  ▶   Checkout sequence   ‹ v2/3 ›
[Export] [Copy] [Copy MD] [Share] [Open]
┌──────────────────────────────────────────────────────────┐
│  desktop / VS Code / mobile: the rendered SVG            │
│  Ghostty / kitty: the rendered PNG                       │
│  other terminals: the source in a code block             │
└──────────────────────────────────────────────────────────┘
 Ask Claude to change this diagram…                  send
```

### Features

- **`draw` tool for Claude**: `{ title, source, language? }` with `language` one of `mermaid` (default), `d2`, `plantuml`. Rendering happens before the tool returns, so a syntax error goes straight back to Claude, which fixes it and redraws in the same turn.
- **Starter commands**: `/whiteboard arch` (architecture), `/whiteboard flow <file or area>` (control flow), `/whiteboard schema` (data model). Each asks Claude to draw.
- **History per project**: the last 20 diagrams, kept across sessions. ◀ ▶ buttons, or `h` / `l` while the pane has focus.
- **Versions**: redrawing a title keeps the earlier versions; `‹ v2/3 ›` steps between them.
- **Ask Claude to change this**: type a request under the diagram; Claude gets it with the current source and redraws.
- **Export** writes `diagrams/<title>.<mmd|d2|puml>` and `.svg` into the working directory, never overwriting.
- **Copy** (source), **Copy MD** (a fenced block that renders in GitHub, GitLab and Notion), **Open** (`o`, the SVG in your default app).
- **Share** creates a *secret* GitHub gist after asking you first, and copies the link. Needs the [GitHub CLI](https://cli.github.com).
- **Themes**: `default`, `neutral`, `dark`, `forest`, plus an optional Mermaid config file for team colours.
- **`/whiteboard doctor`** checks Claude Code's version, each renderer, a test render, the GitHub CLI and terminal images, and says what to fix.

### Where it works

| Surface | What you see |
|---|---|
| Desktop Code tab, VS Code | Rendered SVG and everything above |
| Mobile | Rendered SVG and buttons (no text field yet) |
| Terminal, Ghostty or kitty | Rendered PNG inline |
| Other terminals (iTerm2, Terminal.app, …) | Source + **Open** to view the SVG in your browser |

macOS, Linux and Windows are supported (`open` / `xdg-open` / `start`, `zsh` / `bash` / `where`). In the terminal a pane opens by itself only in the fullscreen layout at 144 or more columns; otherwise run `/whiteboard`.

### Install

1. **Renderers.** Mermaid is required, the others are optional:

   ```bash
   npm i -g @mermaid-js/mermaid-cli
   ```

   ```bash
   brew install d2 plantuml
   ```

   The mod finds them through your login shell, then nvm's and Homebrew's folders, so they work even when the desktop app's `PATH` doesn't include them. If it can't find `mmdc`, set the plugin option **`mmdcPath`**.

2. **The plugin.** Clone this repo, then either load it for every session (CLI and desktop) by adding it to the `env` block of `~/.claude/settings.json`:

   ```json
   {
     "env": {
       "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-code-mods/whiteboard"
     }
   }
   ```

   or try it for one session:

   ```bash
   claude --plugin-dir /path/to/claude-code-mods/whiteboard
   ```

   The repo is also a plugin marketplace (`.claude-plugin/marketplace.json`). Whether your Claude Code build loads function-hook mods from installed plugins depends on the build; the two options above always work.

3. **Check.** Run `/whiteboard doctor`.

### Options

| Option | Default | What it does |
|---|---|---|
| `mmdcPath` | empty | Absolute path to `mmdc` when it can't be found automatically |
| `theme` | `default` | `default`, `neutral`, `dark` or `forest` |
| `mermaidConfig` | empty | Absolute path to a Mermaid JSON config, for example team colours and fonts |

Set them in Claude Code's config menu, or under `pluginConfigs.whiteboard` in your settings.

### How it works

```mermaid
sequenceDiagram
  participant C as Claude
  participant W as whiteboard
  participant R as renderer (mmdc / d2 / plantuml)
  participant P as Pane
  C->>W: draw {title, source, language}
  W->>R: <id>.<ext> → <id>.svg (spawned; interrupt stops it)
  alt syntax error
    R-->>W: exit 1 + parse error
    W-->>C: error → Claude fixes and redraws
  else rendered
    W->>W: add to history, save for the project
    W->>P: open pane
    W-->>C: Drawn 'title' (n/total)
  end
```

- Rendered files live in `~/.claude/whiteboard/<project>/`; history is saved per project. Diagrams pushed out of the last 20 have their files removed.
- Diagram text only ever goes into a file, never onto a command line; renderers run by argv, without a shell.
- Renders time out after 20 s, and stop when you interrupt Claude.
- `--no-font-embed` keeps Mermaid SVGs small: mermaid-cli 12 otherwise inlines ~160 KB of web fonts, past the 128 KB the pane draws inline. Text falls back to Arial.

### Layout

```
.claude-plugin/marketplace.json  the repo as a plugin marketplace
.github/workflows/ci.yml         validate, test and smoke test on every push
whiteboard/
  .claude-plugin/plugin.json     manifest and options
  hooks/register.tsx             engine wiring: tool, command, pane, buttons
  hooks/history.ts               pure history logic
  hooks/render.ts                pure rendering, platform and version helpers
  hooks/actions.ts               pure pane, command and doctor helpers
  hooks/*.test.ts(x)             claude plugin test suites
  hooks/testkit.ts               fake host for the tests
  types/index.d.ts               session-state contract
  scripts/smoke-mmdc.sh          renders with the real mmdc
```

### Development

```bash
claude plugin validate whiteboard   # what the engine will load, call and refuse
claude plugin test whiteboard       # 85 tests across terminal, desktop and mobile
whiteboard/scripts/smoke-mmdc.sh    # real mmdc: SVG size limit, PNG, syntax errors
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

### Known limitations

- Mermaid's state-diagram grammar is lenient: some typos render as odd states instead of failing.
- Sources longer than about 9,800 characters show truncated in the source view; Copy and Export still give the full text.
- Windows support is written and unit-tested but has not been run on a Windows machine yet.

---

## Notes on the mods API (learned the hard way)

Useful if you're writing your own mod. These are things the type declarations don't spell out up front:

- **`$` can only be passed to functions declared at the top level of the same file.** Helpers in other files must be pure; the engine refuses to load the module otherwise.
- **Never name a variable `h`.** JSX compiles to bare `h(...)` calls, and a local `h` shadows the factory.
- **`Text`, `Svg` and `Markdown` drop a `key` prop.** Tests find them by type and text; `Button`s and `Input`s keep their keys.
- **The terminal's element table includes an `Svg` that draws nothing.** Pick the body by `e.surface`, not by `'Svg' in elements`.
- **Relative `$.fs` paths resolve against the engine's cwd**, not necessarily the session's: build paths from `$.session.cwd()`.
- **A slash command can't call `$.prompt.submit` directly**: the command holds the turn the prompt would wait for. Submit from a timer (`$.clock.after(0, …)`) or a later event.
- **`$.process.spawn` kills its child when the dispatch is abandoned**, so a render started from a tool call stops when the user interrupts. `$.process.run` has a timeout but no abort.
- **In `claude plugin test`:**
  - The test's `$` carries only engine events (`tool.call`, `ui.mount`, `session.start`, `command.run`…), not plugin calls (`fs`, `env`, `process`), so test through the plugin's own tools, commands and panes.
  - `tool.register` / `command.register` have no implementation there and must be stubbed.
  - Stubs answer `{ value }` or `{ deny }`; one that throws is skipped, not rejected.
  - A `process.spawn` stub is an async generator that yields chunks and returns `{ value: { code, signal } }`.
  - `mock.clock` holds timers until the test calls `advance`.

## Design docs

The spec and the implementation plan for 0.1 are in [`docs/superpowers/`](docs/superpowers).

## License

[MIT](LICENSE)
