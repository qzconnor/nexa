import { ref } from 'vue'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, DeepPartial } from '@shared/types'
import { apiOf, scopedStore } from './device'

/** The settings of a device (`scopedStore`): this one's, or those of another one it controls. */
export const useSettingsStore = scopedStore('settings', (device) => {
  const api = apiOf(device)
  const settings = ref<AppSettings>(defaultSettings())
  let listening = false

  /** Again after another device lost track (Remote Control): its events start once. */
  async function load(): Promise<void> {
    settings.value = await api.settings.get()
    if (listening) return
    listening = true
    api.settings.onChanged((next) => (settings.value = next))
  }

  async function update(patch: DeepPartial<AppSettings>): Promise<void> {
    // Plain data only: reactive proxies can't go over IPC.
    settings.value = await api.settings.update(JSON.parse(JSON.stringify(patch)) as DeepPartial<AppSettings>)
  }

  return { settings, load, update }
})
