import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type { CliConfigSnapshot, CliConfigTarget, HooksSave, McpServerConfig, PermissionValue } from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import { errorMessage } from '@/lib/errors'
import { useAccountsStore } from './accounts'
import { useProjectsStore } from './projects'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * What Einstellungen › CLI-Konfiguration shows: whose settings (CLI, account, scope, project) and what
 * the CLI's files say. Every change goes to main and is read back, so the page shows the files as
 * they are, also after the CLI or another window changed them.
 */
export const useCliConfigStore = defineStore('cliConfig', () => {
  const accounts = useAccountsStore()
  const projects = useProjectsStore()
  const settings = useSettingsStore()
  const ui = useUiStore()

  /** The CLIs with an adapter in main. */
  const providers = ref<ProviderId[]>([])
  const target = ref<CliConfigTarget | null>(null)
  const snapshot = shallowRef<CliConfigSnapshot | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Counts the reads, so an older answer never replaces a newer one. */
  let generation = 0

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

  /** Shown on the page: loads what it needs the first time, else reads again. */
  async function show(): Promise<void> {
    await loadProviders()
    if (!target.value || !providers.value.includes(target.value.provider)) target.value = initialTarget()
    await load()
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
    target.value = next
    void load()
  }

  /** Opens the settings at a chat's CLI and account, for its folder („Konnektoren verwalten“). */
  async function open(next: CliConfigTarget): Promise<void> {
    target.value = next
    snapshot.value = null
    ui.openSettings('cliConfig', 'cliConfig.mcp')
    await loadProviders()
    await load()
  }

  /** Runs a change against the target shown, then reads the files again (also after a failure). */
  async function change(action: (target: CliConfigTarget) => Promise<void>): Promise<void> {
    const current = target.value
    if (!current) return
    try {
      await action({ ...current })
    } finally {
      await load()
    }
  }

  // Plain copies: what a form edits is reactive, and IPC can't clone Vue's proxies.
  const saveMcp = (server: McpServerConfig, previousName: string | null) => change((t) => window.api.cliConfig.saveMcp(t, plain(server), previousName))
  const removeMcp = (name: string) => change((t) => window.api.cliConfig.removeMcp(t, name))
  const savePermissions = (values: Record<string, PermissionValue>) => change((t) => window.api.cliConfig.savePermissions(t, plain(values)))
  const saveHooks = (save: HooksSave) => change((t) => window.api.cliConfig.saveHooks(t, plain(save)))
  const trustHook = (key: string, hash: string) => change((t) => window.api.cliConfig.trustHook(t, key, hash))

  // Changed through another window: read again when it is what this one shows.
  window.api.cliConfig.onChanged((changed) => {
    const current = target.value
    if (current && snapshot.value && changed.provider === current.provider && changed.accountId === current.accountId) void load()
  })

  return { providers, target, snapshot, loading, error, show, load, select, open, saveMcp, removeMcp, savePermissions, saveHooks, trustHook }
})
