import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Entry, History } from '../types'
import {
  COMMAND_HINT, cleanTitle, fenceBlock, formatDoctor, freeName, gistMarkdown, helpText, languageOf, parseCommand,
  revisePrompt, sourceView, versionInfo,
} from './actions'
import type { Check } from './actions'
import { EMPTY, add, current, dropped, isHistory, jumpTo, replace, slug, step } from './history'
import {
  MAX_INLINE_SVG, MIN_ENGINE, RENDERERS, RENDER_TIMEOUT_MS, binEnv, boardDirFrom, byNewestVersion, failureOf,
  fallbackDirs, imageRows, isKittyTerminal, isLanguage, isOlder, locatedPath, lookupArgv, missingHint, openArgv,
  platformOf, pngSize, projectKey, rejectionOf, removeArgv, renderArgv, stoppedFailure, stripFences, themeOf,
} from './render'
import type { Format, Language, Platform, RenderResult, Theme } from './render'

export const PANE = 'whiteboard'
export const TOOL = 'mcp__whiteboard__draw'

const history = atom({ plugin: 'whiteboard', key: 'history' } as const, EMPTY)
const bins = atom({ plugin: 'whiteboard', key: 'bins' } as const, {})
const shareConfirm = atom({ plugin: 'whiteboard', key: 'shareConfirm' } as const, null)

const DESCRIPTION = [
  "Draw a diagram on the user's whiteboard pane, beside the conversation.",
  'Use it whenever a diagram explains a design, structure or process better than prose:',
  'UML class, sequence, state and ER diagrams, flowcharts, gantt charts, C4-style architecture.',
  'Pass the raw source (no ``` fences), a short title (at most 80 characters) and, for D2 or PlantUML, the language;',
  'Mermaid is the default and always available. The diagram is rendered before this tool returns:',
  'a syntax error comes back as an error, so fix the source and call again.',
  'Redrawing with the same title keeps the earlier versions in the pane history.',
].join(' ')

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80, description: 'Short title shown above the diagram; reuse it to make a new version.' },
    source: {
      type: 'string',
      description: 'Diagram source. Mermaid starts with the diagram type (sequenceDiagram, classDiagram, flowchart TD, ...).',
    },
    language: { type: 'string', enum: ['mermaid', 'd2', 'plantuml'], description: 'Diagram language; default mermaid.' },
  },
  required: ['title', 'source'],
  additionalProperties: false,
}

const EXPORT_DIR = 'diagrams'
const EMPTY_HINT =
  'Claude draws here when a diagram would help: ask for a sequence, class, state or ER diagram, a flowchart or an architecture sketch. Try /whiteboard arch.'

type Settings = { mmdcPath: string; theme: Theme; mermaidConfig: string }

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function newId($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), b => b.toString(16).padStart(2, '0')).join('')
  return `${now.toString(36)}-${rand}`
}

async function platform($: EngineInterface): Promise<Platform> {
  return platformOf({ os: await $.env.get('OS'), isMac: await $.fs.exists('/System/Library/CoreServices') })
}

async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '/tmp'
}

async function storeKey($: EngineInterface): Promise<string> {
  return `history:${projectKey(await $.session.root())}`
}

async function boardDir($: EngineInterface): Promise<string> {
  return boardDirFrom(await homeDir($), projectKey(await $.session.root()))
}

async function removeFiles($: EngineInterface, os: Platform, paths: readonly string[]): Promise<void> {
  if (paths.length > 0) await $.process.run(removeArgv(os, paths), { timeoutMs: 5_000 }).catch(() => undefined)
}

// Every change to the history goes here: it saves the board for the project and
// removes the files of the diagrams the cap pushed out.
async function changeBoard($: EngineInterface, fn: (h: History) => History): Promise<History> {
  const before = (await read($, history)) ?? EMPTY
  await update($, history, list => fn(list ?? EMPTY))
  const after = (await read($, history)) ?? EMPTY
  await $.store.set(await storeKey($), after)
  const gone = dropped(before, after).flatMap(e => [e.svgPath, ...(e.pngPath ? [e.pngPath] : [])])
  await removeFiles($, await platform($), gone)
  return after
}

async function locateBin($: EngineInterface, os: Platform, bin: string, configured: string): Promise<string | null> {
  if (configured) return (await $.fs.exists(configured)) ? configured : null
  const cache = (await read($, bins)) ?? {}
  const cached = cache[bin]
  if (cached && (await $.fs.exists(cached))) return cached
  const run = await $.process.run(lookupArgv(os, bin), { timeoutMs: 10_000 }).catch(() => undefined)
  let found = run ? locatedPath(run) : null
  if (found && !(await $.fs.exists(found))) found = null
  if (!found) found = await fallbackBin($, os, bin)
  await update($, bins, all => {
    const next = { ...(all ?? {}) }
    if (found) next[bin] = found
    else delete next[bin]
    return next
  })
  return found
}

// Where the login shell cannot see a binary: nvm's installs (nvm's installer loads
// it from .zshrc, which a login shell does not read), Homebrew and npm's own folders.
async function fallbackBin($: EngineInterface, os: Platform, bin: string): Promise<string | null> {
  const home = await $.env.get('HOME')
  const names = os === 'win32' ? [`${bin}.cmd`, `${bin}.exe`] : [bin]
  if (home && os !== 'win32') {
    const root = `${home}/.nvm/versions/node`
    if (await $.fs.exists(root)) {
      const versions = (await $.fs.list(root).catch(() => [])).map(entry => entry.name).sort(byNewestVersion)
      for (const version of versions) {
        const candidate = `${root}/${version}/bin/${bin}`
        if (await $.fs.exists(candidate)) return candidate
      }
    }
  }
  for (const dir of fallbackDirs(os, home, await $.env.get('APPDATA'))) {
    for (const name of names) {
      const candidate = `${dir}/${name}`
      if (await $.fs.exists(candidate)) return candidate
    }
  }
  return null
}

// Runs a renderer as a spawned child: interrupting the turn abandons this dispatch,
// which kills the child; the timer bounds a child that hangs.
async function runRenderer($: EngineInterface, argv: string[], env: Record<string, string>) {
  const stream = $.process.spawn({ argv, env })
  let stdout = ''
  let stderr = ''
  let isStopped = false
  const timer = $.clock.after(RENDER_TIMEOUT_MS, () => {
    isStopped = true
    void stream.return(undefined as never)
  })
  try {
    for (;;) {
      const step = await stream.next()
      if (step.done) {
        const end = step.value as { code: number | null; signal: string | null } | undefined
        return { code: end?.code ?? null, stdout, stderr, isStopped: isStopped || end?.code == null }
      }
      if (step.value.stream === 'stdout') stdout += step.value.text
      else stderr += step.value.text
    }
  } finally {
    timer.cancel()
  }
}

async function renderDiagram(
  $: EngineInterface,
  req: { language: Language; source: string; dir: string; id: string; format: Format; bin: string | null; settings: Settings },
): Promise<RenderResult> {
  if (!req.bin) return { ok: false, kind: 'missing', message: missingHint(req.language) }
  const os = await platform($)
  const input = `${req.dir}/${req.id}.${RENDERERS[req.language].ext}`
  const output = `${req.dir}/${req.id}.${req.format}`
  await $.fs.write(input, req.source)
  const argv = renderArgv(req.language, {
    bin: req.bin, input, output, dir: req.dir, format: req.format, theme: req.settings.theme, mermaidConfig: req.settings.mermaidConfig,
  })
  const env = binEnv(req.bin, await $.env.get('PATH'), await $.env.get('HOME'), os)

  let result: RenderResult
  try {
    const ran = await runRenderer($, argv, env)
    if (ran.isStopped) result = stoppedFailure()
    else if (ran.code !== 0) result = failureOf({ exitCode: ran.code, stderr: ran.stderr, stdout: ran.stdout })
    else {
      const stat = await $.fs.stat(output).catch(() => undefined)
      result = stat && stat.kind === 'file'
        ? { ok: true, path: output, bytes: stat.size }
        : { ok: false, kind: 'failed', message: `The renderer reported success but wrote no ${req.format.toUpperCase()}.` }
    }
  } catch (err) {
    result = rejectionOf(err)
  }
  await removeFiles($, os, result.ok ? [input] : [input, output])
  return result
}

async function binFor($: EngineInterface, language: Language, settings: Settings): Promise<string | null> {
  return locateBin($, await platform($), RENDERERS[language].bin, language === 'mermaid' ? settings.mmdcPath : '')
}

async function isKitty($: EngineInterface): Promise<boolean> {
  return isKittyTerminal({
    termProgram: await $.env.get('TERM_PROGRAM'), term: await $.env.get('TERM'), kittyWindow: await $.env.get('KITTY_WINDOW_ID'),
  })
}

async function wantsPng($: EngineInterface): Promise<boolean> {
  return (await $.session.surface()) === 'terminal' && (await isKitty($))
}

async function addPng($: EngineInterface, entry: Entry, bin: string | null, settings: Settings): Promise<Entry> {
  const language = languageOf(entry)
  const png = await renderDiagram($, { language, source: entry.source, dir: await boardDir($), id: entry.id, format: 'png', bin, settings })
  if (!png.ok) return entry
  const head = await $.fs.read(png.path, { as: 'bytes' }).catch(() => undefined)
  const size = head ? pngSize(head.base64) : null
  return size ? { ...entry, pngPath: png.path, pngWidth: size.width, pngHeight: size.height } : entry
}

async function exportEntry($: EngineInterface, entry: Entry): Promise<string> {
  const ext = RENDERERS[languageOf(entry)].ext
  const dir = `${await $.session.cwd()}/${EXPORT_DIR}`
  const taken = new Set((await $.fs.exists(dir)) ? (await $.fs.list(dir)).map(f => f.name) : [])
  const base = freeName(taken, slug(entry.title), [ext, 'svg'])
  const shown = `${EXPORT_DIR}/${base}`
  const svg = await $.fs.read(entry.svgPath).catch(() => undefined)
  await $.fs.write(`${dir}/${base}.${ext}`, `${entry.source}\n`)
  if (svg === undefined) return `Exported ${shown}.${ext} (SVG missing: press Re-render, then export again).`
  await $.fs.write(`${dir}/${base}.svg`, svg)
  return `Exported ${shown}.${ext} and ${shown}.svg`
}

async function copyText($: EngineInterface, text: string, surface: RenderSurface, done: string): Promise<string> {
  const r = await $.ui.copy({ text, surface })
  return r.isCopied ? done : `Could not copy: ${r.reason}`
}

async function openEntry($: EngineInterface, entry: Entry): Promise<string | undefined> {
  if (!(await $.fs.exists(entry.svgPath))) return 'Render missing: press Re-render first.'
  const r = await $.process.run(openArgv(await platform($), entry.svgPath), { timeoutMs: 5_000 }).catch(() => undefined)
  return r && r.exitCode === 0 ? undefined : 'Could not open the SVG.'
}

async function shareEntry($: EngineInterface, entry: Entry, surface: RenderSurface): Promise<string> {
  const os = await platform($)
  const gh = await locateBin($, os, 'gh', '')
  if (!gh) return 'Share needs the GitHub CLI: install gh and run `gh auth login`.'
  const file = `${await boardDir($)}/${slug(entry.title)}.md`
  await $.fs.write(file, gistMarkdown(entry))
  const run = await $.process.run([gh, 'gist', 'create', file, '--desc', entry.title], {
    timeoutMs: 30_000, env: binEnv(gh, await $.env.get('PATH'), await $.env.get('HOME'), os),
  }).catch((err: unknown) => ({ exitCode: 1, stdout: '', stderr: errorText(err) }))
  await removeFiles($, os, [file])
  const url = run.stdout.split('\n').map(l => l.trim()).find(l => l.startsWith('https://gist.github.com/'))
  if (run.exitCode !== 0 || !url) return `Share failed: ${run.stderr.trim().split('\n')[0] || 'gh gist create did not return a link'}`
  return copyText($, url, surface, `Secret gist created, link copied: ${url}`)
}

async function rerender($: EngineInterface, entry: Entry, settings: Settings): Promise<void> {
  const language = languageOf(entry)
  const bin = await binFor($, language, settings)
  const out = await renderDiagram($, { language, source: entry.source, dir: await boardDir($), id: entry.id, format: 'svg', bin, settings })
  if (!out.ok) {
    $.ui.toast(`Re-render failed: ${out.message.split('\n')[0]}`)
    return
  }
  let next: Entry = { ...entry, svgPath: out.path, svgBytes: out.bytes }
  if (entry.pngPath) next = await addPng($, next, bin, settings)
  await changeBoard($, h => replace(h, next))
}

async function askToRevise($: EngineInterface, entry: Entry, request: string): Promise<void> {
  if (!request.trim()) return
  void $.prompt.submit({ text: revisePrompt(entry, request) })
  $.ui.toast(`Sent to Claude: "${request.trim().slice(0, 60)}"`)
}

async function loadSaved($: EngineInterface): Promise<void> {
  const saved = await $.store.get(await storeKey($)).catch(() => undefined)
  if (isHistory(saved)) await update($, history, () => saved)
}

async function doctor($: EngineInterface, settings: Settings): Promise<string> {
  const checks: Check[] = []
  const version = await $.session.version()
  const engine = version.base ?? version.version
  checks.push({
    label: 'Claude Code',
    ok: !isOlder(engine, MIN_ENGINE),
    detail: isOlder(engine, MIN_ENGINE) ? `${engine}; the whiteboard was built for ${MIN_ENGINE}+, update Claude Code` : engine,
  })
  const os = await platform($)
  checks.push({ label: 'Platform', ok: null, detail: os })
  let mmdc: string | null = null
  for (const language of ['mermaid', 'd2', 'plantuml'] as const) {
    const r = RENDERERS[language]
    const bin = await binFor($, language, settings)
    if (language === 'mermaid') mmdc = bin
    const optional = language !== 'mermaid'
    checks.push({
      label: `${r.label} (${r.bin})`,
      ok: bin ? true : optional ? null : false,
      detail: bin ?? `not found${optional ? ' (optional)' : ''}: ${r.install}`,
    })
  }
  if (mmdc) {
    const started = await $.clock.now()
    const out = await renderDiagram($, {
      language: 'mermaid', source: 'flowchart LR\n  A --> B', dir: await boardDir($), id: 'doctor', format: 'svg', bin: mmdc, settings,
    })
    if (out.ok) await removeFiles($, os, [out.path])
    checks.push({
      label: 'Test render',
      ok: out.ok,
      detail: out.ok ? `${(await $.clock.now()) - started} ms` : out.message.split('\n')[0]!,
    })
  }
  const gh = await locateBin($, os, 'gh', '')
  const auth = gh ? await $.process.run([gh, 'auth', 'status'], { timeoutMs: 10_000 }).catch(() => undefined) : undefined
  checks.push({
    label: 'GitHub CLI (for Share)',
    ok: gh ? auth?.exitCode === 0 : null,
    detail: gh ? (auth?.exitCode === 0 ? gh : `${gh}, not signed in: run \`gh auth login\``) : 'not found (optional): https://cli.github.com',
  })
  checks.push({ label: 'Terminal images', ok: null, detail: (await isKitty($)) ? 'on (kitty protocol)' : 'off (needs kitty or Ghostty)' })
  checks.push({ label: 'Board folder', ok: null, detail: await boardDir($) })
  checks.push({ label: 'Theme', ok: null, detail: settings.theme + (settings.mermaidConfig ? `, config ${settings.mermaidConfig}` : '') })
  return formatDoctor(checks)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    mmdcPath: typeof options.mmdcPath === 'string' ? options.mmdcPath.trim() : '',
    theme: themeOf(options.theme),
    mermaidConfig: typeof options.mermaidConfig === 'string' ? options.mermaidConfig.trim() : '',
  }

  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'draw', description: DESCRIPTION, inputSchema: INPUT_SCHEMA })
    await $.command.register({
      name: 'whiteboard', description: "Open the whiteboard pane, or ask Claude for a diagram", argumentHint: COMMAND_HINT,
    })
    await loadSaved($)
    const version = await $.session.version()
    const engine = version.base ?? version.version
    if (isOlder(engine, MIN_ENGINE)) {
      $.ui.toast(`Whiteboard was built for Claude Code ${MIN_ENGINE}+ and this is ${engine}: some features may not work. Run /whiteboard doctor.`)
    }
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const args = e as unknown as { title?: unknown; source?: unknown; mermaid?: unknown; language?: unknown }
    const raw = typeof args.source === 'string' ? args.source : args.mermaid
    const title = typeof args.title === 'string' ? cleanTitle(args.title) : ''
    const source = typeof raw === 'string' ? stripFences(raw.replace(/\r\n?/g, '\n')) : ''
    const language = args.language === undefined ? 'mermaid' : args.language
    if (!source) return { deny: 'draw needs `source`: the diagram source.' }
    if (!title || title.length > 80) return { deny: 'draw needs a `title` of 1 to 80 characters.' }
    if (!isLanguage(language)) return { deny: 'draw `language` must be mermaid, d2 or plantuml.' }

    const id = await newId($)
    const bin = await binFor($, language, settings)
    const out = await renderDiagram($, { language, source, dir: await boardDir($), id, format: 'svg', bin, settings })
    if (!out.ok) return { deny: out.message }

    let entry: Entry = { id, title, source, language, svgPath: out.path, svgBytes: out.bytes, createdAt: await $.clock.now() }
    if (await wantsPng($)) entry = await addPng($, entry, bin, settings)
    const board = await changeBoard($, h => add(h, entry))
    const at = board.entries.findIndex(x => x.id === id) + 1
    const version = versionInfo(board, entry)

    const opened = await $.ui.open({ id: PANE, title: 'Whiteboard' })
      .catch((err: unknown) => ({ isPlaced: false as const, reason: errorText(err) }))
    const notes = [
      version.of > 1 ? `Version ${version.n} of '${title}'.` : '',
      out.bytes > MAX_INLINE_SVG
        ? 'The SVG is too large to show inline: the pane shows its source and an Open button. Consider splitting the diagram.'
        : '',
      opened.isPlaced ? '' : `The pane did not open (${opened.reason}); tell the user to run /whiteboard to see it.`,
    ].filter(Boolean)

    return { result: [`Drawn '${title}' (${at}/${board.entries.length}).`, ...notes].join(' ') }
  }).catch(() => ({ deny: 'The whiteboard hit an unexpected error while drawing. Try again; if it repeats, tell the user to run /whiteboard doctor.' }))

  on('command.run', { command: 'whiteboard' }, async ($, e) => {
    const plan = parseCommand(e.args ?? '')
    switch (plan.kind) {
      case 'doctor':
        return { text: await doctor($, settings) }
      case 'help':
        return { text: helpText() }
      case 'prompt':
        // A command holds the turn it answers: submit once it has ended.
        $.clock.after(0, () => void $.prompt.submit({ text: plan.text }))
        return { text: plan.note }
      case 'open': {
        const opened = await $.ui.open({ id: PANE, title: 'Whiteboard', focus: true })
        return { text: opened.isPlaced ? 'Whiteboard opened.' : `Whiteboard could not open: ${opened.reason}` }
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const board = (await read($, history)) ?? EMPTY
    const entry = current(board)
    if (!entry) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{EMPTY_HINT}</Text>
        </Box>
      )
    }

    const language = languageOf(entry)
    const isTerminal = e.surface === 'terminal'
    // The terminal's table carries an Svg that draws nothing there: show the source instead.
    const Svg = !isTerminal && 'Svg' in els ? els.Svg : undefined
    const Image = isTerminal && 'Image' in els ? els.Image : undefined
    const Input = 'Input' in els ? els.Input : undefined
    const isMissing = !(await $.fs.exists(entry.svgPath))
    const isTooLarge = entry.svgBytes > MAX_INLINE_SVG
    const svg = Svg && !isMissing && !isTooLarge ? await $.fs.read(entry.svgPath).catch(() => undefined) : undefined
    const png = Image && entry.pngPath && entry.pngWidth && entry.pngHeight && (await isKitty($)) && (await $.fs.exists(entry.pngPath))
      ? { path: entry.pngPath, width: entry.pngWidth, height: entry.pngHeight }
      : undefined
    const columns = Math.max(10, Math.min(e.props.bodyColumns, 255))
    const view = sourceView(entry.source, language)
    const version = versionInfo(board, entry)
    const isConfirmingShare = (await read($, shareConfirm)) === entry.id
    const note = isMissing
      ? 'Render missing (its files were cleaned up).'
      : Svg && isTooLarge
        ? 'Too large to show inline: press Open to view it.'
        : ''

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="prev" hotkey="h" plain label="◀" dimColor={board.index <= 0}
            onPress={() => changeBoard($, x => step(x, -1))} />
          <Text>{`${board.index + 1}/${board.entries.length}`}</Text>
          <Button key="next" hotkey="l" plain label="▶" dimColor={board.index >= board.entries.length - 1}
            onPress={() => changeBoard($, x => step(x, 1))} />
          <Text bold>{entry.title}</Text>
          {version.of > 1 ? (
            <Box flexDirection="row" gap={1}>
              <Button key="olderVersion" plain label="‹" dimColor={version.older === undefined}
                onPress={() => (version.older === undefined ? undefined : changeBoard($, x => jumpTo(x, version.older!)))} />
              <Text dimColor>{`v${version.n}/${version.of}`}</Text>
              <Button key="newerVersion" plain label="›" dimColor={version.newer === undefined}
                onPress={() => (version.newer === undefined ? undefined : changeBoard($, x => jumpTo(x, version.newer!)))} />
            </Box>
          ) : null}
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="export" label="Export" onPress={async () => $.ui.toast(await exportEntry($, entry).catch((err: unknown) => `Export failed: ${errorText(err)}`))} />
          <Button key="copy" label="Copy" onPress={async p => $.ui.toast(await copyText($, entry.source, p.surface, 'Copied the diagram source.'))} />
          <Button key="copyMd" label="Copy MD" onPress={async p => $.ui.toast(await copyText($, fenceBlock(language, entry.source), p.surface,
            language === 'mermaid' ? 'Copied as a Markdown block: it renders in GitHub, GitLab and Notion.' : 'Copied as a Markdown block.'))} />
          <Button key="share" label="Share" onPress={() => update($, shareConfirm, () => entry.id)} />
          <Button key="open" hotkey="o" label="Open" onPress={async () => {
            const problem = await openEntry($, entry)
            if (problem) $.ui.toast(problem)
          }} />
        </Box>
        {isConfirmingShare ? (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text>{`Upload '${entry.title}' as a secret GitHub gist? Anyone with the link can see it.`}</Text>
            <Button key="shareYes" variant="primary" label="Upload" onPress={async p => {
              await update($, shareConfirm, () => null)
              $.ui.toast(await shareEntry($, entry, p.surface).catch((err: unknown) => `Share failed: ${errorText(err)}`))
            }} />
            <Button key="shareNo" label="Cancel" onPress={() => update($, shareConfirm, () => null)} />
          </Box>
        ) : null}
        {note ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>{note}</Text>
            {isMissing ? <Button key="rerender" label="Re-render" onPress={() => rerender($, entry, settings)} /> : null}
          </Box>
        ) : null}
        {Svg && svg !== undefined
          ? <Svg source={svg} alt={entry.title} />
          : Image && png
            ? <Image key="diagram" source={{ file: png.path, format: 'png' }} columns={columns} rows={imageRows(png.width, png.height, columns)} alt={entry.title} />
            : (
              <Box flexDirection="column">
                <Markdown text={view.text} />
                {view.isTruncated ? <Text dimColor>Source truncated: use Copy or Export for the full text.</Text> : null}
              </Box>
            )}
        {Input ? (
          <Input key="revise" placeholder="Ask Claude to change this diagram…" submitLabel="send"
            onSubmit={value => askToRevise($, entry, value)} />
        ) : null}
      </Box>
    )
  })
}
