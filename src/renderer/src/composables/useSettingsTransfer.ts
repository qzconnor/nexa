import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { attempt } from '@/lib/errors'
import { microphonesOf } from '@/lib/microphones'
import { skippedNames, withoutMissingMicrophone } from '@/lib/setting-changes'
import { useUiStore } from '@/stores/ui'

/** One file dialog at a time, whether from the settings or the quick open. */
const busy = ref(false)

/**
 * Export and import of the settings, e.g. to take them to another computer (Einstellungen ›
 * Allgemein, quick open). The import first shows what the file would change (SettingsImportDialog).
 */
export function useSettingsTransfer() {
  const ui = useUiStore()

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      await action()
    } finally {
      busy.value = false
    }
  }

  function exportSettings(): Promise<void> {
    return run(async () => {
      const file = await attempt(() => window.api.settings.exportToFile(), 'Export fehlgeschlagen')
      if (file) toast.success('Einstellungen exportiert', { description: file })
    })
  }

  function importSettings(): Promise<void> {
    return run(async () => {
      const preview = await attempt(() => window.api.settings.previewImport(), 'Import fehlgeschlagen')
      if (!preview) return
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
      const next = withoutMissingMicrophone(preview, microphonesOf(devices).map((microphone) => microphone.label))
      if (next.changes.length === 0 && next.themes.length === 0) {
        const { missing, invalid } = skippedNames(next.skipped, window.api.platform)
        const left = [...missing, ...invalid].join(', ')
        toast.info('Nichts zu übernehmen', {
          description: left ? `Was sich ändern würde, passt nicht auf diesen Computer: ${left}` : 'Die Datei hat dieselben Einstellungen wie jetzt.',
        })
        return
      }
      ui.settingsImport = next
    })
  }

  return { busy, exportSettings, importSettings }
}
