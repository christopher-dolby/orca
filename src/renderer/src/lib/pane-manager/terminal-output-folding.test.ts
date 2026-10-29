// @vitest-environment happy-dom

import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it } from 'vitest'
import { FoldAwareSearchAddon } from './terminal-fold-aware-addons'
import { attachTerminalOutputFolding, type TerminalOutputFolding } from './terminal-output-folding'

const cleanups: (() => void)[] = []
const originalGetContext =
  Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext') ?? {}

function setup({ autoCollapse = true, devin = true, open = false } = {}): {
  terminal: Terminal
  folding: TerminalOutputFolding
} {
  const terminal = new Terminal({ cols: 40, rows: 20, scrollback: 200 })
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
  folding.setDevinCheck(() => devin)
  cleanups.push(() => {
    folding.dispose()
    terminal.dispose()
  })
  return { terminal, folding }
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function screen(terminal: Terminal): string[] {
  const buffer = terminal.buffer.normal
  return Array.from({ length: terminal.rows }, (_, i) =>
    (buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '').trimEnd()
  )
}

const numbered = (count: number): string[] => Array.from({ length: count }, (_, i) => ` │ ${i}`)

// Devin's layout: committed cards above a live region of spinner and input box, cursor in the box.
function devinScreen(cards: string[][], { running = '' } = {}): string {
  const body = cards.flatMap((card) => [...card, ''])
  const live = [running, '──────────── (bypass permissions on) ─', '❭ ']
  return ['❭ list the files', '', ...body, ...live].join('\r\n')
}

const ranCommand = [' ⏺ Ran command', ' │ $ seq 1 6', ...numbered(6), ' └ Exited with code 0']

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalGetContext)
  document.body.replaceChildren()
})

describe('Devin tool card folding', () => {
  it('folds a finished card on the live screen and leaves the input box where it was', async () => {
    const { terminal } = setup()
    const unfolded = setup({ devin: false })
    await write(terminal, devinScreen([ranCommand]))
    await write(unfolded.terminal, devinScreen([ranCommand]))
    const cursorY = terminal.buffer.normal.cursorY

    expect(cursorY).toBe(unfolded.terminal.buffer.normal.cursorY)
    expect(screen(terminal).slice(cursorY - 6, cursorY + 1)).toEqual([
      ' ⏺ Ran command',
      ' │ $ seq 1 6',
      ' └ Exited with code 0',
      '',
      '',
      '──────────── (bypass permissions on) ─',
      '❭'
    ])
    expect(screen(terminal)).not.toContain(' │ 0')
  })

  it('keeps a running card and other agents untouched', async () => {
    const running = setup()
    await write(
      running.terminal,
      devinScreen([], { running: ' ⏺ Running command' }).replace(
        ' ⏺ Running command',
        [' ⏺ Running command', ' │ $ seq 1 6', ...numbered(6)].join('\r\n')
      )
    )
    expect(screen(running.terminal)).toContain(' │ 0')

    const shell = setup({ devin: false })
    await write(shell.terminal, devinScreen([ranCommand]))
    expect(screen(shell.terminal)).toContain(' │ 0')
  })

  it('only folds when automatic folding is on, and folds existing cards once it is', async () => {
    const { terminal, folding } = setup({ autoCollapse: false })
    await write(terminal, devinScreen([ranCommand]))
    expect(screen(terminal)).toContain(' │ 0')

    folding.update({ enabled: true, autoCollapse: true })
    expect(screen(terminal)).not.toContain(' │ 0')
  })

  it('expands a card that holds a find match and keeps it open', async () => {
    const { terminal } = setup({ open: true })
    const search = new FoldAwareSearchAddon()
    terminal.loadAddon(search)
    const needle = [
      ' ⏺ Ran command',
      ' │ $ grep',
      ' │ a',
      ' │ needle',
      ' │ b',
      ' └ Exited with code 0'
    ]
    await write(terminal, devinScreen([needle]))
    expect(screen(terminal)).not.toContain(' │ needle')

    expect(search.findNext('needle', { incremental: true })).toBe(true)
    expect(screen(terminal)).toContain(' │ needle')
    await write(terminal, `\r\n${[...ranCommand, '', '── box ──────────', '❭ '].join('\r\n')}`)
    expect(screen(terminal)).toContain(' │ needle')
  })

  it('puts every hidden line back when folding is turned off', async () => {
    const { terminal, folding } = setup()
    await write(terminal, devinScreen([ranCommand]))
    folding.update({ enabled: false, autoCollapse: true })
    expect(screen(terminal)).toEqual(expect.arrayContaining([' │ 0', ' │ 5']))
  })
})
