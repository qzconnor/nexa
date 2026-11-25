import { CliConfigEvent, CliConfigInvoke } from '@shared/cli-config'
import { broadcast, handle } from '../ipc'
import type { CliConfigService } from './cli-config-service'

/** The window's side of the CLIs' own settings; `CliConfigService` checks what comes in. */
export function registerCliConfigIpc(cliConfig: CliConfigService): void {
  handle(CliConfigInvoke.providers, () => cliConfig.providerIds())
  handle(CliConfigInvoke.read, (_e, target: unknown) => cliConfig.read(target))
  handle(CliConfigInvoke.saveMcp, (_e, target: unknown, server: unknown, previousName: unknown) => cliConfig.saveMcp(target, server, previousName))
  handle(CliConfigInvoke.removeMcp, (_e, target: unknown, name: unknown) => cliConfig.removeMcp(target, name))
  handle(CliConfigInvoke.savePermissions, (_e, target: unknown, values: unknown) => cliConfig.savePermissions(target, values))
  handle(CliConfigInvoke.saveHooks, (_e, target: unknown, save: unknown) => cliConfig.saveHooks(target, save))
  handle(CliConfigInvoke.trustHook, (_e, target: unknown, key: unknown, hash: unknown) => cliConfig.trustHook(target, key, hash))
  handle(CliConfigInvoke.overview, () => cliConfig.overview())
  handle(CliConfigInvoke.addGlobal, (_e, server: unknown) => cliConfig.addGlobal(server))
  handle(CliConfigInvoke.saveGlobal, (_e, server: unknown, previousName: unknown) => cliConfig.saveGlobal(server, previousName))
  handle(CliConfigInvoke.makeGlobal, (_e, name: unknown, source: unknown) => cliConfig.makeGlobal(name, source))
  handle(CliConfigInvoke.unglobal, (_e, name: unknown) => cliConfig.unglobal(name))
  handle(CliConfigInvoke.removeGlobal, (_e, name: unknown) => cliConfig.removeGlobal(name))
  handle(CliConfigInvoke.syncGlobal, (_e, name: unknown) => cliConfig.syncGlobal(name))
  cliConfig.on('changed', (target) => broadcast(CliConfigEvent.changed, target))
}
