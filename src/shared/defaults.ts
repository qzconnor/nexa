import { systemAccountId } from './accounts'
import { DEFAULT_THEME_ID } from './themes/builtin'
import type { AppSettings, ProviderSettings } from './types'
import { DEFAULT_ZOOM } from './zoom'

const provider = (): ProviderSettings => ({ enabled: true, path: '', model: '', effort: '', extraArgs: [] })

/** Settings of a fresh install; the folder for new projects is filled in by the main process. */
export function defaultSettings(): AppSettings {
  return {
    general: {
      runInTray: false,
      launchAtLogin: false,
    },
    appearance: {
      theme: DEFAULT_THEME_ID,
      material: 'mica',
      keepMaterialActive: true,
      surfaceOpacity: 72,
      radius: 0.625,
      zoom: DEFAULT_ZOOM,
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
      collapseDiffs: false,
      enterSends: true,
      autoTitles: true,
      deleteCliConversations: true,
      shell: 'powershell',
    },
    tools: {
      renderTools: true,
      browserTools: true,
      noClaudeInChrome: true,
    },
    notifications: {
      enabled: true,
      onDone: true,
      // Short answers come while one watches anyway; long work is what one turns away from.
      minBusySeconds: 20,
      onInput: true,
      onLimit: true,
      onNearLimit: true,
      nearLimitPercent: 80,
      onLoginLost: true,
      when: 'background',
      preview: true,
      sound: true,
      flashTaskbar: true,
    },
    api: {
      enabled: false,
      port: 47615,
    },
    // Existing installs lack it too, so they see the setup once after the update that brought it.
    setup: { done: false },
  }
}
