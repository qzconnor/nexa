import { systemAccountId } from './accounts'
import { DEFAULT_THEME_ID } from './themes/builtin'
import type { AppSettings, ProviderSettings } from './types'

const provider = (): ProviderSettings => ({ enabled: true, path: '', model: '', effort: '', extraArgs: [] })

/** Settings of a fresh install; the folder for new projects is filled in by the main process. */
export function defaultSettings(): AppSettings {
  return {
    appearance: {
      theme: DEFAULT_THEME_ID,
      material: 'mica',
      keepMaterialActive: true,
      surfaceOpacity: 72,
      radius: 0.625,
      uiFontSize: 14,
      chatWidth: 'normal',
    },
    defaults: {
      provider: 'claude',
      permissionMode: 'ask',
      accounts: { claude: systemAccountId('claude'), codex: systemAccountId('codex') },
      projectsFolder: '',
    },
    claude: provider(),
    codex: provider(),
    chat: {
      showThinking: true,
      collapseTools: true,
      enterSends: true,
    },
    tools: {
      renderTools: true,
      browserTools: true,
      noClaudeInChrome: true,
    },
    api: {
      enabled: false,
      port: 47615,
    },
    // Existing installs lack it too, so they see the setup once after the update that brought it.
    setup: { done: false },
  }
}
