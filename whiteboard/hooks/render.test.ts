import { describe, expect, test } from 'claude-code/testing'

import { dirname, stripFences } from './render'

// renderMermaid, boardDir and locateMmdc need a plugin's `$` (fs, env, process),
// which the test kit's engine `$` does not carry: draw.test.ts covers them
// through the draw tool.
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
})
