import type { IMarker, Terminal } from '@xterm/xterm'

/** A finished OSC 133 command or agent turn: the line just before its output and the first line after it. */
export type TerminalOutputBlock = { header: IMarker; end: IMarker }

// Fewer lines than this take about as much room folded as expanded.
export const MIN_FOLDED_OUTPUT_LINES = 3

export type TerminalOutputBlockTracker = {
  /** Feed the payload of each OSC 133 sequence as xterm parses it, so markers land on the cursor line. */
  handleMark: (payload: string) => void
  dispose: () => void
}

export function createTerminalOutputBlockTracker(
  terminal: Terminal,
  onBlock: (block: TerminalOutputBlock) => void
): TerminalOutputBlockTracker {
  let header: IMarker | null = null
  const drop = (): void => {
    header?.dispose()
    header = null
  }

  return {
    handleMark(payload) {
      const buffer = terminal.buffer.active
      if (buffer.type !== 'normal') {
        drop()
        return
      }
      const sequence = payload.split(';', 1)[0]
      if (sequence === 'A') {
        drop()
      } else if (sequence === 'C') {
        drop()
        // Shells mark C where output starts; agents such as Devin mark it at the end of the user's message.
        const onHeaderLine = buffer.cursorX > 0
        if (onHeaderLine || buffer.baseY + buffer.cursorY > 0) {
          header = terminal.registerMarker(onHeaderLine ? 0 : -1)
        }
      } else if (sequence === 'D' && header) {
        const start = header
        header = null
        const end = terminal.registerMarker(0)
        if (!start.isDisposed && end.line - start.line - 1 >= MIN_FOLDED_OUTPUT_LINES) {
          onBlock({ header: start, end })
        } else {
          start.dispose()
          end.dispose()
        }
      }
    },
    dispose: drop
  }
}
