import type { Terminal, IDisposable } from '@xterm/xterm'
import { createOsc133CommandFinishedScanner } from '../../../../shared/terminal-osc133-command-finished'
import { getTerminalOutputFolding } from '@/lib/pane-manager/terminal-output-folding'

type TerminalCommandLifecycleOptions = {
  onCommandFinished: (bestEffortExitCode: number | null) => void
  /** OSC 133;C — the shell exec'd a command; the pane's foreground changed. */
  onCommandStarted?: () => void
}

export function createTerminalCommandLifecycle(options: TerminalCommandLifecycleOptions): {
  handlePtyData: (data: string) => void
  attachXtermConsumer: (terminal: Terminal) => IDisposable
  dispose: () => void
} {
  // Shared parsing keeps local/SSH main-side facts identical; renderer parsing still serves remote-runtime and kill-switch-off PTYs.
  const scanner = createOsc133CommandFinishedScanner(options.onCommandFinished, () =>
    options.onCommandStarted?.()
  )
  const disposables: IDisposable[] = []

  return {
    handlePtyData: scanner.scan,
    attachXtermConsumer(terminal) {
      // Consume OSC 133 even without side-effect authority so integration markers never paint.
      // Folding marks lines here, while the parser still has the cursor on the marked line.
      const disposable = terminal.parser.registerOscHandler(133, (payload) => {
        getTerminalOutputFolding(terminal)?.handleOsc133(payload)
        return true
      })
      disposables.push(disposable)
      return disposable
    },
    dispose() {
      scanner.reset()
      for (const disposable of disposables.splice(0)) {
        disposable.dispose()
      }
    }
  }
}
