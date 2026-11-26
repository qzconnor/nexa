import { defineStore } from 'pinia'
import { hasInjectionContext, inject, provide, ref, type InjectionKey } from 'vue'
import type { Unsubscribe } from '@shared/ipc'
import type { RemoteBroadcast } from '@shared/remote'
import { deviceApi, type DeviceApi } from '@shared/window-api'

/*
 * Chats of other devices (Remote Control) show and work as this device's own: the sidebar, the chat
 * window and its dock are the same components, on stores of that device. A component learns whose
 * things it shows from the nearest `provideDevice` above it (none: this device's), and the stores
 * that hold a device's things (`scopedStore`) come once per device, on that device's window API.
 */

const DEVICE_KEY: InjectionKey<string | null> = Symbol('device')

/** The components below show the things of `device` (another device's instance), or null: this one's. */
export function provideDevice(device: string | null): void {
  provide(DEVICE_KEY, device)
}

/** Whose things the component shows: null for this device, else the other device's instance. */
export function useDevice(): string | null {
  return hasInjectionContext() ? inject(DEVICE_KEY, null) : null
}

/**
 * A store of which each device has its own: called in a component, the one of the device the component
 * shows (`provideDevice`), elsewhere this device's; or that of `device`. Stores pass their device on to
 * the stores they use, never leaving it to where they happen to be made.
 */
export function scopedStore<SS extends object>(name: string, setup: (device: string | null) => SS) {
  const define = (device: string | null) => defineStore(device ? `${name}@${device}` : name, () => setup(device))
  const definitions = new Map<string, ReturnType<typeof define>>()
  return (device?: string | null): ReturnType<ReturnType<typeof define>> => {
    const own = device === undefined ? useDevice() : device
    let definition = definitions.get(own ?? '')
    if (!definition) {
      definition = define(own)
      definitions.set(own ?? '', definition)
    }
    return definition()
  }
}

// --- The window API of another device ---------------------------------------------------------------

const apis = new Map<string, DeviceApi>()
/** Per device, per event channel, who listens. */
const listeners = new Map<string, Map<string, Set<(...args: unknown[]) => void>>>()
let listening = false

function dispatch(instance: string, events: RemoteBroadcast[]): void {
  const channels = listeners.get(instance)
  if (!channels) return
  for (const { ch, args } of events) {
    for (const cb of channels.get(ch) ?? []) {
      try {
        cb(...args)
      } catch (error) {
        console.error('[remote] event', ch, error)
      }
    }
  }
}

function subscribe(instance: string, ch: string, cb: (...args: unknown[]) => void): Unsubscribe {
  if (!listening) {
    listening = true
    window.api.remote.onEvents(dispatch)
  }
  let channels = listeners.get(instance)
  if (!channels) listeners.set(instance, (channels = new Map()))
  let set = channels.get(ch)
  if (!set) channels.set(ch, (set = new Set()))
  set.add(cb)
  return () => {
    set.delete(cb)
  }
}

/**
 * The window API of `device`: this device's own (`window.api`), or another's, whose calls go there by
 * Remote Control and whose events come from there.
 */
export function apiOf(device: string | null): DeviceApi {
  if (!device) return window.api
  let api = apis.get(device)
  if (!api) {
    api = deviceApi(
      (ch, ...args) => window.api.remote.invoke(device, ch, args),
      (ch, cb) => subscribe(device, ch, cb as (...args: unknown[]) => void),
    )
    apis.set(device, api)
  }
  return api
}

/** The window API of the device the component shows (`useDevice`). */
export function useDeviceApi(): DeviceApi {
  return apiOf(useDevice())
}

/**
 * The device whose chat or start page the main area shows: null this one, else another's instance. A
 * chat opened on one device closes the open one of every other (`register`), so one chat is on screen.
 */
export const useShownDeviceStore = defineStore('shownDevice', () => {
  const device = ref<string | null>(null)
  const closers = new Map<string, () => void>()

  /** How the sessions store of `of` closes its open chat. */
  function register(of: string | null, close: () => void): void {
    closers.set(of ?? '', close)
  }

  function show(of: string | null): void {
    device.value = of
    for (const [key, close] of closers) if (key !== (of ?? '')) close()
  }

  return { device, register, show }
})
