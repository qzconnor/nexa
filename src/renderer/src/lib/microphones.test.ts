import { describe, expect, it } from 'vitest'
import { microphoneFor, microphonesOf, systemMicrophone } from './microphones'

const device = (deviceId: string, label: string, groupId: string, kind: MediaDeviceKind = 'audioinput') => ({ deviceId, label, groupId, kind })

const devices = [
  device('default', 'Standard - Mikrofon (Realtek(R) Audio)', 'g1'),
  device('communications', 'Kommunikation - Headset (USB)', 'g2'),
  device('a1', 'Mikrofon (Realtek(R) Audio)', 'g1'),
  device('b2', 'Headset (USB)', 'g2'),
  device('o1', 'Lautsprecher (Realtek(R) Audio)', 'g1', 'audiooutput'),
]

describe('microphonesOf', () => {
  it('lists the devices, without the system’s entries and speakers', () => {
    expect(microphonesOf(devices)).toEqual([
      { id: 'a1', label: 'Mikrofon (Realtek(R) Audio)' },
      { id: 'b2', label: 'Headset (USB)' },
    ])
  })

  it('leaves out devices without a name (no permission yet)', () => {
    expect(microphonesOf([device('x', '', 'g')])).toEqual([])
  })
})

describe('systemMicrophone', () => {
  it('names the device the system records with', () => {
    expect(systemMicrophone(devices)).toBe('Mikrofon (Realtek(R) Audio)')
    expect(systemMicrophone(devices.slice(2))).toBeNull()
  })
})

describe('microphoneFor', () => {
  it('finds the device by its name', () => {
    expect(microphoneFor(devices, 'Headset (USB)')).toBe('b2')
    expect(microphoneFor(devices, 'Kommunikation - Headset (USB)')).toBeUndefined()
    expect(microphoneFor(devices, 'USB-Mikrofon')).toBeUndefined()
  })
})
