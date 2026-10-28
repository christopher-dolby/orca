import type { IDisposable, IEvent, IMarker, Terminal } from '@xterm/xterm'

/** A fold from Orca's @xterm/xterm patch: it hides scrollback lines behind the header line at `marker`. */
export type TerminalFold = IDisposable & {
  readonly marker: IMarker
  readonly isDisposed: boolean
  readonly isCollapsed: boolean
  readonly hiddenLineCount: number
  /** The lines the fold covers, hidden or not. */
  readonly lineCount: number
  readonly onDispose: IEvent<void>
  /** Hides the part of the range already in the scrollback; returns the number newly hidden. */
  collapse(): number
  expand(): void
  /** Hidden lines as text, wrapped rows joined into their logical lines. */
  translateHiddenLines(): string[]
}

type TerminalFoldHost = {
  /** Folds the lines after `marker` up to, not including, `endMarker`; both must be normal-buffer markers. */
  registerFold(marker: IMarker, endMarker: IMarker): TerminalFold | undefined
  withFoldsExpanded<T>(callback: () => T): T
}

// The patch adds these members without typings (it cannot touch typings/), so probe them at runtime.
export function hasTerminalFoldApi(terminal: Terminal): terminal is Terminal & TerminalFoldHost {
  return (
    'registerFold' in terminal &&
    typeof terminal.registerFold === 'function' &&
    'withFoldsExpanded' in terminal &&
    typeof terminal.withFoldsExpanded === 'function'
  )
}

/** Runs `read` with every folded line back in the buffer, so serializers never drop hidden output. */
export function withTerminalFoldsExpanded<T>(terminal: Terminal, read: () => T): T {
  return hasTerminalFoldApi(terminal) ? terminal.withFoldsExpanded(read) : read()
}
