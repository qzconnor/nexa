import { describe, expect, it } from 'vitest'
import { toBase64url } from './auth'
import { randomNamespaceKey } from './envelope'
import { decodePairingCode, encodePairingCode, isPairingCode, normalizeServerUrl, webAppPairingLink, webSocketUrl } from './pairing-code'

const encode = (data: unknown) => `nexa1:${toBase64url(new TextEncoder().encode(JSON.stringify(data)))}`

describe('normalizeServerUrl', () => {
  it('adds https and drops what does not belong to the address', () => {
    expect(normalizeServerUrl('nexa.example.com')).toEqual({ url: 'https://nexa.example.com' })
    expect(normalizeServerUrl(' https://nexa.example.com/ ')).toEqual({ url: 'https://nexa.example.com' })
    expect(normalizeServerUrl('https://example.com/nexa/?x=1#y')).toEqual({ url: 'https://example.com/nexa' })
    expect(normalizeServerUrl('https://example.com:8443')).toEqual({ url: 'https://example.com:8443' })
  })

  it('takes plain http only for this computer', () => {
    expect(normalizeServerUrl('http://localhost:8080')).toEqual({ url: 'http://localhost:8080' })
    expect(normalizeServerUrl('http://127.0.0.1:8080/')).toEqual({ url: 'http://127.0.0.1:8080' })
    expect(normalizeServerUrl('http://[::1]:8080')).toEqual({ url: 'http://[::1]:8080' })
    expect(normalizeServerUrl('http://nexa.example.com')).toHaveProperty('error')
  })

  it('refuses what is no server address', () => {
    expect(normalizeServerUrl('')).toHaveProperty('error')
    expect(normalizeServerUrl('ftp://example.com')).toHaveProperty('error')
    expect(normalizeServerUrl('https://user:pass@example.com')).toHaveProperty('error')
    expect(normalizeServerUrl('https://')).toHaveProperty('error')
  })

  it('gives the WebSocket under the same address', () => {
    expect(webSocketUrl('https://example.com/nexa')).toBe('wss://example.com/nexa/v1/ws')
    expect(webSocketUrl('http://localhost:8080')).toBe('ws://localhost:8080/v1/ws')
  })

  it('links the web app with the code untouched in the fragment', () => {
    expect(webAppPairingLink('https://example.com', 'nexa1:abc-_')).toBe('https://example.com/app/#nexa1:abc-_')
    expect(webAppPairingLink('https://example.com/nexa', 'nexa1:x')).toBe('https://example.com/nexa/app/#nexa1:x')
  })
})

describe('pairing code', () => {
  it('round-trips', () => {
    const code = { url: 'https://nexa.example.com', invite: '8MXK-GQDC-2QSY-7QM6-NJ9A-T274-Y96X-PGBC', key: randomNamespaceKey(), gen: 3 }
    const text = encodePairingCode(code)
    expect(text.startsWith('nexa1:')).toBe(true)
    expect(isPairingCode(text)).toBe(true)
    expect(decodePairingCode(text)).toEqual(code)
    // Pasted with a line break in the middle, as some chats wrap long text.
    expect(decodePairingCode(`${text.slice(0, 30)}\n${text.slice(30)}`)).toEqual(code)
  })

  it('reads codes without the generation and ignores unknown fields', () => {
    const key = randomNamespaceKey()
    expect(decodePairingCode(encode({ u: 'https://a.example', c: 'CODE', k: key, x: 1 }))).toEqual({ url: 'https://a.example', invite: 'CODE', key, gen: 0 })
  })

  it('refuses incomplete or broken codes', () => {
    const key = randomNamespaceKey()
    expect(decodePairingCode('ABCD-EFGH')).toBeNull()
    expect(decodePairingCode('nexa1:%%%')).toBeNull()
    expect(decodePairingCode(encode({ u: 'https://a.example', c: 'CODE' }))).toBeNull()
    expect(decodePairingCode(encode({ u: 'https://a.example', c: 'CODE', k: 'kurz' }))).toBeNull()
    expect(decodePairingCode(encode({ u: 'http://a.example', c: 'CODE', k: key }))).toBeNull()
    expect(decodePairingCode(encode({ u: 'https://a.example', c: '', k: key }))).toBeNull()
    expect(decodePairingCode(encode({ u: 'https://a.example', c: 'CODE', k: key, g: -1 }))).toBeNull()
    expect(decodePairingCode(encode(['https://a.example', 'CODE', key]))).toBeNull()
  })
})
