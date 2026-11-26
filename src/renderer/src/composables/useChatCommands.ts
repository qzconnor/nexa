import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import type { ChatItem, ToolItem } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { SessionMeta, SessionUpdateInput } from '@shared/types'
import { dirFromArg, matchEffort, matchModel, type AppCommand } from '@/lib/chat-commands'
import { effortLabel } from '@/lib/effort'
import { attempt } from '@/lib/errors'
import { runningShells, startShellId } from '@/lib/shells'
import { useAccountsStore } from '@/stores/accounts'
import { useAppStore } from '@/stores/app'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useFileTreeStore } from '@/stores/file-tree'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'
import { useChatActions } from './useChatActions'

/** What the commands open in the composer (Composer.vue exposes it). */
export interface ComposerHandle {
  /** Model, effort, Ultracode and permissions behind the gear. */
  openSettings(): void
  /** The „+“ menu at its connectors. */
  openConnectors(): void
  /** The list of commands, as if `/` was typed. */
  showCommands(): void
  /** The folder picker of „Ordner hinzufügen“. */
  addFolder(): void
}

/** The permission mode a chat had before `/plan`, to go back to. */
const beforePlan = new Map<string, SessionMeta['permissionMode']>()

/**
 * Runs Nexa's own commands for the open chat (lib/chat-commands.ts): what the CLI would show in its
 * terminal, Nexa shows in its own places.
 */
export function useChatCommands(options: {
  meta: Readonly<Ref<SessionMeta | null>>
  items: Readonly<Ref<readonly ChatItem[]>>
  cwd: Readonly<Ref<string | null>>
  composer: Ref<ComposerHandle | null>
  /** The title in the header, to type over. */
  startRename: () => void
  /** `/status`'s dialog. */
  showStatus: () => void
}) {
  const sessions = useSessionsStore()
  const accounts = useAccountsStore()
  const providers = useProvidersStore()
  const fileTree = useFileTreeStore()
  const app = useAppStore()
  const ui = useUiStore()
  const startCommands = useStartCommandsStore()
  const chat = useChatActions()
  /** A chat of another device: its calls go there; what needs this device's dialogs doesn't. */
  const device = useDevice()
  const api = useDeviceApi()

  function update(meta: SessionMeta, patch: SessionUpdateInput, failed = 'Ändern fehlgeschlagen'): Promise<void | undefined> {
    return attempt(() => sessions.update(meta.id, patch), failed)
  }

  /** A new chat with the same folder and settings, this one kept as it is. */
  async function newChat(meta: SessionMeta): Promise<void> {
    const created = await attempt(
      () =>
        sessions.create({
          projectId: meta.projectId,
          cwd: meta.cwd,
          provider: meta.provider,
          account: accounts.sessionAccount(meta),
          model: meta.model,
          effort: meta.effort,
          ultracode: meta.ultracode,
          permissionMode: meta.permissionMode,
        }),
      'Neuer Chat ging nicht',
    )
    if (created && meta.dirs?.length) await update(created, { dirs: meta.dirs })
  }

  /** As Claude Code's `/branch [name]`: a new chat from here, this one kept. */
  async function fork(meta: SessionMeta, name: string): Promise<void> {
    const forked = await chat.fork(meta.id)
    const title = name.replace(/\s+/g, ' ')
    if (forked && title) await update(forked, { title })
  }

  function diff(meta: SessionMeta): void {
    const target = fileTree.targetOf(meta.id)
    if (!target) {
      toast('Keine Änderungen zu zeigen', { description: 'Der Chat hat keinen Ordner.' })
      return
    }
    fileTree.showDiff(target, '')
  }

  async function setModel(meta: SessionMeta, query: string): Promise<void> {
    const models = providers.models[meta.provider]?.length ? providers.models[meta.provider]! : await providers.loadModels(meta.provider)
    const model = matchModel(models, query)
    if (!model) {
      toast.error(`Kein Modell „${query}“`, { description: `${PROVIDERS[meta.provider].name} kennt: ${models.map((m) => m.label).join(', ') || 'keine'}` })
      return
    }
    // An effort the new model doesn't know goes back to its default (as the gear does it).
    const effort = meta.effort && model.efforts && !model.efforts.includes(meta.effort) ? '' : undefined
    await update(meta, { model: model.id, ...(effort !== undefined ? { effort } : {}) })
    toast(`Modell: ${model.label}`)
  }

  async function setEffort(meta: SessionMeta, query: string): Promise<void> {
    const models = providers.models[meta.provider] ?? []
    const model = models.find((m) => m.id === meta.model) ?? models.find((m) => m.isDefault)
    const levels = model?.efforts ?? []
    const effort = matchEffort(levels, query)
    if (effort === null) {
      const known = levels.map((l) => `${l} (${effortLabel(l)})`).join(', ')
      toast.error(`Keine Stufe „${query}“`, { description: known ? `Dieses Modell kennt: ${known}` : 'Dieses Modell hat keinen Denkaufwand.' })
      return
    }
    await update(meta, { effort })
    toast(`Denkaufwand: ${effort ? effortLabel(effort) : 'Standard'}`)
  }

  async function togglePlan(meta: SessionMeta): Promise<void> {
    if (meta.permissionMode === 'plan') {
      const back = beforePlan.get(meta.id) ?? 'ask'
      beforePlan.delete(meta.id)
      await update(meta, { permissionMode: back })
      toast(`Freigaben: ${PERMISSION_MODES[back].label}`)
      return
    }
    beforePlan.set(meta.id, meta.permissionMode)
    await update(meta, { permissionMode: 'plan' })
    toast('Planen ist an', { description: 'Der Agent liest nur und schlägt einen Plan vor. /plan schaltet es wieder aus.' })
  }

  async function addDir(meta: SessionMeta, arg: string): Promise<void> {
    if (!arg && device) {
      toast('Den Ordner als Pfad angeben', { description: 'Der Chat läuft auf einem anderen Gerät: /add-dir mit dem Pfad dort.' })
      return
    }
    if (!arg) {
      options.composer.value?.addFolder()
      return
    }
    const cwd = options.cwd.value
    if (!cwd) return
    const dir = dirFromArg(arg, cwd, app.info?.homeDir)
    await update(meta, { dirs: [...(meta.dirs ?? []), dir] }, 'Ordner nicht hinzugefügt')
  }

  /** The shells' panel: one that runs (a start command of the project too), else the last command. */
  function showTasks(): void {
    const items = options.items.value
    const start = startCommands.runningIn(options.meta.value?.projectId)[0]
    const shown =
      runningShells(items)[0] ??
      (start ? undefined : items.findLast((i): i is ToolItem => i.kind === 'tool' && (i.tool === 'bash' || i.name === 'commandExecution')))
    if (!shown && !start) {
      toast('Keine Shells in diesem Chat')
      return
    }
    ui.shellId = shown ? shown.id : startShellId(start!.id)
  }

  async function run(command: AppCommand, args: string): Promise<void> {
    const meta = options.meta.value
    if (!meta) return
    const composer = options.composer.value
    switch (command.id) {
      case 'clear':
        // In the same chat, unlike the CLI's new session: its name, pin and place stay.
        await attempt(() => sessions.clear(meta.id), 'Leeren ging nicht')
        return
      case 'new':
        return newChat(meta)
      case 'fork':
        return fork(meta, args)
      case 'compact':
        await attempt(() => api.sessions.compact(meta.id), 'Zusammenfassen ging nicht')
        return
      case 'diff':
        return diff(meta)
      case 'rename':
        if (args) await update(meta, { title: args.replace(/\s+/g, ' ') })
        else options.startRename()
        return
      case 'model':
        return args ? setModel(meta, args) : composer?.openSettings()
      case 'effort':
        return args ? setEffort(meta, args) : composer?.openSettings()
      case 'plan':
        return togglePlan(meta)
      case 'permissions':
        return composer?.openSettings()
      case 'mcp':
        return composer?.openConnectors()
      case 'add-dir':
        return addDir(meta, args)
      case 'copy':
        return chat.copyLastAnswer(meta.id)
      case 'export':
        if (device) return void toast('Nur am Gerät selbst', { description: 'Der Chat läuft auf einem anderen Gerät: dort lässt er sich speichern.' })
        return chat.exportMarkdown(meta.id)
      case 'status':
        return options.showStatus()
      case 'resume':
        return ui.openPalette('')
      case 'tasks':
        return showTasks()
      case 'usage':
        return ui.openSettings('usage')
      case 'login':
        return ui.openSettings('accounts')
      case 'settings':
        return ui.openSettings()
      case 'theme':
        return ui.openSettings('appearance')
      case 'help':
        return composer?.showCommands()
      case 'exit':
        return chat.end(meta)
    }
  }

  return { run }
}
