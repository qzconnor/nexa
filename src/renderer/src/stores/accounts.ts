import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { systemAccountId, type Account, type AccountCreateInput, type AccountLoginState, type AccountUpdateInput } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import type { SessionMeta } from '@shared/types'
import { useSettingsStore } from './settings'

/**
 * The accounts of every CLI, the default one each CLI starts new chats with, and the browser logins
 * that run. The login dialog (`AccountLoginDialog`) shows the one in `loginId`.
 */
export const useAccountsStore = defineStore('accounts', () => {
  const settings = useSettingsStore()
  const accounts = ref<Account[]>([])
  const logins = reactive(new Map<string, AccountLoginState>())
  /** The account whose login the dialog shows. */
  const loginId = ref<string | null>(null)
  /** The account the form edits; `{ provider }` for a new one of that CLI. */
  const formRequest = ref<{ account: Account | null; provider: ProviderId } | null>(null)

  const byId = computed(() => new Map(accounts.value.map((a) => [a.id, a])))

  function get(id: string | null | undefined): Account | undefined {
    return id ? byId.value.get(id) : undefined
  }

  function ofProvider(provider: ProviderId): Account[] {
    return accounts.value.filter((a) => a.provider === provider)
  }

  /** The account new chats of a CLI start with (the standard account when the chosen one is gone). */
  function defaultId(provider: ProviderId): string {
    const chosen = settings.settings.defaults.accounts?.[provider]
    const account = get(chosen)
    return account?.provider === provider ? account.id : systemAccountId(provider)
  }

  /** The account a chat runs with for its current CLI (as the main process picks it, see SessionService.accountFor). */
  function sessionAccount(meta: SessionMeta): string {
    const link = meta.cli[meta.provider]
    const chosen = meta.accounts?.[meta.provider] ?? (link ? (link.accountId ?? systemAccountId(meta.provider)) : undefined)
    const account = get(chosen)
    return account?.provider === meta.provider ? account.id : defaultId(meta.provider)
  }

  async function setDefault(account: Account): Promise<void> {
    await settings.update({ defaults: { accounts: { [account.provider]: account.id } } })
  }

  async function load(): Promise<void> {
    const [list, running] = await Promise.all([window.api.accounts.list(), window.api.accounts.logins()])
    accounts.value = list
    for (const state of running) logins.set(state.accountId, state)
    window.api.accounts.onChanged((next) => (accounts.value = next))
    window.api.accounts.onLogin((state) => logins.set(state.accountId, state))
  }

  async function refresh(): Promise<void> {
    accounts.value = await window.api.accounts.refresh()
  }

  async function create(input: AccountCreateInput): Promise<Account> {
    const account = await window.api.accounts.create(input)
    if (!get(account.id)) accounts.value = [...accounts.value, account]
    return account
  }

  async function update(id: string, patch: AccountUpdateInput): Promise<Account> {
    const account = await window.api.accounts.update(id, patch)
    accounts.value = accounts.value.map((a) => (a.id === id ? account : a))
    return account
  }

  async function remove(id: string, deleteFolder: boolean): Promise<void> {
    await window.api.accounts.remove(id, deleteFolder)
    accounts.value = accounts.value.filter((a) => a.id !== id)
  }

  /** Starts the browser login and shows its dialog. */
  async function login(id: string): Promise<void> {
    loginId.value = id
    logins.delete(id)
    const state = await window.api.accounts.login(id)
    // Its events may have come before the answer: they are newer.
    if (!logins.has(id)) logins.set(id, state)
  }

  return { accounts, logins, loginId, formRequest, get, ofProvider, defaultId, sessionAccount, setDefault, load, refresh, create, update, remove, login }
})
