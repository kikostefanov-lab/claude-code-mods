# Contributing

Thanks for helping. A few things make changes here go smoothly.

## Set up

- Claude Code 2.1.286 or newer (the mods API is early access).
- Node.js 22 and `npm i -g @mermaid-js/mermaid-cli`.

## Develop a mod with hot reload

In a Claude Code session, ask Claude to load the `plugin-authoring` skill, then copy the plugin folder into the mods folder it names and accept **Enable hot reloading for this session**. Each edit reloads when the turn ends. Or run `claude --plugin-dir ./whiteboard` in an interactive session, which watches the folder.

## Before you push

```bash
claude plugin validate whiteboard
claude plugin test whiteboard
whiteboard/scripts/smoke-mmdc.sh
```

CI runs the same three on every push and pull request.

## Conventions

- **Test first.** Write the failing test, watch it fail, then make it pass. UI tests loop over surfaces (`terminal`, `desktop`, and `mobile` where it matters).
- **`$` stays in `hooks/register.tsx`.** The engine only lets `$` into top-level functions of the same file. `history.ts`, `render.ts` and `actions.ts` are pure, and are tested directly.
- **Tests run through the plugin's own tools, commands and panes.** `hooks/testkit.ts` fakes the host underneath (files, processes, clipboard, store, platform).
- **Diagram text never reaches a shell.** Renderers run by argv; source goes into a file.
- Update `CHANGELOG.md` and the version in both `whiteboard/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
