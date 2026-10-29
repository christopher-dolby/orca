import type { IDecoration, Terminal } from '@xterm/xterm'
import { translate } from '@/i18n/i18n'
import type { TerminalFold } from './terminal-fold-api'

// Fewer lines than this take about as much room folded as expanded.
export const MIN_FOLDED_OUTPUT_LINES = 3

// Room for "› 99,999 lines" in the toggle's smaller font.
const TOGGLE_CELLS = 14

// lucide chevron-right / chevron-down paths; xterm decorations are plain DOM, so no React icon.
const CHEVRON_RIGHT_PATH = 'm9 18 6-6-6-6'
const CHEVRON_DOWN_PATH = 'm6 9 6 6 6-6'

type ToggleState = 'collapsed' | 'expanded' | 'hidden'

function resolveToggleState(fold: TerminalFold): ToggleState {
  if (fold.isCollapsed) {
    return 'collapsed'
  }
  return fold.lineCount >= MIN_FOLDED_OUTPUT_LINES ? 'expanded' : 'hidden'
}

function createChevron(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'path'))
  return svg
}

function createToggleButton(onToggle: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'terminal-output-fold-toggle'
  button.append(createChevron(), document.createElement('span'))
  // Keep xterm from starting a selection or sending a mouse report for the click.
  button.addEventListener('mousedown', (event) => {
    event.stopPropagation()
    event.preventDefault()
  })
  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onToggle()
  })
  return button
}

function applyToggleState(button: HTMLButtonElement, state: ToggleState, fold: TerminalFold): void {
  button.hidden = state === 'hidden'
  button.dataset.state = state
  if (state === 'hidden') {
    return
  }
  const count = fold.hiddenLineCount
  const label =
    state === 'collapsed'
      ? translate('components.terminalOutputFold.expand', 'Show {{count}} hidden lines', {
          count
        })
      : translate('components.terminalOutputFold.collapse', 'Fold output')
  button.setAttribute('aria-expanded', String(state === 'expanded'))
  button.setAttribute('aria-label', label)
  button.title = label
  button
    .querySelector('path')
    ?.setAttribute('d', state === 'collapsed' ? CHEVRON_RIGHT_PATH : CHEVRON_DOWN_PATH)
  const text = button.querySelector('span')
  if (text) {
    text.textContent =
      state === 'collapsed'
        ? translate('components.terminalOutputFold.hiddenLines', '{{count}} lines', { count })
        : ''
  }
}

/** Puts the fold's toggle just after its header text, or over the row's right edge when the row is full. */
export function registerTerminalOutputFoldToggle(
  terminal: Terminal,
  fold: TerminalFold,
  onToggle: () => void
): IDecoration | undefined {
  const headerText = terminal.buffer.normal.getLine(fold.marker.line)?.translateToString(true) ?? ''
  const width = Math.min(TOGGLE_CELLS, terminal.cols)
  const x = Math.max(0, Math.min(headerText.length + 1, terminal.cols - width))
  const decoration = terminal.registerDecoration({ marker: fold.marker, x, width, layer: 'top' })
  if (!decoration) {
    return undefined
  }
  let button: HTMLButtonElement | null = null
  let renderedKey = ''
  decoration.onRender((element) => {
    if (!button) {
      element.classList.add('terminal-output-fold')
      button = createToggleButton(onToggle)
      element.appendChild(button)
    }
    const state = resolveToggleState(fold)
    // xterm fires onRender every frame the row is visible; touch the DOM only on change.
    const key = `${state}:${fold.hiddenLineCount}`
    if (key !== renderedKey) {
      renderedKey = key
      applyToggleState(button, state, fold)
    }
  })
  return decoration
}
