import type { IBuffer } from '@xterm/xterm'

/** A finished Devin tool card: its output lies between the `header` row and the footer row. */
export type DevinToolCard = { header: number; footer: number }

// Devin draws `⏺ Title`, then `│ ` body rows (the first often `│ $ command`), then a `└ status` footer.
const TITLE = /^\s?[⏺●]\s+\S/
const COMMAND = /^\s?│\s+\$\s/
const BODY = /^\s?│/
const FOOTER = /^\s?└/
// Top border of Devin's input box; its spinner and the box are the only rows it repaints.
const INPUT_BOX_BORDER = /^─{8,}/
const LIVE_REGION_ROWS = 12

function rowText(buffer: IBuffer, row: number): string {
  return buffer.getLine(row)?.translateToString(true) ?? ''
}

/** The input box's top border, or null when the screen is not Devin's prompt (a dialog, a shell). */
export function findDevinInputBoxTop(buffer: IBuffer): number | null {
  const cursor = buffer.baseY + buffer.cursorY
  for (let row = cursor; row >= Math.max(0, cursor - LIVE_REGION_ROWS); row--) {
    if (INPUT_BOX_BORDER.test(rowText(buffer, row))) {
      return row
    }
  }
  return null
}

/** Finished cards that start in [from, to). A card still running has no footer yet, so it is skipped. */
export function findDevinToolCards(buffer: IBuffer, from: number, to: number): DevinToolCard[] {
  const cards: DevinToolCard[] = []
  for (let row = from; row < to; row++) {
    if (!TITLE.test(rowText(buffer, row))) {
      continue
    }
    // Keep the command visible next to the title; fold only what it printed.
    const header = row + 1 < to && COMMAND.test(rowText(buffer, row + 1)) ? row + 1 : row
    let footer = row + 1
    while (
      footer < to &&
      (BODY.test(rowText(buffer, footer)) || buffer.getLine(footer)?.isWrapped === true)
    ) {
      footer += 1
    }
    if (footer < to && FOOTER.test(rowText(buffer, footer))) {
      cards.push({ header, footer })
      row = footer
    }
  }
  return cards
}
