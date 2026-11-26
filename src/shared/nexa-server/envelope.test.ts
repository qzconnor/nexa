import { describe, expect, it } from 'vitest'
import { toBase64url, type Key } from './auth'
import {
  importNamespaceKey,
  keyIdOf,
  openSealed,
  pairwiseKey,
  PAIRWISE,
  parseSealed,
  randomNamespaceKey,
  seal,
  verifyOpened,
  type Header,
} from './envelope'

async function instanceKeys() {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const raw = async (key: Key) => toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
  return { signPrivate: sign.privateKey, signKey: await raw(sign.publicKey), dhPrivate: dh.privateKey, dhKey: await raw(dh.publicKey) }
}

const header: Header = { from: 'AAAAAAAAAAAAAAAAAAAAAA', to: '*', kind: 'member.hello', id: 'm1' }

describe('envelope', () => {
  it('seals and opens with the namespace key, signed by the sender', async () => {
    const alice = await instanceKeys()
    const raw = randomNamespaceKey()
    const keyRef = await keyIdOf(raw)
    const key = await importNamespaceKey(raw)
    const body = await seal({ header, keyRef, key, data: { hello: 'welt' }, signKey: alice.signPrivate, now: 1000 })

    const sealed = parseSealed(JSON.parse(JSON.stringify(body)))
    expect(sealed?.k).toBe(keyRef)
    const opened = await openSealed(header, sealed!, key)
    expect(opened).toMatchObject({ at: 1000, data: { hello: 'welt' }, keyRef })
    expect(await verifyOpened(opened!, alice.signKey)).toBe(true)
  })

  it('does not open when the server changes the header', async () => {
    const alice = await instanceKeys()
    const raw = randomNamespaceKey()
    const key = await importNamespaceKey(raw)
    const keyRef = await keyIdOf(raw)
    const body = await seal({ header, keyRef, key, data: 1, signKey: alice.signPrivate })
    for (const changed of [
      { ...header, from: 'BBBBBBBBBBBBBBBBBBBBBB' },
      { ...header, to: 'BBBBBBBBBBBBBBBBBBBBBB' },
      { ...header, kind: 'key.share' },
      { ...header, id: 'm2' },
    ]) {
      expect(await openSealed(changed, body, key)).toBeNull()
    }
    // Another key reference is Associated Data as well.
    expect(await openSealed(header, { ...body, k: 'x'.repeat(16) }, key)).toBeNull()
  })

  it('does not open with another key', async () => {
    const alice = await instanceKeys()
    const raw = randomNamespaceKey()
    const body = await seal({ header, keyRef: await keyIdOf(raw), key: await importNamespaceKey(raw), data: 1, signKey: alice.signPrivate })
    expect(await openSealed(header, body, await importNamespaceKey(randomNamespaceKey()))).toBeNull()
  })

  it('tells who signed: another device with the same namespace key is not the sender', async () => {
    const alice = await instanceKeys()
    const mallory = await instanceKeys()
    const raw = randomNamespaceKey()
    const key = await importNamespaceKey(raw)
    const body = await seal({ header, keyRef: await keyIdOf(raw), key, data: 1, signKey: mallory.signPrivate })
    const opened = await openSealed(header, body, key)
    expect(await verifyOpened(opened!, alice.signKey)).toBe(false)
    expect(await verifyOpened(opened!, mallory.signKey)).toBe(true)
  })

  it('derives the same pairwise key on both sides, and another for a third device', async () => {
    const alice = await instanceKeys()
    const bob = await instanceKeys()
    const carol = await instanceKeys()
    const ab = await pairwiseKey({ id: 'alice', dhPrivate: alice.dhPrivate }, { id: 'bob', dhKey: bob.dhKey })
    const ba = await pairwiseKey({ id: 'bob', dhPrivate: bob.dhPrivate }, { id: 'alice', dhKey: alice.dhKey })
    const cb = await pairwiseKey({ id: 'carol', dhPrivate: carol.dhPrivate }, { id: 'bob', dhKey: bob.dhKey })
    const h: Header = { from: 'alice', to: 'bob', kind: 'key.share', id: 'k1' }
    const body = await seal({ header: h, keyRef: PAIRWISE, key: ab!, data: 'geheim', signKey: alice.signPrivate })
    expect((await openSealed(h, body, ba!))?.data).toBe('geheim')
    expect(await openSealed(h, body, cb!)).toBeNull()
  })

  it('refuses a public key that is no point on P-256', async () => {
    const alice = await instanceKeys()
    expect(await pairwiseKey({ id: 'a', dhPrivate: alice.dhPrivate }, { id: 'b', dhKey: 'AAAA' })).toBeNull()
    const notOnCurve = toBase64url(new Uint8Array([4, ...new Uint8Array(64).fill(1)]))
    expect(await pairwiseKey({ id: 'a', dhPrivate: alice.dhPrivate }, { id: 'b', dhKey: notOnCurve })).toBeNull()
  })

  it('reads only bodies of its own shape', () => {
    expect(parseSealed(null)).toBeNull()
    expect(parseSealed('text')).toBeNull()
    expect(parseSealed({ v: 2, k: 'abc', n: 'AAAAAAAAAAAAAAAA', c: 'x' })).toBeNull()
    expect(parseSealed({ v: 1, k: 'abc', n: 'short', c: 'x' })).toBeNull()
    expect(parseSealed({ v: 1, k: 'abc', n: 'AAAAAAAAAAAAAAAA', c: 'x' })).toEqual({ v: 1, k: 'abc', n: 'AAAAAAAAAAAAAAAA', c: 'x' })
  })

  it('names a key by a hash that stays the same and differs between keys', async () => {
    const raw = randomNamespaceKey()
    expect(await keyIdOf(raw)).toBe(await keyIdOf(raw))
    expect(await keyIdOf(raw)).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(await keyIdOf(raw)).not.toBe(await keyIdOf(randomNamespaceKey()))
  })
})
