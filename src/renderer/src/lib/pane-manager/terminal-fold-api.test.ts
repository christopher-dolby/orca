// @vitest-environment happy-dom

import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it } from 'vitest'
import { hasTerminalFoldApi, type TerminalFold } from './terminal-fold-api'
import { FoldAwareSerializeAddon } from './terminal-fold-aware-addons'

const terminals: Terminal[] = []

function createTerminal(options: { cols?: number; rows?: number; scrollback?: number } = {}) {
  const terminal = new Terminal({ cols: 20, rows: 4, scrollback: 100, ...options })
  terminals.push(terminal)
  if (!hasTerminalFoldApi(terminal)) {
    throw new Error('the @xterm/xterm patch no longer provides registerFold')
  }
  return terminal
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

async function foldBlock(
  terminal: ReturnType<typeof createTerminal>,
  name: string,
  outputLines: number
): Promise<TerminalFold> {
  await write(terminal, `$ ${name}\r\n`)
  const header = terminal.registerMarker(-1)
  for (let i = 0; i < outputLines; i++) {
    await write(terminal, `${name} ${i}\r\n`)
  }
  const fold = terminal.registerFold(header, terminal.registerMarker(0))
  if (!fold) {
    throw new Error('registerFold refused a valid range')
  }
  return fold
}

afterEach(() => {
  for (const terminal of terminals.splice(0)) {
    terminal.dispose()
  }
})

describe('xterm fold patch', () => {
  it('hides only scrollback lines and serializes them anyway', async () => {
    const terminal = createTerminal()
    const fold = await foldBlock(terminal, 'ls', 8)
    const expanded = lines(terminal)

    // `$ ls`, ls 0..7, cursor row: rows 0..5 are scrollback, ls 5..7 and the cursor row are the screen.
    expect(fold.collapse()).toBe(5)
    expect(lines(terminal)).toEqual(['$ ls', 'ls 5', 'ls 6', 'ls 7', ''])
    expect(terminal.buffer.normal.baseY).toBe(1)

    const serializer = new FoldAwareSerializeAddon()
    terminal.loadAddon(serializer)
    const restored = createTerminal()
    await write(restored, serializer.serialize())
    expect(lines(restored)).toEqual(expanded)
    expect(lines(terminal)).toEqual(['$ ls', 'ls 5', 'ls 6', 'ls 7', ''])
  })

  it('absorbs the rest of the block as it scrolls into the scrollback', async () => {
    const terminal = createTerminal()
    const fold = await foldBlock(terminal, 'ls', 8)
    fold.collapse()
    await write(terminal, '$ next\r\na\r\nb\r\n')

    expect(fold.collapse()).toBe(3)
    expect(fold.hiddenLineCount).toBe(fold.lineCount)
    expect(lines(terminal)).toEqual(['$ ls', '$ next', 'a', 'b', ''])
    fold.expand()
    expect(lines(terminal).slice(0, 10)).toEqual([
      '$ ls',
      ...Array.from({ length: 8 }, (_, i) => `ls ${i}`),
      '$ next'
    ])
  })

  it('counts hidden lines against the scrollback so expanding never trims history', async () => {
    const terminal = createTerminal({ scrollback: 20 })
    const fold = await foldBlock(terminal, 'big', 10)
    for (let i = 0; i < 30; i++) {
      await write(terminal, `after ${i}\r\n`)
    }
    const reference = createTerminal({ scrollback: 20 })
    await foldBlock(reference, 'big', 10)
    for (let i = 0; i < 30; i++) {
      await write(reference, `after ${i}\r\n`)
    }
    // The header scrolled off with its block: the fold is gone and nothing extra was kept.
    expect(fold.isDisposed).toBe(true)
    expect(lines(terminal)).toEqual(lines(reference))

    const kept = await foldBlock(terminal, 'kept', 10)
    for (let i = 0; i < 6; i++) {
      await write(terminal, `tail ${i}\r\n`)
    }
    kept.collapse()
    for (let i = 0; i < 6; i++) {
      await write(terminal, `more ${i}\r\n`)
    }
    const visible = terminal.buffer.normal.length
    expect(visible + kept.hiddenLineCount).toBe(24)
    kept.expand()
    expect(terminal.buffer.normal.length).toBe(24)
    expect(lines(terminal)).toContain('$ kept')
  })

  it('reflows hidden lines with the rest of the buffer on resize', async () => {
    const terminal = createTerminal({ cols: 10 })
    await write(terminal, '$ cat\r\n')
    const header = terminal.registerMarker(-1)
    await write(terminal, 'abcdefghijklmnopqrstuvwxyz\r\n0123456789012345\r\n')
    const fold = terminal.registerFold(header, terminal.registerMarker(0))
    for (let i = 0; i < 6; i++) {
      await write(terminal, `t${i}\r\n`)
    }
    const expanded = terminal.withFoldsExpanded(() => lines(terminal))

    expect(fold?.collapse()).toBe(5)
    terminal.resize(5, 4)
    expect(fold?.hiddenLineCount).toBe(10)
    terminal.resize(30, 4)
    expect(fold?.hiddenLineCount).toBe(2)
    terminal.resize(10, 4)
    expect(terminal.withFoldsExpanded(() => lines(terminal))).toEqual(expanded)
  })

  it('keeps the viewport on the same text when folding above it', async () => {
    const terminal = createTerminal()
    const fold = await foldBlock(terminal, 'ls', 8)
    for (let i = 0; i < 12; i++) {
      await write(terminal, `later ${i}\r\n`)
    }
    terminal.scrollToLine(14)
    const top = () =>
      terminal.buffer.normal.getLine(terminal.buffer.normal.viewportY)?.translateToString(true)
    const before = top()

    fold.collapse()
    expect(top()).toBe(before)
    fold.expand()
    expect(top()).toBe(before)
  })

  it('stops at what is hidden once a clear screen erases the rest of the block', async () => {
    const terminal = createTerminal({ rows: 5 })
    const fold = await foldBlock(terminal, 'ls', 8)
    expect(fold.collapse()).toBe(4)

    await write(terminal, '\x1b[H\x1b[2J$ next\r\n')
    for (let i = 0; i < 6; i++) {
      await write(terminal, `n ${i}\r\n`)
    }
    expect(fold.collapse()).toBe(0)
    expect(lines(terminal)).toContain('$ next')

    await write(terminal, '\x1b[3J')
    expect(fold.isDisposed).toBe(true)
  })

  it('refuses ranges outside the normal buffer', async () => {
    const terminal = createTerminal()
    await write(terminal, 'one\r\ntwo\r\nthree\r\n')
    const start = terminal.registerMarker(-3)
    const end = terminal.registerMarker(0)
    expect(terminal.registerFold(end, start)).toBeUndefined()

    await write(terminal, '\x1b[?1049h')
    const altStart = terminal.registerMarker(0)
    await write(terminal, 'x\r\ny\r\nz\r\n')
    expect(terminal.registerFold(altStart, terminal.registerMarker(0))).toBeUndefined()
  })
})
