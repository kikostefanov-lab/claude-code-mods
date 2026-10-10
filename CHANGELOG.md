# Changelog

All notable changes to the mods in this repo. Versions follow the plugin manifest.

## kiko 0.2.0 — 2026-10-10

### Changed
- New look: Kiko is a boxer with block-character gloves (`▄█(o.o)█▄`) working a punching bag, in place of the cat and the bug. The bag flashes and swings on a hit.
- Code split by job: the round's rules (`round.ts`), the career record (`record.ts`), what Kiko says (`words.ts`), the art (`sprites.ts`) and the band's rows (`layout.ts`) are pure modules; `register.tsx` keeps everything that takes `$`. Type-checks clean under `strict`.

## kiko 0.1.0 — 2026-10-04

- First release: Kiko boxes every turn in a band above the prompt. Knowledge In (reads, searches, fetches) are chomps, Knowledge Out (edits, writes) are punches, and the turn ends in a K.O. card and a transcript line.
- Opponents named from your prompt; a career record across sessions (`/kiko stats`); `/kiko on|off`.
- Fight-themed spinner words while Claude thinks or replies.
- The band animates from the hooks module on a 200 ms tick: text rows on the terminal, one fixed-width code block on the desktop (the engine raises the band on those two surfaces only).

## whiteboard 0.2.0 — 2026-10-04

### Added
- `/whiteboard doctor`: checks Claude Code's version, each renderer, a test render, the GitHub CLI and terminal images.
- Starter commands: `/whiteboard arch`, `/whiteboard flow <file or area>`, `/whiteboard schema`.
- **Copy MD**: copies a fenced block that renders in GitHub, GitLab and Notion.
- **Share**: a secret GitHub gist, after a confirmation, with the link copied.
- **Ask Claude to change this**: a text field under the diagram that sends Claude the request and the current source.
- History saved per project across sessions (`~/.claude/whiteboard/<project>/`).
- Versions: redraws of a title are grouped, with `‹ v2/3 ›` to step between them.
- D2 and PlantUML (`language` on the `draw` tool), when `d2` / `plantuml` are installed.
- Inline PNG in kitty-protocol terminals (Ghostty, kitty).
- Options `theme` (`default`, `neutral`, `dark`, `forest`) and `mermaidConfig`.
- Linux and Windows: `xdg-open` / `start`, `bash` / `where`, npm and Homebrew fallbacks.
- A toast at session start when Claude Code is older than 2.1.286.
- The repo is a plugin marketplace; CI validates, tests and smoke-tests on every push.

### Changed
- The `draw` tool takes `source` (and still accepts 0.1's `mermaid`).
- Renders run as spawned processes: interrupting Claude stops them; 20 s timeout as before.
- Rendered files move from a per-session temp folder to a per-project folder; files of diagrams pushed out of history are removed, and so are a failed render's files.
- A cached renderer path that no longer exists is looked up again.

## whiteboard 0.1.0 — 2026-10-04

- First release: Mermaid diagrams rendered locally with `mmdc`, a side pane with history, Export, Copy, Open and Re-render, `/whiteboard`.
