import { ImportEvent, ImportInvoke } from '@shared/import-ipc'
import { isPlainObject } from '@shared/utils'
import { broadcast, handle } from '../ipc'
import type { ClaudeManagerImport } from './claude-manager'

/** The window's side of taking over from the Claude Manager. */
export function registerImportIpc(importer: ClaudeManagerImport): void {
  handle(ImportInvoke.detect, () => importer.detect())
  handle(ImportInvoke.scan, () => importer.scan())
  handle(ImportInvoke.run, (_e, input: unknown) => {
    const groups = isPlainObject(input) && Array.isArray(input.groups) ? input.groups.filter((g): g is string => typeof g === 'string') : null
    if (!groups) throw new Error('Ungültiger Parameter: groups')
    return importer.run({ groups })
  })
  importer.on('progress', (progress) => broadcast(ImportEvent.progress, progress))
}
