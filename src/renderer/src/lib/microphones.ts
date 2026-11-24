/**
 * The microphones to pick for the voice input. The setting holds a microphone's name, not its id:
 * Chromium's ids are salted per profile, the names are what the system shows and stay.
 */

type Device = Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label' | 'groupId'>

export interface Microphone {
  id: string
  label: string
}

/** Chromium's entries for the system's choice (Windows has one for calls too): no device of their own. */
const SYSTEM_ENTRIES = new Set(['default', 'communications'])

function isMicrophone(device: Device): boolean {
  return device.kind === 'audioinput' && !SYSTEM_ENTRIES.has(device.deviceId) && device.label !== ''
}

export function microphonesOf(devices: readonly Device[]): Microphone[] {
  return devices.filter(isMicrophone).map((d) => ({ id: d.deviceId, label: d.label }))
}

/** The name of the microphone the system records with: the device in the group of its entry. */
export function systemMicrophone(devices: readonly Device[]): string | null {
  const entry = devices.find((d) => d.kind === 'audioinput' && d.deviceId === 'default')
  if (!entry) return null
  return devices.find((d) => isMicrophone(d) && d.groupId === entry.groupId)?.label ?? null
}

/** The device to record with for the name set; `undefined` when it isn't connected. */
export function microphoneFor(devices: readonly Device[], name: string): string | undefined {
  return devices.find((d) => isMicrophone(d) && d.label === name)?.deviceId
}
