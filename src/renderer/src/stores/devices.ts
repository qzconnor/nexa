import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'
import { levelAllows, type RemoteHostInfo, type RemoteLevel } from '@shared/remote'
import type { LinkedDevice } from '@shared/server-link'
import { errorMessage } from '@/lib/errors'
import { useAccountsStore } from './accounts'
import { useShownDeviceStore } from './device'
import { useProjectsStore } from './projects'
import { useProvidersStore } from './providers'
import { useServerLinkStore } from './server-link'
import { useSessionsStore } from './sessions'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'

/**
 * How far another device is in this window: `offline` (not connected), `off` (its Remote Control is
 * off, or it gives this one nothing), `loading`, `ready` (its chats show), `error` (`error` says why).
 */
export type DeviceState = 'offline' | 'off' | 'loading' | 'ready' | 'error'

export interface RemoteDevice {
  id: string
  name: string
  online: boolean
  state: DeviceState
  /** What it lets this device do. */
  level: RemoteLevel
  error: string | null
}

interface Known {
  info: RemoteHostInfo | null
  state: DeviceState
  error: string | null
}

/**
 * The other devices of the namespace (Remote Control) as the sidebar shows them, below this device's
 * projects: each with its own stores (`scopedStore`), loaded once it is online and lets this one in,
 * watched while it shows, read anew when it lost track of this one.
 */
export const useDevicesStore = defineStore('devices', () => {
  const link = useServerLinkStore()
  const shown = useShownDeviceStore()
  const ui = useUiStore()
  const known = reactive(new Map<string, Known>())
  let started = false

  /** Trusted, so they hold the namespace's key; this device itself not. */
  const linked = computed<LinkedDevice[]>(() => link.state?.devices.filter((d) => !d.self && d.trusted) ?? [])
  const online = computed(() => link.state?.status === 'online')

  const devices = computed<RemoteDevice[]>(() =>
    linked.value.map((d) => {
      const k = known.get(d.id)
      const reachable = online.value && d.online
      return {
        id: d.id,
        name: d.name,
        online: reachable,
        state: !reachable && k?.state !== 'ready' ? 'offline' : (k?.state ?? 'loading'),
        level: k?.info?.enabled ? k.info.level : 'off',
        error: k?.error ?? null,
      }
    }),
  )

  function knownOf(id: string): Known {
    let k = known.get(id)
    if (!k) {
      known.set(id, { info: null, state: 'offline', error: null })
      k = known.get(id)!
    }
    return k
  }

  /** What `id` lets this device do (`off` while unknown). */
  function level(id: string | null): RemoteLevel {
    if (!id) return 'full'
    const info = known.get(id)?.info
    return info?.enabled ? info.level : 'off'
  }

  function can(id: string | null, needed: RemoteLevel): boolean {
    return levelAllows(level(id), needed)
  }

  /** The devices this window shows, with their chats loaded here: their events come while they are. */
  function syncWatch(): void {
    const list = [...known.entries()]
      .filter(([, k]) => k.state === 'loading' || k.state === 'ready')
      .map(([instance]) => ({ instance, ids: [...useSessionsStore(instance).chats.keys()] }))
    void window.api.remote.watch(list).catch((error) => console.warn('[remote] watch', error))
  }

  /** Asks the device how far it lets this one in and, if at all, loads its stores (as App does this device's). */
  async function load(id: string): Promise<void> {
    const k = knownOf(id)
    if (k.state === 'loading') return
    k.state = 'loading'
    k.error = null
    try {
      k.info = await window.api.remote.hello(id)
      if (!k.info.enabled || !levelAllows(k.info.level, 'read')) {
        k.state = 'off'
        return
      }
      // The watch first: its events then miss nothing of what the calls below read.
      syncWatch()
      await useSettingsStore(id).load()
      await Promise.all([useProvidersStore(id).load(), useAccountsStore(id).load(), useProjectsStore(id).load(), useSessionsStore(id).load()])
      k.state = 'ready'
    } catch (error) {
      k.state = 'error'
      k.error = errorMessage(error)
    } finally {
      syncWatch()
    }
  }

  /** The device lost what this one had of it: everything read anew. */
  async function reload(id: string): Promise<void> {
    const k = known.get(id)
    if (k?.state !== 'ready') return void load(id)
    try {
      await useSettingsStore(id).load()
      await Promise.all([useProvidersStore(id).load(), useAccountsStore(id).load(), useProjectsStore(id).load(), useSessionsStore(id).reload()])
    } catch (error) {
      console.warn('[remote] reload', error)
    }
  }

  /** Once per window: devices loaded as they come online, their news taken in. */
  function start(): void {
    if (started) return
    started = true
    window.api.remote.onResync((id) => void reload(id))
    window.api.remote.onInfo((id, info) => {
      const k = knownOf(id)
      const allowed = info.enabled && levelAllows(info.level, 'read')
      // A watch that failed tells only the level: the name stays the one it had.
      k.info = { ...info, name: info.name || k.info?.name || '', version: info.version || k.info?.version || '' }
      if (!allowed && k.state !== 'off') {
        k.state = 'off'
        syncWatch()
      } else if (allowed && (k.state === 'off' || k.state === 'error')) void load(id)
    })
    watch(
      () => devices.value.map((d) => `${d.id}:${d.online}`).join(),
      () => {
        for (const d of linked.value) {
          const k = knownOf(d.id)
          const reachable = online.value && d.online
          if (reachable && (k.state === 'offline' || k.state === 'error')) void load(d.id)
          // Gone offline: what it showed stays until it is back (its watch then reads anew).
          if (!reachable && k.state === 'loading') k.state = 'offline'
        }
        // Removed from the namespace: nothing more of it here, its chat on screen neither.
        for (const id of [...known.keys()]) {
          if (linked.value.some((d) => d.id === id)) continue
          known.delete(id)
          if (shown.device === id) {
            shown.show(null)
            if (ui.view === 'chat') ui.view = 'home'
          }
        }
        syncWatch()
      },
      { immediate: true },
    )
    // A chat of a device opened or let go: its events come or stop.
    watch(
      () => [...known.entries()].filter(([, k]) => k.state === 'ready').map(([id]) => `${id}:${[...useSessionsStore(id).chats.keys()].join(',')}`).join('|'),
      () => syncWatch(),
    )
  }

  return { devices, level, can, load, start }
})
