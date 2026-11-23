import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppInfo, WindowState } from '@shared/types'

export const useAppStore = defineStore('app', () => {
  const info = ref<AppInfo | null>(null)
  const windowState = ref<WindowState>({ maximized: false, focused: true, fullscreen: false })

  async function load(): Promise<void> {
    const [nextInfo, state] = await Promise.all([window.api.app.info(), window.api.window.state()])
    info.value = nextInfo
    windowState.value = state
    window.api.window.onState((next) => (windowState.value = next))
  }

  return { info, windowState, load }
})
