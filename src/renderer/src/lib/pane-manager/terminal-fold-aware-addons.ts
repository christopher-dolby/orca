import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import { SerializeAddon, type ISerializeOptions } from '@xterm/addon-serialize'
import type { Terminal } from '@xterm/xterm'
import { withTerminalFoldsExpanded } from './terminal-fold-api'
import { getTerminalOutputFolding } from './terminal-output-folding'

/** Serializes folded output too, so snapshots, session restore, mobile and Copy Context keep it. */
export class FoldAwareSerializeAddon extends SerializeAddon {
  #terminal: Terminal | undefined

  override activate(terminal: Terminal): void {
    this.#terminal = terminal
    super.activate(terminal)
  }

  override serialize(options?: ISerializeOptions): string {
    const terminal = this.#terminal
    // Folds only ever hide scrollback lines, which a screen-only snapshot leaves out anyway.
    if (!terminal || options?.scrollback === 0) {
      return super.serialize(options)
    }
    return withTerminalFoldsExpanded(terminal, () => super.serialize(options))
  }
}

function createHiddenLineMatcher(
  term: string,
  options: ISearchOptions | undefined
): ((line: string) => boolean) | null {
  if (options?.regex) {
    try {
      const pattern = new RegExp(term, options.caseSensitive ? '' : 'i')
      return (line) => pattern.test(line)
    } catch {
      return null
    }
  }
  if (options?.caseSensitive) {
    return (line) => line.includes(term)
  }
  const needle = term.toLowerCase()
  return (line) => line.toLowerCase().includes(needle)
}

/**
 * Expands folds that hold matches, which the addon cannot see while hidden. Explicit navigation
 * (Enter, next/previous) expands every matching fold; typing only does so when nothing visible matches.
 */
export class FoldAwareSearchAddon extends SearchAddon {
  #terminal: Terminal | undefined

  override activate(terminal: Terminal): void {
    this.#terminal = terminal
    super.activate(terminal)
  }

  override findNext(term: string, options?: ISearchOptions): boolean {
    return this.#findRevealingFolds(term, options, () => super.findNext(term, options))
  }

  override findPrevious(term: string, options?: ISearchOptions): boolean {
    return this.#findRevealingFolds(term, options, () => super.findPrevious(term, options))
  }

  #findRevealingFolds(
    term: string,
    options: ISearchOptions | undefined,
    find: () => boolean
  ): boolean {
    if (!options?.incremental) {
      this.#expandFoldsMatching(term, options)
      return find()
    }
    return find() || (this.#expandFoldsMatching(term, options) && find())
  }

  #expandFoldsMatching(term: string, options: ISearchOptions | undefined): boolean {
    const folding = this.#terminal && getTerminalOutputFolding(this.#terminal)
    const matches = term ? createHiddenLineMatcher(term, options) : null
    return folding && matches ? folding.expandMatching(matches) > 0 : false
  }
}
