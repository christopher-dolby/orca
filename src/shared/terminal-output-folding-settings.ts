/** Absent fields mean folding on and automatic folding off, including for older profiles. */
export type TerminalOutputFoldingGlobalSettings = {
  terminalOutputFolding?: boolean
  terminalOutputAutoFold?: boolean
}

export type TerminalOutputFoldingSettings = {
  enabled: boolean
  /** Fold finished blocks as they scroll into the scrollback, without a click. */
  autoCollapse: boolean
}

export function resolveTerminalOutputFoldingSettings(
  settings: TerminalOutputFoldingGlobalSettings | null | undefined
): TerminalOutputFoldingSettings {
  return {
    enabled: settings?.terminalOutputFolding !== false,
    autoCollapse: settings?.terminalOutputAutoFold === true
  }
}
