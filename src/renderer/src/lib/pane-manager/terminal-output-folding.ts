import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm'
import type { TerminalOutputFoldingSettings } from '../../../../shared/terminal-output-folding-settings'
import { hasTerminalFoldApi, type TerminalFold } from './terminal-fold-api'
import {
  createTerminalOutputBlockTracker,
  type TerminalOutputBlock
} from './terminal-output-blocks'
import { registerTerminalOutputFoldToggle } from './terminal-output-fold-toggle'

export type { TerminalOutputFoldingSettings }

export type TerminalOutputFolding = {
  /** Called from the pane's OSC 133 parser handler, while the cursor is still on the marked line. */
  handleOsc133: (payload: string) => void
  update: (settings: TerminalOutputFoldingSettings) => void
  /** Expands every collapsed fold with a hidden line `matches` accepts; returns how many it expanded. */
  expandMatching: (matches: (line: string) => boolean) => number
  /** Stops tracking. Folds stay with the terminal, which must be disposed next. */
  dispose: () => void
}

type FoldEntry = {
  fold: TerminalFold
  toggle: IDecoration | undefined
  /** Keeps hiding the block's lines as they scroll into the scrollback. */
  growing: boolean
  /** Expanded by the user or by find: automatic folding leaves it alone. */
  pinnedOpen: boolean
}

const foldingByTerminal = new WeakMap<Terminal, TerminalOutputFolding>()

export function getTerminalOutputFolding(terminal: Terminal): TerminalOutputFolding | undefined {
  return foldingByTerminal.get(terminal)
}

/** Folds finished OSC 133 blocks (shell commands, agent turns). Null without Orca's patched xterm. */
export function attachTerminalOutputFolding(
  terminal: Terminal,
  initialSettings: TerminalOutputFoldingSettings
): TerminalOutputFolding | null {
  if (!hasTerminalFoldApi(terminal)) {
    return null
  }
  let settings = initialSettings
  const entries = new Set<FoldEntry>()
  let pending: TerminalOutputBlock[] = []
  let workListeners: IDisposable[] | null = null
  let running = false

  const tracker = createTerminalOutputBlockTracker(terminal, (block) => {
    pending.push(block)
    scheduleWork()
  })

  const remainingRangeIsVisible = (fold: TerminalFold): boolean => {
    const buffer = terminal.buffer.normal
    if (buffer.viewportY >= buffer.baseY) {
      return false
    }
    const start = fold.marker.line + 1
    const end = Math.min(start + fold.lineCount - fold.hiddenLineCount, buffer.baseY)
    return start < buffer.viewportY + terminal.rows && end > buffer.viewportY
  }

  const grow = (entry: FoldEntry): void => {
    const { fold } = entry
    // Never pull lines out from under a reader scrolled up into them; retry on the next scroll.
    if (fold.isDisposed || remainingRangeIsVisible(fold)) {
      return
    }
    fold.collapse()
    if (fold.hiddenLineCount >= fold.lineCount) {
      entry.growing = false
    }
  }

  // Expanding fires onScroll synchronously, so mark the entry first or the work loop folds it again.
  const pinOpen = (entry: FoldEntry): void => {
    entry.pinnedOpen = true
    entry.growing = false
    entry.fold.expand()
  }

  const toggle = (entry: FoldEntry): void => {
    if (entry.fold.isCollapsed) {
      pinOpen(entry)
      return
    }
    entry.pinnedOpen = false
    entry.growing = true
    entry.fold.collapse()
    scheduleWork()
  }

  const addToggle = (entry: FoldEntry): void => {
    entry.toggle?.dispose()
    entry.toggle = registerTerminalOutputFoldToggle(terminal, entry.fold, () => toggle(entry))
  }

  const register = (block: TerminalOutputBlock): void => {
    const fold = terminal.registerFold(block.header, block.end)
    // The fold keeps markers of its own.
    block.header.dispose()
    block.end.dispose()
    if (!fold) {
      return
    }
    const entry: FoldEntry = {
      fold,
      toggle: undefined,
      growing: settings.autoCollapse,
      pinnedOpen: false
    }
    entries.add(entry)
    addToggle(entry)
    fold.onDispose(() => {
      entries.delete(entry)
      entry.toggle?.dispose()
    })
  }

  const hasWork = (): boolean => pending.length > 0 || [...entries].some((entry) => entry.growing)

  const stopWork = (): void => {
    workListeners?.forEach((listener) => listener.dispose())
    workListeners = null
  }

  const run = (): void => {
    // Collapsing fires onScroll synchronously.
    if (running) {
      return
    }
    running = true
    try {
      const blocks = pending
      pending = []
      blocks.forEach(register)
      for (const entry of entries) {
        if (entry.growing) {
          grow(entry)
        }
      }
    } finally {
      running = false
    }
    if (!hasWork()) {
      stopWork()
    }
  }

  // Listen only while blocks wait or folds grow, so idle output pays nothing.
  function scheduleWork(): void {
    workListeners ??= [terminal.onWriteParsed(run), terminal.onScroll(run)]
  }

  let toggleCols = terminal.cols
  const resizeListener = terminal.onResize(({ cols }) => {
    // Toggle columns are fixed at registration; place them again for the new width.
    if (cols === toggleCols) {
      return
    }
    toggleCols = cols
    entries.forEach(addToggle)
  })

  const dropPending = (): void => {
    for (const block of pending) {
      block.header.dispose()
      block.end.dispose()
    }
    pending = []
  }

  const folding: TerminalOutputFolding = {
    handleOsc133(payload) {
      if (settings.enabled) {
        tracker.handleMark(payload)
      }
    },
    update(next) {
      const previous = settings
      settings = next
      if (!next.enabled) {
        tracker.dispose()
        dropPending()
        stopWork()
        // Disposing a fold puts its hidden lines back.
        ;[...entries].forEach((entry) => entry.fold.dispose())
        return
      }
      if (next.autoCollapse === previous.autoCollapse) {
        return
      }
      for (const entry of entries) {
        entry.growing = next.autoCollapse
          ? !entry.pinnedOpen
          : entry.growing && entry.fold.isCollapsed
      }
      if (next.autoCollapse) {
        scheduleWork()
      }
    },
    expandMatching(matches) {
      let expanded = 0
      for (const entry of entries) {
        if (entry.fold.isCollapsed && entry.fold.translateHiddenLines().some(matches)) {
          pinOpen(entry)
          expanded += 1
        }
      }
      return expanded
    },
    dispose() {
      tracker.dispose()
      dropPending()
      stopWork()
      resizeListener.dispose()
      entries.forEach((entry) => entry.toggle?.dispose())
      entries.clear()
      foldingByTerminal.delete(terminal)
    }
  }
  foldingByTerminal.set(terminal, folding)
  return folding
}
