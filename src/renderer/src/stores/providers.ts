import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { enabledProviders, offeredProviders, providerTogglePatch } from '@shared/providers'
import type { CommandOption, ModelDefaults, ModelOption, ProviderStatus, ProviderUsage } from '@shared/types'
import { useSettingsStore } from './settings'

/** The CLIs: installed and logged in, switched on or off, their models, the usage of every account's plan. */
export const useProvidersStore = defineStore('providers', () => {
  const settings = useSettingsStore()
  const statuses = ref<ProviderStatus[]>([])
  const usage = ref<ProviderUsage[]>([])
  const models = ref<Partial<Record<ProviderId, ModelOption[]>>>({})
  const detecting = ref(false)
  const loading = new Map<ProviderId, Promise<ModelOption[]>>()

  const byId = computed(() => Object.fromEntries(statuses.value.map((s) => [s.id, s])) as Partial<Record<ProviderId, ProviderStatus>>)
  /** Checked at least once. */
  const checked = computed(() => statuses.value.some((s) => s.checkedAt > 0))
  const installed = computed(() => PROVIDER_IDS.filter((id) => byId.value[id]?.installed))
  /** Switched on in the settings (installed or not). */
  const enabled = computed(() => enabledProviders(settings.settings))
  /** What chats can use: installed and switched on. */
  const available = computed(() => installed.value.filter((id) => enabled.value.includes(id)))
  /** Switched on and offered to choose from: a CLI with `untilInstalled` only once it was found. */
  const offered = computed(() => offeredProviders(settings.settings, installed.value))

  function status(id: ProviderId): ProviderStatus | undefined {
    return byId.value[id]
  }

  /** Switches a CLI on or off for Nexa; false when it isn't allowed (the last one that is on). */
  async function setEnabled(id: ProviderId, on: boolean): Promise<boolean> {
    const patch = providerTogglePatch(settings.settings, id, on)
    if (!patch) return settings.settings[id].enabled === on
    await settings.update(patch)
    if (on) {
      // It wasn't asked while off: its models and limits are new.
      if (byId.value[id]?.installed) void loadModels(id)
      void window.api.usage.refresh().then((next) => (usage.value = next))
    }
    return true
  }

  function usageOf(accountId: string): ProviderUsage | undefined {
    return usage.value.find((u) => u.accountId === accountId)
  }

  async function load(): Promise<void> {
    const [list, current] = await Promise.all([window.api.providers.list(), window.api.usage.get()])
    statuses.value = list
    usage.value = current
    window.api.providers.onChanged((next) => {
      statuses.value = next
      // A CLI that was installed or logged in meanwhile may have other models.
      for (const s of next) if (s.installed && settings.settings[s.id].enabled && !models.value[s.id]?.length) void loadModels(s.id)
    })
    window.api.usage.onChanged((next) => (usage.value = next))
    for (const s of list) if (s.installed && settings.settings[s.id].enabled) void loadModels(s.id)
  }

  async function refresh(): Promise<void> {
    detecting.value = true
    try {
      statuses.value = await window.api.providers.refresh()
      usage.value = await window.api.usage.refresh()
    } finally {
      detecting.value = false
    }
  }

  function loadModels(id: ProviderId): Promise<ModelOption[]> {
    let pending = loading.get(id)
    if (!pending) {
      pending = window.api.providers
        .models(id)
        .then((list) => {
          models.value = { ...models.value, [id]: list }
          return list
        })
        .catch(() => [] as ModelOption[])
        .finally(() => loading.delete(id))
      loading.set(id, pending)
    }
    return pending
  }

  // The CLI answers these from caches of its own, but every question is a round trip to main; a chat
  // that asks again on every keystroke would wait for nothing new.
  const commandCache = new Map<string, { at: number; list: Promise<CommandOption[]> }>()
  const defaultsCache = new Map<string, Promise<ModelDefaults>>()

  /** The slash commands, MCP prompts and skills of a CLI in a folder; asked again after `maxAgeMs`. */
  function commands(id: ProviderId, account: string | undefined, cwd: string | null, maxAgeMs = 30_000): Promise<CommandOption[]> {
    const key = `${id}\0${account ?? ''}\0${cwd}`
    const cached = commandCache.get(key)
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.list
    const list = window.api.providers.commands(id, account, cwd).catch(() => cached?.list ?? ([] as CommandOption[]))
    commandCache.set(key, { at: Date.now(), list })
    return list
  }

  /** What a model starts with when nothing is chosen: its effort, Claude's Ultracode. */
  function modelDefaults(id: ProviderId, account: string | undefined, model: string): Promise<ModelDefaults> {
    const key = `${id}\0${account ?? ''}\0${model}`
    let pending = defaultsCache.get(key)
    if (!pending) {
      pending = window.api.providers.modelDefaults(id, account, model).catch(() => {
        // A failed probe is asked again next time instead of staying empty.
        defaultsCache.delete(key)
        return {} as ModelDefaults
      })
      defaultsCache.set(key, pending)
    }
    return pending
  }

  return {
    statuses,
    usage,
    models,
    detecting,
    checked,
    installed,
    enabled,
    available,
    offered,
    status,
    usageOf,
    setEnabled,
    load,
    refresh,
    loadModels,
    commands,
    modelDefaults,
  }
})
