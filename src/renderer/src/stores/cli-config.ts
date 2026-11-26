import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import type {
  CliConfigSnapshot,
  CliConfigTarget,
  HooksSave,
  McpOverview,
  McpOverviewColumn,
  McpServerConfig,
  McpSyncResult,
  PermissionValue,
} from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { errorMessage } from '@/lib/errors'
import { useAccountsStore } from './accounts'
import { useProjectsStore } from './projects'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The tab at the top: every CLI at once (global MCP servers) or one CLI's files. */
export type CliConfigPage = 'all' | 'cli'
/** The tab below a CLI's bar. */
export type CliConfigSection = 'mcp' | 'permissions' | 'hooks'

/**
 * What Einstellungen › CLI-Konfiguration shows: whose settings (CLI, account, scope, project) and what
 * the CLI's files say, or the MCP servers of all CLIs side by side. Every change goes to main and is
 * read back, so the page shows the files as they are, also after the CLI or another window changed them.
 */
export const useCliConfigStore = defineStore('cliConfig', () => {
  const accounts = useAccountsStore(null)
  const projects = useProjectsStore(null)
  const settings = useSettingsStore(null)
  const ui = useUiStore()

  /** The CLIs with an adapter in main. */
  const providers = ref<ProviderId[]>([])
  const page = ref<CliConfigPage>('cli')
  const section = ref<CliConfigSection>('mcp')
  const target = ref<CliConfigTarget | null>(null)
  const snapshot = shallowRef<CliConfigSnapshot | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Counts the reads, so an older answer never replaces a newer one. */
  let generation = 0

  const overview = shallowRef<McpOverview | null>(null)
  const overviewLoading = ref(false)
  const overviewError = ref<string | null>(null)
  let overviewGeneration = 0

  async function loadProviders(): Promise<void> {
    if (!providers.value.length) providers.value = await window.api.cliConfig.providers()
  }

  /** The target a first visit starts with: the CLI of new chats, its account, the user's settings. */
  function initialTarget(): CliConfigTarget | null {
    const preferred = settings.settings.defaults.provider
    const provider = providers.value.includes(preferred) ? preferred : providers.value[0]
    if (!provider) return null
    return { provider, accountId: accounts.defaultId(provider), scope: 'user', folder: projects.projects[0]?.path }
  }

  /** Shown on the page: loads what it needs the first time, else reads again; `both` for a search, which shows both. */
  async function show(both = false): Promise<void> {
    await loadProviders()
    if (!target.value || !providers.value.includes(target.value.provider)) target.value = initialTarget()
    await Promise.all([both || page.value === 'all' ? loadOverview() : undefined, both || page.value === 'cli' ? load() : undefined])
  }

  async function load(): Promise<void> {
    const current = target.value
    if (!current) return
    const mine = ++generation
    loading.value = true
    try {
      const next = await window.api.cliConfig.read({ ...current })
      if (mine !== generation) return
      snapshot.value = next
      error.value = null
    } catch (e) {
      if (mine !== generation) return
      snapshot.value = null
      error.value = errorMessage(e)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function loadOverview(): Promise<void> {
    const mine = ++overviewGeneration
    overviewLoading.value = true
    try {
      const next = await window.api.cliConfig.overview()
      if (mine !== overviewGeneration) return
      overview.value = next
      overviewError.value = null
    } catch (e) {
      if (mine !== overviewGeneration) return
      overviewError.value = errorMessage(e)
    } finally {
      if (mine === overviewGeneration) overviewLoading.value = false
    }
  }

  /** Every CLI at once: the overview of the MCP servers. */
  function showAll(): void {
    page.value = 'all'
    void loadOverview()
  }

  /**
   * Another CLI, account, scope or project. A CLI brings its default account and the user's scope; a
   * project's scope without a project takes the first one.
   */
  function select(patch: Partial<CliConfigTarget>): void {
    const current = target.value ?? initialTarget()
    if (!current) return
    const next: CliConfigTarget = { ...current, ...patch }
    if (patch.provider && patch.provider !== current.provider) {
      next.accountId = patch.accountId ?? accounts.defaultId(patch.provider)
      next.scope = 'user'
    }
    if (next.scope !== 'user' && !next.folder) next.folder = projects.projects[0]?.path
    page.value = 'cli'
    target.value = next
    void load()
  }

  /** Opens the settings at a chat's CLI and account, for its folder („Konnektoren verwalten“). */
  async function open(next: CliConfigTarget): Promise<void> {
    target.value = next
    snapshot.value = null
    page.value = 'cli'
    section.value = 'mcp'
    ui.openSettings('cliConfig', 'cliConfig.mcp')
    await loadProviders()
    await load()
  }

  /** „Claude Code · Aizpun Team“: where a change didn't arrive. */
  function columnLabel(column: Pick<McpOverviewColumn, 'provider' | 'accountId'>): string {
    const name = accounts.get(column.accountId)?.name
    return name ? `${PROVIDERS[column.provider].name} · ${name}` : PROVIDERS[column.provider].name
  }

  /** A global change that didn't arrive everywhere: which accounts and why. */
  function report(result: McpSyncResult | void): void {
    if (!result?.failed.length) return
    toast.warning(result.failed.length === 1 ? 'In einem Account nicht geändert' : `In ${result.failed.length} Accounts nicht geändert`, {
      description: result.failed.map((f) => `${columnLabel(f)}: ${f.message}`).join('\n'),
      duration: 12_000,
    })
  }

  /** Runs a change against the target shown, then reads the files again (also after a failure). */
  async function change(action: (target: CliConfigTarget) => Promise<McpSyncResult | void>): Promise<void> {
    const current = target.value
    if (!current) return
    try {
      report(await action({ ...current }))
    } finally {
      await load()
    }
  }

  /** Runs a change of the global servers, then reads the overview (and the CLI shown) again. */
  async function changeGlobal(action: () => Promise<McpSyncResult | void>): Promise<void> {
    try {
      report(await action())
    } finally {
      await Promise.all([loadOverview(), snapshot.value ? load() : undefined])
    }
  }

  // Plain copies: what a form edits is reactive, and IPC can't clone Vue's proxies.
  const saveMcp = (server: McpServerConfig, previousName: string | null) => change((t) => window.api.cliConfig.saveMcp(t, plain(server), previousName))
  const removeMcp = (name: string) => change((t) => window.api.cliConfig.removeMcp(t, name))
  const savePermissions = (values: Record<string, PermissionValue>) => change((t) => window.api.cliConfig.savePermissions(t, plain(values)))
  const saveHooks = (save: HooksSave) => change((t) => window.api.cliConfig.saveHooks(t, plain(save)))
  const trustHook = (key: string, hash: string) => change((t) => window.api.cliConfig.trustHook(t, key, hash))

  const addGlobal = (server: McpServerConfig) => changeGlobal(() => window.api.cliConfig.addGlobal(plain(server)))
  const saveGlobal = (server: McpServerConfig, previousName: string) => changeGlobal(() => window.api.cliConfig.saveGlobal(plain(server), previousName))
  const makeGlobal = (name: string, source: McpOverviewColumn) =>
    changeGlobal(() => window.api.cliConfig.makeGlobal(name, { provider: source.provider, accountId: source.accountId }))
  const unglobal = (name: string) => changeGlobal(() => window.api.cliConfig.unglobal(name))
  const removeGlobal = (name: string) => changeGlobal(() => window.api.cliConfig.removeGlobal(name))
  const syncGlobal = (name: string) => changeGlobal(() => window.api.cliConfig.syncGlobal(name))

  // A global change writes one account after the other: the overview reads once they are through.
  let overviewTimer: ReturnType<typeof setTimeout> | undefined
  function overviewLater(): void {
    clearTimeout(overviewTimer)
    overviewTimer = setTimeout(() => void loadOverview(), 400)
  }

  // Changed through Nexa (this window or another): read again what this one shows.
  window.api.cliConfig.onChanged((changed) => {
    const current = target.value
    if (current && snapshot.value && changed.provider === current.provider && changed.accountId === current.accountId) void load()
    if (page.value === 'all' && overview.value) overviewLater()
  })

  return {
    providers,
    page,
    section,
    target,
    snapshot,
    loading,
    error,
    overview,
    overviewLoading,
    overviewError,
    show,
    load,
    loadOverview,
    showAll,
    select,
    open,
    columnLabel,
    saveMcp,
    removeMcp,
    savePermissions,
    saveHooks,
    trustHook,
    addGlobal,
    saveGlobal,
    makeGlobal,
    unglobal,
    removeGlobal,
    syncGlobal,
  }
})
