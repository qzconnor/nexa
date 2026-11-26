import { runsWhenOpened } from '@shared/executables'
import { toast } from 'vue-sonner'
import { attempt } from '@/lib/errors'
import { useDevice } from '@/stores/device'
import { useUiStore } from '@/stores/ui'

/**
 * Opens a file with its default program, like a double-click in the Explorer. One that would run
 * instead (a program, or a script such as `.js`, `.bat` or `.vbs`, which Windows runs rather than
 * shows) only after asking: Claude, a download or a cloned repository may have put it there.
 */
export function useOpenFile(): (path: string) => Promise<void> {
  const ui = useUiStore()
  const device = useDevice()
  return async (path) => {
    // A file of another device (Remote Control) is there, not on this one.
    if (device) {
      toast('Die Datei liegt auf dem anderen Gerät', { description: path })
      return
    }
    const name = path.split(/[\\/]/).pop() || path
    if (runsWhenOpened(name, window.api.platform)) {
      const ok = await ui.confirm({
        title: `„${name}“ ausführen?`,
        description: 'Die Datei ist ein Programm oder Skript: Ihr Standardprogramm führt sie aus, statt sie zu zeigen. Führe sie nur aus, wenn du weißt, was sie tut.',
        confirmText: 'Ausführen',
        destructive: true,
        warning: true,
      })
      if (!ok) return
    }
    await attempt(() => window.api.app.openPath(path), 'Datei konnte nicht geöffnet werden')
  }
}
