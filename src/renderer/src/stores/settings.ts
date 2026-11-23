import { defineStore } from 'pinia'
import { ref } from 'vue'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, DeepPartial } from '@shared/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(defaultSettings())

  async function load(): Promise<void> {
    settings.value = await window.api.settings.get()
    window.api.settings.onChanged((next) => (settings.value = next))
  }

  async function update(patch: DeepPartial<AppSettings>): Promise<void> {
    // Plain data only: reactive proxies can't go over IPC.
    settings.value = await window.api.settings.update(JSON.parse(JSON.stringify(patch)) as DeepPartial<AppSettings>)
  }

  return { settings, load, update }
})
