import { describe, expect, test } from 'claude-code/testing'

import {
  binEnv, boardDirFrom, byNewestVersion, dirname, failureOf, fallbackDirs, imageRows, isKittyTerminal, isOlder,
  locatedPath, lookupArgv, missingHint, openArgv, platformOf, pngSize, projectKey, rejectionOf, removeArgv,
  renderArgv, stripFences, themeOf,
} from './render'
import { PNG_OK } from './testkit'

// The engine follows `$` only into functions of the same file, so the parts of
// rendering that call `$` live in register.tsx and the other suites cover them;
// these are the pure pieces they are built from.
describe('render', () => {
  test('stripFences', () => {
    expect(stripFences('```mermaid\ngraph TD\n  A-->B\n```')).toBe('graph TD\n  A-->B')
    expect(stripFences('  graph TD; A-->B  ')).toBe('graph TD; A-->B')
    expect(stripFences('~~~\nflowchart LR\n~~~')).toBe('flowchart LR')
  })

  test('dirname', () => {
    expect(dirname('/a/b/mmdc')).toBe('/a/b')
    expect(dirname('/mmdc')).toBe('/')
    expect(dirname('C:\\npm\\mmdc.cmd')).toBe('C:\\npm')
  })

  test('platformOf', () => {
    expect(platformOf({ os: 'Windows_NT', isMac: false })).toBe('win32')
    expect(platformOf({ os: undefined, isMac: true })).toBe('darwin')
    expect(platformOf({ os: undefined, isMac: false })).toBe('linux')
  })

  test('per-platform argv', () => {
    expect(lookupArgv('darwin', 'mmdc')).toEqual(['/bin/zsh', '-lc', 'command -v mmdc'])
    expect(lookupArgv('linux', 'd2')).toEqual(['/bin/bash', '-lc', 'command -v d2'])
    expect(lookupArgv('win32', 'gh')).toEqual(['where', 'gh'])
    expect(openArgv('darwin', '/a.svg')).toEqual(['open', '/a.svg'])
    expect(openArgv('linux', '/a.svg')).toEqual(['xdg-open', '/a.svg'])
    expect(openArgv('win32', 'C:/a.svg')).toEqual(['cmd', '/c', 'start', '""', 'C:\\a.svg'])
    expect(removeArgv('darwin', ['/a', '/b'])).toEqual(['rm', '-f', '/a', '/b'])
    expect(removeArgv('win32', ['C:/a'])).toEqual(['cmd', '/c', 'del', '/f', '/q', 'C:\\a'])
    expect(fallbackDirs('win32', undefined, 'C:/AppData')).toEqual(['C:/AppData/npm'])
    expect(fallbackDirs('linux', '/h', undefined)).toContain('/h/.local/bin')
  })

  test('binEnv', () => {
    expect(binEnv('/n/bin/mmdc', '/usr/bin', '/Users/u', 'darwin')).toEqual({ PATH: '/n/bin:/usr/bin', HOME: '/Users/u' })
    expect(binEnv('C:\\npm\\mmdc.cmd', 'C:\\Windows', undefined, 'win32')).toEqual({ PATH: 'C:\\npm;C:\\Windows' })
  })

  test('projectKey and boardDirFrom', () => {
    expect(projectKey('/Users/k/Projects/mods')).toMatch(/^mods-[0-9a-f]{8}$/)
    expect(projectKey('/a/mods')).not.toBe(projectKey('/b/mods'))
    expect(boardDirFrom('/Users/k/', 'mods-1')).toBe('/Users/k/.claude/whiteboard/mods-1')
  })

  test('renderArgv per language and theme', () => {
    const req = { bin: '/b/x', input: '/d/i.in', output: '/d/i.svg', dir: '/d', format: 'svg' as const, theme: 'default' as const, mermaidConfig: '' }
    expect(renderArgv('mermaid', req)).toEqual(['/b/x', '-i', '/d/i.in', '-o', '/d/i.svg', '-b', 'white', '-q', '--no-font-embed'])
    expect(renderArgv('mermaid', { ...req, theme: 'dark', mermaidConfig: '/team.json' }))
      .toEqual(['/b/x', '-i', '/d/i.in', '-o', '/d/i.svg', '-b', '#1e1e1e', '-q', '--no-font-embed', '-t', 'dark', '-c', '/team.json'])
    expect(renderArgv('d2', req)).toEqual(['/b/x', '--pad=24', '/d/i.in', '/d/i.svg'])
    expect(renderArgv('plantuml', { ...req, format: 'png', theme: 'dark' })).toEqual(['/b/x', '-tpng', '-darkmode', '-o', '/d', '/d/i.in'])
    expect(themeOf('forest')).toBe('forest')
    expect(themeOf('neon')).toBe('default')
  })

  test('missingHint', () => {
    expect(missingHint('mermaid')).toContain('npm i -g @mermaid-js/mermaid-cli')
    expect(missingHint('mermaid')).toContain('mmdcPath')
    expect(missingHint('d2')).toContain('brew install d2')
  })

  test('failureOf classifies a non-zero exit', () => {
    expect(failureOf({ exitCode: 1, stderr: 'Error: Parse error on line 2:\n...', stdout: '' }))
      .toMatchObject({ ok: false, kind: 'syntax', message: expect.stringContaining('Parse error on line 2') })
    expect(failureOf({ exitCode: 1, stderr: 'err: failed to compile x.d2: 1:3: unexpected', stdout: '' })).toMatchObject({ kind: 'syntax' })
    expect(failureOf({ exitCode: 1, stderr: 'Error: Failed to launch the browser process', stdout: '' })).toMatchObject({ kind: 'failed' })
    expect(failureOf({ exitCode: 3, stderr: '', stdout: '' })).toEqual({ ok: false, kind: 'failed', message: 'The renderer exited with code 3.' })
    expect(failureOf({ exitCode: 1, stderr: 'x'.repeat(5000), stdout: '' }).message).toHaveLength(2000)
  })

  test('failureOf keeps the parse message and drops the stack trace', () => {
    const stderr = [
      'Error: Parse error on line 3:',
      '----------------------^',
      "Expecting 'link', got 'NEWLINE'",
      'Parser.parseError (https://mermaid-cli-intercept.invalid/x/sequenceDiagram.mjs:410:21)',
      '    at #evaluate (file:///x/ExecutionContext.js:402:19)',
    ].join('\n')
    expect(failureOf({ exitCode: 1, stderr, stdout: '' }).message)
      .toBe(['Error: Parse error on line 3:', '----------------------^', "Expecting 'link', got 'NEWLINE'"].join('\n'))
  })

  test('rejectionOf tells a timeout from a launch failure', () => {
    expect(rejectionOf(new Error('process timed out after 20000 ms'))).toMatchObject({ kind: 'timeout', message: expect.stringContaining('longer than 20s') })
    expect(rejectionOf(new Error('spawn EACCES'))).toEqual({ ok: false, kind: 'failed', message: 'The renderer could not run: spawn EACCES' })
  })

  test('locatedPath', () => {
    expect(locatedPath({ exitCode: 0, stdout: 'Now using node v22\n/n/bin/mmdc\n' })).toBe('/n/bin/mmdc')
    expect(locatedPath({ exitCode: 0, stdout: 'C:\\npm\\mmdc\r\nC:\\npm\\mmdc.cmd\r\n' })).toBe('C:\\npm\\mmdc.cmd')
    expect(locatedPath({ exitCode: 1, stdout: '' })).toBeNull()
    expect(locatedPath({ exitCode: 0, stdout: 'mmdc not found' })).toBeNull()
  })

  test('byNewestVersion', () => {
    expect(['v18.20.0', 'v22.10.1', 'v22.9.0', 'system'].sort(byNewestVersion)).toEqual(['v22.10.1', 'v22.9.0', 'v18.20.0', 'system'])
  })

  test('isOlder', () => {
    expect(isOlder('2.1.284', '2.1.286')).toBe(true)
    expect(isOlder('2.1.286', '2.1.286')).toBe(false)
    expect(isOlder('2.2.0', '2.1.286')).toBe(false)
    expect(isOlder('2.1.290-dev', '2.1.286')).toBe(false)
    expect(isOlder('weird', '2.1.286')).toBe(false)
  })

  test('isKittyTerminal', () => {
    expect(isKittyTerminal({ termProgram: 'ghostty' })).toBe(true)
    expect(isKittyTerminal({ term: 'xterm-kitty' })).toBe(true)
    expect(isKittyTerminal({ kittyWindow: '1' })).toBe(true)
    expect(isKittyTerminal({ termProgram: 'iTerm.app', term: 'xterm-256color' })).toBe(false)
  })

  test('pngSize and imageRows', () => {
    expect(pngSize(btoa(PNG_OK))).toEqual({ width: 800, height: 400 })
    expect(pngSize(btoa('not a png at all, really not'))).toBeNull()
    expect(imageRows(800, 400, 80)).toBe(20)
    expect(imageRows(100, 10000, 80)).toBe(60)
  })
})
