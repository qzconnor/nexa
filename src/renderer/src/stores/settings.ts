import { computed, ref } from 'vue'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, DeepPartial } from '@shared/types'
import { apiOf, scopedStore } from './device'
import { useKeptHereStore } from './kept-here'

/** The settings of a device (`scopedStore`): this one's, or those of another one it controls. */
export const useSettingsStore = scopedStore('settings', (device) => {
  const api = apiOf(device)
  /** As the device has them. */
  const own = ref<AppSettings>(defaultSettings())
  let listening = false

  /**
   * As they count here: another device's with this one's look, and with what this one doesn't share
   * with it (`useKeptHereStore`).
   */
  const settings = computed(() => (device ? useKeptHereStore(device).settingsView(own.value) : own.value))

  /** Again after another device lost track (Remote Control): its events start once. */
  async function load(): Promise<void> {
    own.value = await api.settings.get()
    if (listening) return
    listening = true
    api.settings.onChanged((next) => (own.value = next))
  }

  async function update(patch: DeepPartial<AppSettings>): Promise<void> {
    // Another device's start page picks stay here unless they are shared (and allowed).
    if (device && useKeptHereStore(device).keepSettings(patch)) return
    // Plain data only: reactive proxies can't go over IPC.
    own.value = await api.settings.update(JSON.parse(JSON.stringify(patch)) as DeepPartial<AppSettings>)
  }

  return { settings, load, update }
})
