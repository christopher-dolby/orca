// @vitest-environment happy-dom

import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it } from 'vitest'
import { createTerminalCommandLifecycle } from '@/components/terminal-pane/terminal-command-lifecycle'
import { FoldAwareSearchAddon } from './terminal-fold-aware-addons'
import { attachTerminalOutputFolding, type TerminalOutputFolding } from './terminal-output-folding'

const OSC = (payload: string): string => `\x1b]133;${payload}\x07`
const cleanups: (() => void)[] = []
const originalGetContext =
  Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext') ?? {}

function setup(
  autoCollapse: boolean,
  { open = false }: { open?: boolean } = {}
): { terminal: Terminal; folding: TerminalOutputFolding } {
  const terminal = new Terminal({ cols: 40, rows: 6, scrollback: 200 })
  if (open) {
    // xterm's DOM renderer only measures glyph widths through the canvas context.
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ measureText: () => ({ width: 10 }) })
    })
    const container = document.createElement('div')
    document.body.append(container)
    terminal.open(container)
  }
  const folding = attachTerminalOutputFolding(terminal, { enabled: true, autoCollapse })
  if (!folding) {
    throw new Error('the @xterm/xterm patch no longer provides registerFold')
  }
  const lifecycle = createTerminalCommandLifecycle({ onCommandFinished: () => {} })
  lifecycle.attachXtermConsumer(terminal)
  cleanups.push(() => {
    lifecycle.dispose()
    folding.dispose()
    terminal.dispose()
  })
  return { terminal, folding }
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function lines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.normal
  return Array.from({ length: buffer.length }, (_, i) =>
    (buffer.getLine(i)?.translateToString(true) ?? '').trimEnd()
  )
}

// Devin marks C at the end of the user's message and D where the turn's output ends.
function devinTurn(message: string, output: string[]): string {
  return `${OSC('A;k=i')}❭ ${message}${OSC('B')}${OSC('C')}\r\n${output.map((line) => `${line}\r\n`).join('')}${OSC('D;0')}`
}

const numbered = (name: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `${name} ${i}`)

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
  document.body.replaceChildren()
})

describe('terminal output folding', () => {
  it('folds a finished agent turn behind the user message as it leaves the screen', async () => {
    const { terminal } = setup(true)
    await write(terminal, devinTurn('list files', numbered('out', 12)))
    await write(terminal, '── input box ──\r\n❭ \r\n')

    // out 9 onward is still on the live screen.
    expect(lines(terminal)).toEqual([
      '❭ list files',
      'out 9',
      'out 10',
      'out 11',
      '── input box ──',
      '❭',
      ''
    ])
    await write(terminal, `${devinTurn('next', ['done'])}\r\n`)
    expect(lines(terminal).slice(0, 2)).toEqual(['❭ list files', '── input box ──'])
  })

  it('folds a shell command behind its command line', async () => {
    const { terminal } = setup(true)
    await write(
      terminal,
      `${OSC('A')}$ ${OSC('B')}ls\r\n${OSC('C')}${numbered('file', 10).join('\r\n')}\r\n${OSC('D;0')}${OSC('A')}$ `
    )
    await write(terminal, '\r\n\r\n\r\n\r\n\r\n')
    expect(lines(terminal).slice(0, 2)).toEqual(['$ ls', '$'])
  })

  it('leaves output expanded until automatic folding is turned on', async () => {
    const { terminal, folding } = setup(false)
    await write(terminal, devinTurn('list files', numbered('out', 12)))
    await write(terminal, '── input box ──\r\n')
    expect(lines(terminal)).toHaveLength(15)

    folding.update({ enabled: true, autoCollapse: true })
    await write(terminal, '\r\n')
    expect(lines(terminal)[1]).toBe('out 9')
  })

  it('waits while the reader is scrolled into the block', async () => {
    const { terminal } = setup(true)
    await write(terminal, `${numbered('before', 10).join('\r\n')}\r\n`)
    await write(terminal, `${OSC('A;k=i')}❭ go${OSC('B')}${OSC('C')}\r\n`)
    await write(terminal, `${numbered('out', 12).join('\r\n')}\r\n`)
    terminal.scrollToLine(12)
    await write(terminal, `${OSC('D;0')}── input box ──\r\n`)
    expect(lines(terminal)).toContain('out 2')

    terminal.scrollToBottom()
    expect(lines(terminal)).not.toContain('out 2')
    expect(lines(terminal)).toContain('❭ go')
  })

  it('expands folds that hold a match when find navigates', async () => {
    // Find selects its match, which needs an opened terminal.
    const { terminal } = setup(true, { open: true })
    const search = new FoldAwareSearchAddon()
    terminal.loadAddon(search)
    await write(
      terminal,
      devinTurn('brew info', [...numbered('out', 6), 'needle', ...numbered('more', 6)])
    )
    await write(terminal, '── input box ──\r\n')
    expect(lines(terminal)).not.toContain('needle')

    expect(search.findNext('needle', { incremental: true })).toBe(true)
    expect(lines(terminal)).toContain('needle')
    // Expanded by find, the block stays open as later output arrives.
    await write(terminal, '\r\n'.repeat(8))
    expect(lines(terminal)).toContain('needle')
  })

  it('puts every hidden line back when folding is turned off', async () => {
    const { terminal, folding } = setup(true)
    await write(terminal, devinTurn('list files', numbered('out', 12)))
    await write(terminal, '── input box ──\r\n')
    expect(lines(terminal)).not.toContain('out 0')

    folding.update({ enabled: false, autoCollapse: true })
    expect(lines(terminal).slice(0, 3)).toEqual(['❭ list files', 'out 0', 'out 1'])
    await write(terminal, `${devinTurn('again', numbered('x', 12))}${'\r\n'.repeat(6)}`)
    expect(lines(terminal)).toContain('x 0')
  })
})
