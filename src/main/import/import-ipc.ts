import { CliImportEvent, CliImportInvoke, ImportEvent, ImportInvoke, type ImportInput } from '@shared/import-ipc'
import { isPlainObject } from '@shared/utils'
import { broadcast, handle } from '../ipc'
import type { ClaudeManagerImport } from './claude-manager'
import type { CliSessionImport } from './cli-import'

function importInput(input: unknown): ImportInput {
  const groups = isPlainObject(input) && Array.isArray(input.groups) ? input.groups.filter((g): g is string => typeof g === 'string') : null
  if (!groups) throw new Error('Ungültiger Parameter: groups')
  const extras = isPlainObject(input) && Array.isArray(input.extras) ? input.extras.filter((e): e is string => typeof e === 'string') : []
  return { groups, extras }
}

/** The window's side of taking over from the Claude Manager and from the CLIs' own folders. */
export function registerImportIpc(importer: ClaudeManagerImport, cli: CliSessionImport): void {
  handle(ImportInvoke.detect, () => importer.detect())
  handle(ImportInvoke.scan, () => importer.scan())
  handle(ImportInvoke.run, (_e, input: unknown) => importer.run(importInput(input)))
  importer.on('progress', (progress) => broadcast(ImportEvent.progress, progress))

  handle(CliImportInvoke.scan, () => cli.scan())
  handle(CliImportInvoke.run, (_e, input: unknown) => cli.run(importInput(input)))
  cli.on('progress', (progress) => broadcast(CliImportEvent.progress, progress))
}
