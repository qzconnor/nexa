import { computed, watchEffect } from 'vue'
import { supportsMaterial } from '@/lib/platform'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { applyTheme } from '@/themes/apply'

/** Applies the selected theme to the document and the native caption buttons. */
export function useThemeSync() {
  const store = useSettingsStore(null)
  const themes = useThemesStore()
  const theme = computed(() => themes.find(store.settings.appearance.theme))

  watchEffect(() => {
    const appearance = store.settings.appearance
    applyTheme(theme.value, appearance, supportsMaterial && appearance.material !== 'none')
  })

  watchEffect(() => {
    void window.api.window.setTitleBarColors({ color: '#00000000', symbolColor: theme.value.colors.foreground, dark: theme.value.mode === 'dark' })
  })

  return { theme }
}
