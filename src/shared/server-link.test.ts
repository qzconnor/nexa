import { describe, expect, it } from 'vitest'
import { pushPhones, type LinkedDevice } from './server-link'

const device = (id: string, patch: Partial<LinkedDevice> = {}): LinkedDevice => ({
  id,
  name: id,
  role: 'controller',
  online: false,
  lastSeen: null,
  createdAt: 0,
  self: false,
  trusted: true,
  issue: null,
  level: 'read',
  ...patch,
})

describe('pushPhones', () => {
  it('takes the trusted controllers that may at least read along, while Remote Control is on', () => {
    const devices = [
      device('phone'),
      device('blocked', { level: 'off' }),
      device('stranger', { trusted: false }),
      device('laptop', { role: 'host' }),
      device('self', { self: true }),
    ]
    expect(pushPhones({ remoteEnabled: true, devices }).map((d) => d.id)).toEqual(['phone'])
    expect(pushPhones({ remoteEnabled: false, devices })).toEqual([])
  })
})
