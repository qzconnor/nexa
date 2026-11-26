import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DeviceInvite, PairInput, ServerLinkState } from '@shared/server-link'

/** The pairing with a nexa-server and the devices of the namespace (Einstellungen › Geräte). */
export const useServerLinkStore = defineStore('serverLink', () => {
  const state = ref<ServerLinkState | null>(null)
  let loading: Promise<void> | null = null

  /** Once, when the page first shows: nothing of it is needed before. */
  function load(): Promise<void> {
    loading ??= (async () => {
      window.api.serverLink.onChanged((next) => (state.value = next))
      state.value = await window.api.serverLink.state()
    })()
    return loading
  }

  async function pair(input: PairInput): Promise<void> {
    state.value = await window.api.serverLink.pair(input)
  }

  const invite = (): Promise<DeviceInvite> => window.api.serverLink.invite()
  const rename = (instance: string | null, name: string) => window.api.serverLink.rename(instance, name)
  const remove = (instance: string) => window.api.serverLink.remove(instance)
  const unpair = () => window.api.serverLink.unpair()
  const connect = () => window.api.serverLink.connect()
  const disconnect = () => window.api.serverLink.disconnect()

  return { state, load, pair, invite, rename, remove, unpair, connect, disconnect }
})
