import { describe, expect, test } from 'claude-code/testing'

import { boardDirFrom, dirname, failureOf, locatedPath, mmdcArgv, mmdcEnv, rejectionOf, stripFences } from './render'

// The engine follows `$` only into functions of the same file, so the parts of
// rendering that call `$` live in register.tsx and draw.test.ts covers them;
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
  })

  test('boardDirFrom', () => {
    expect(boardDirFrom('/var/T/', 's1')).toBe('/var/T/claude-whiteboard/s1')
    expect(boardDirFrom(undefined, 's1')).toBe('/tmp/claude-whiteboard/s1')
  })

  test('mmdcArgv and mmdcEnv', () => {
    expect(mmdcArgv('/n/bin/mmdc', '/d/x.mmd', '/d/x.svg')).toEqual(['/n/bin/mmdc', '-i', '/d/x.mmd', '-o', '/d/x.svg', '-b', 'white', '-q', '--no-font-embed'])
    expect(mmdcEnv('/n/bin/mmdc', '/usr/bin', '/Users/u')).toEqual({ PATH: '/n/bin:/usr/bin', HOME: '/Users/u' })
    expect(mmdcEnv('/n/bin/mmdc', undefined, undefined)).toEqual({ PATH: '/n/bin:/usr/bin:/bin' })
  })

  test('failureOf classifies a non-zero exit', () => {
    expect(failureOf({ exitCode: 1, stderr: "Error: Parse error on line 2:\n...", stdout: '' }))
      .toMatchObject({ ok: false, kind: 'syntax', message: expect.stringContaining('Parse error on line 2') })
    expect(failureOf({ exitCode: 1, stderr: 'Error: Failed to launch the browser process', stdout: '' }))
      .toMatchObject({ ok: false, kind: 'failed' })
    expect(failureOf({ exitCode: 3, stderr: '', stdout: '' }))
      .toEqual({ ok: false, kind: 'failed', message: 'mmdc exited with code 3.' })
    expect(failureOf({ exitCode: 1, stderr: 'x'.repeat(5000), stdout: '' }).message).toHaveLength(2000)
  })

  test('rejectionOf tells a timeout from a launch failure', () => {
    expect(rejectionOf(new Error('process timed out after 20000 ms'))).toMatchObject({ kind: 'timeout', message: expect.stringContaining('longer than 20s') })
    expect(rejectionOf(new Error('spawn EACCES'))).toEqual({ ok: false, kind: 'failed', message: 'mmdc could not run: spawn EACCES' })
  })

  test('locatedPath', () => {
    expect(locatedPath({ exitCode: 0, stdout: 'Now using node v22\n/n/bin/mmdc\n' })).toBe('/n/bin/mmdc')
    expect(locatedPath({ exitCode: 1, stdout: '' })).toBeNull()
    expect(locatedPath({ exitCode: 0, stdout: 'mmdc not found' })).toBeNull()
  })
})
