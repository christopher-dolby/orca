import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm'
import type { TerminalOutputFoldingSettings } from '../../../../shared/terminal-output-folding-settings'
import { hasTerminalFoldApi, type TerminalFold } from './terminal-fold-api'
import { findDevinInputBoxTop, findDevinToolCards } from './terminal-devin-tool-cards'
import {
  MIN_FOLDED_OUTPUT_LINES,
  registerTerminalOutputFoldToggle
} from './terminal-output-fold-toggle'

export type { TerminalOutputFoldingSettings }

export type TerminalOutputFolding = {
  update: (settings: TerminalOutputFoldingSettings) => void
  /** Card folds only run while this reports that the pane's agent is Devin. */
  setDevinCheck: (isDevin: () => boolean) => void
  /** Expands every collapsed fold with a hidden line `matches` accepts; returns how many it expanded. */
  expandMatching: (matches: (line: string) => boolean) => number
  /** Stops tracking. Folds stay with the terminal, which must be disposed next. */
  dispose: () => void
}

type FoldEntry = {
  fold: TerminalFold
  toggle: IDecoration | undefined
  /** Expanded by the user or by find: automatic folding leaves it alone. */
  pinnedOpen: boolean
}

// Cards scroll past in one commit at most this tall; older rows were scanned while on screen.
const SCAN_ROWS = 400

const foldingByTerminal = new WeakMap<Terminal, TerminalOutputFolding>()

export function getTerminalOutputFolding(terminal: Terminal): TerminalOutputFolding | undefined {
  return foldingByTerminal.get(terminal)
}

/** Folds the output of finished Devin tool cards. Null without Orca's patched xterm. */
export function attachTerminalOutputFolding(
  terminal: Terminal,
  initialSettings: TerminalOutputFoldingSettings
): TerminalOutputFolding | null {
  if (!hasTerminalFoldApi(terminal)) {
    return null
  }
  let settings = initialSettings
  let isDevin = (): boolean => false
  const entries = new Set<FoldEntry>()
  let scannedAt = ''

  const viewportShows = (fold: TerminalFold): boolean => {
    const buffer = terminal.buffer.normal
    if (buffer.viewportY >= buffer.baseY) {
      return false
    }
    const start = fold.marker.line + 1
    const end = start + fold.lineCount - fold.hiddenLineCount
    return start < buffer.viewportY + terminal.rows && end > buffer.viewportY
  }

  // Expanding fires onScroll synchronously, so mark the entry before touching the fold.
  const toggle = (entry: FoldEntry): void => {
    entry.pinnedOpen = entry.fold.isCollapsed
    if (entry.pinnedOpen) {
      entry.fold.expand()
    } else {
      entry.fold.collapse()
    }
  }

  const addToggle = (entry: FoldEntry): void => {
    entry.toggle?.dispose()
    entry.toggle = registerTerminalOutputFoldToggle(terminal, entry.fold, () => toggle(entry))
  }

  const register = (header: number, footer: number): void => {
    const buffer = terminal.buffer.normal
    const cursor = buffer.baseY + buffer.cursorY
    const headerMarker = terminal.registerMarker(header - cursor)
    const footerMarker = terminal.registerMarker(footer - cursor)
    // Devin commits finished cards above its live region and never rewrites them in place.
    const fold = terminal.registerFold(headerMarker, footerMarker, { screen: true })
    headerMarker.dispose()
    footerMarker.dispose()
    if (!fold) {
      return
    }
    const entry: FoldEntry = { fold, toggle: undefined, pinnedOpen: false }
    entries.add(entry)
    addToggle(entry)
    fold.onDispose(() => {
      entries.delete(entry)
      entry.toggle?.dispose()
    })
    if (settings.autoCollapse && !viewportShows(fold)) {
      fold.collapse()
    }
  }

  const scan = (): void => {
    const buffer = terminal.buffer.normal
    if (!settings.enabled || terminal.buffer.active !== buffer || !isDevin()) {
      return
    }
    // Spinner frames repaint in place; only a commit moves the cursor line or grows the buffer.
    const at = `${buffer.length}:${buffer.baseY + buffer.cursorY}`
    if (at === scannedAt) {
      return
    }
    scannedAt = at
    const boxTop = findDevinInputBoxTop(buffer)
    if (boxTop === null) {
      return
    }
    const folded = new Set([...entries].map((entry) => entry.fold.marker.line))
    for (const card of findDevinToolCards(buffer, Math.max(0, boxTop - SCAN_ROWS), boxTop)) {
      if (card.footer - card.header - 1 >= MIN_FOLDED_OUTPUT_LINES && !folded.has(card.header)) {
        register(card.header, card.footer)
      }
    }
  }

  let toggleCols = terminal.cols
  const listeners: IDisposable[] = [
    terminal.onWriteParsed(scan),
    terminal.onResize(({ cols }) => {
      // Toggle columns are fixed at registration; place them again for the new width.
      if (cols !== toggleCols) {
        toggleCols = cols
        entries.forEach(addToggle)
      }
    })
  ]

  const folding: TerminalOutputFolding = {
    update(next) {
      const previous = settings
      settings = next
      if (!next.enabled) {
        // Disposing a fold puts its hidden lines back.
        ;[...entries].forEach((entry) => entry.fold.dispose())
        scannedAt = ''
        return
      }
      if (next.autoCollapse && !previous.autoCollapse) {
        for (const entry of entries) {
          if (!entry.pinnedOpen && !viewportShows(entry.fold)) {
            entry.fold.collapse()
          }
        }
      }
      scan()
    },
    setDevinCheck(check) {
      isDevin = check
      scannedAt = ''
    },
    expandMatching(matches) {
      let expanded = 0
      for (const entry of entries) {
        if (entry.fold.isCollapsed && entry.fold.translateHiddenLines().some(matches)) {
          entry.pinnedOpen = true
          entry.fold.expand()
          expanded += 1
        }
      }
      return expanded
    },
    dispose() {
      listeners.forEach((listener) => listener.dispose())
      entries.forEach((entry) => entry.toggle?.dispose())
      entries.clear()
      foldingByTerminal.delete(terminal)
    }
  }
  foldingByTerminal.set(terminal, folding)
  return folding
}
