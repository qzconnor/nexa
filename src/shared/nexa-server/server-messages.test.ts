import { describe, expect, it } from 'vitest'
import { parseServerMessage } from './server-messages'

const info = {
  id: 'hIkscegBGIQ_aBh56MTtOw',
  name: '  Desktop  ',
  role: 'host',
  signKey: 'BMRT1x2K',
  dhKey: 'BO7n-An1',
  createdAt: 1,
  lastSeen: null,
  online: true,
}
const parse = (data: unknown) => parseServerMessage(JSON.stringify(data))

describe('parseServerMessage', () => {
  it('reads the login', () => {
    expect(parse({ t: 'hello', v: 1, nonce: 'abc' })).toEqual({ t: 'hello', v: 1, nonce: 'abc' })
    expect(parse({ t: 'ready', instance: info.id, namespace: 'connor', instances: [info] })).toEqual({
      t: 'ready',
      instance: info.id,
      namespace: 'connor',
      instances: [{ ...info, name: 'Desktop' }],
    })
  })

  it('keeps only known fields of an instance and refuses odd ones', () => {
    expect(parse({ t: 'instance', event: 'online', instance: { ...info, extra: 'x' } })).toEqual({
      t: 'instance',
      event: 'online',
      instance: { ...info, name: 'Desktop' },
    })
    expect(parse({ t: 'instance', event: 'online', instance: { ...info, role: 'admin' } })).toBeNull()
    expect(parse({ t: 'instance', event: 'online', instance: { ...info, name: 'a‮b' } })).toBeNull()
    expect(parse({ t: 'instance', event: 'gone', instance: info })).toBeNull()
    expect(parse({ t: 'ready', instance: info.id, namespace: 'connor', instances: [{ ...info, online: 'yes' }] })).toBeNull()
  })

  it('reads relayed messages with any body', () => {
    const msg = { t: 'msg', id: 'm1', from: info.id, to: '*', kind: 'member.hello', body: { v: 1 } }
    expect(parse(msg)).toEqual(msg)
    expect(parse({ ...msg, kind: '.bad' })).toBeNull()
  })

  it('takes unknown error codes as internal', () => {
    expect(parse({ t: 'error', re: 'r1', code: 'unreachable', message: 'x' })).toEqual({ t: 'error', re: 'r1', code: 'unreachable', message: 'x' })
    expect(parse({ t: 'error', code: 'brand-new', message: 'x' })).toEqual({ t: 'error', code: 'internal', message: 'x' })
  })

  it('drops what is not a message', () => {
    expect(parseServerMessage('nicht json')).toBeNull()
    expect(parse([1, 2])).toBeNull()
    expect(parse({ t: 'unknown' })).toBeNull()
    expect(parse({ t: 'ok' })).toBeNull()
  })
})
