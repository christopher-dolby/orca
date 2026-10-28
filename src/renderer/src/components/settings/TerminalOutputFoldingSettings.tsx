import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveTerminalOutputFoldingSettings } from '../../../../shared/terminal-output-folding-settings'
import { SettingsSwitchRow } from './SettingsFormControls'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'

type TerminalOutputFoldingSettingsProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const FOLD_KEYWORDS = ['fold', 'collapse', 'output', 'command', 'agent', 'scrollback', 'osc 133']

export function TerminalOutputFoldingSettings({
  settings,
  updateSettings
}: TerminalOutputFoldingSettingsProps): React.JSX.Element {
  const folding = resolveTerminalOutputFoldingSettings(settings)
  const foldingTitle = translate(
    'components.settings.TerminalInteraction.outputFolding',
    'Output Folding'
  )
  const foldingDescription = translate(
    'components.settings.TerminalInteraction.outputFoldingDescription',
    'Show a toggle on finished commands and agent turns in the scrollback to fold their output.'
  )
  const autoFoldTitle = translate(
    'components.settings.TerminalInteraction.outputAutoFold',
    'Fold Output Automatically'
  )
  const autoFoldDescription = translate(
    'components.settings.TerminalInteraction.outputAutoFoldDescription',
    'Fold finished output as it scrolls off the screen. Click the toggle to expand it again.'
  )
  return (
    <>
      <SearchableSetting
        title={foldingTitle}
        description={foldingDescription}
        keywords={FOLD_KEYWORDS}
      >
        <SettingsSwitchRow
          label={foldingTitle}
          description={foldingDescription}
          checked={folding.enabled}
          onChange={() => updateSettings({ terminalOutputFolding: !folding.enabled })}
        />
      </SearchableSetting>

      <SearchableSetting
        title={autoFoldTitle}
        description={autoFoldDescription}
        keywords={[...FOLD_KEYWORDS, 'automatic']}
      >
        <SettingsSwitchRow
          label={autoFoldTitle}
          description={autoFoldDescription}
          checked={folding.enabled && folding.autoCollapse}
          disabled={!folding.enabled}
          onChange={() => updateSettings({ terminalOutputAutoFold: !folding.autoCollapse })}
        />
      </SearchableSetting>
    </>
  )
}
