import { computed, ref } from 'vue'
import { defaultSettings } from '@shared/defaults'
import type { AppearanceSettings, AppSettings, DeepPartial } from '@shared/types'
import { apiOf, scopedStore } from './device'
import { useKeptHereStore } from './kept-here'

/** The settings of a device (`scopedStore`): this one's, or those of another one it controls. */
export const useSettingsStore = scopedStore('settings', (device) => {
  const api = apiOf(device)
  /** As the device has them. */
  const own = ref<AppSettings>(defaultSettings())
  let listening = false
  /** Appearance values shown before they are saved (`previewAppearance`), by key. */
  const preview = ref<Partial<AppearanceSettings>>({})

  /**
   * As they count here: another device's with this one's look, and with what this one doesn't share
   * with it (`useKeptHereStore`), with the appearance being previewed.
   */
  const settings = computed(() => {
    const base = device ? useKeptHereStore(device).settingsView(own.value) : own.value
    return Object.keys(preview.value).length ? { ...base, appearance: { ...base.appearance, ...preview.value } } : base
  })

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

  /**
   * Shows appearance values at once without saving them: a slider applies every step while it is
   * dragged, and saves (`update`) once it rests. Saving each step wrote `settings.json` and told every
   * window, and the slider only moved on once that was done.
   */
  function previewAppearance(patch: Partial<AppearanceSettings>): void {
    preview.value = { ...preview.value, ...patch }
  }

  /** Ends the preview of these values once they are saved; a newer one stays. */
  function endPreview(saved: Partial<AppearanceSettings>): void {
    const left = Object.entries(preview.value).filter(([key, value]) => saved[key as keyof AppearanceSettings] !== value)
    preview.value = Object.fromEntries(left) as Partial<AppearanceSettings>
  }

  return { settings, load, update, previewAppearance, endPreview }
})
