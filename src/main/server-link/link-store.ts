import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fromBase64url, toBase64url, type Key } from '@shared/nexa-server/auth'
import { parseKeyRecord, type KeyRecord, type Member } from '@shared/nexa-server/members'
import { isInstanceId, type InstanceInfo, type Role } from '@shared/nexa-server/protocol'
import { isRemoteLevel, type RemoteLevel } from '@shared/remote'
import { readJsonGuarded, writeJsonAtomic } from '../lib/json-file'
import { decryptSecret, encryptSecret, type DecryptedSecret } from '../lib/secrets'

/** `nexa-server.json`: the pairing of this device. Nothing secret in plain text. */
export interface StoredLink {
  version: 1
  url: string
  namespace: string
  instance: string
  name: string
  role: Role
  /** This instance's public keys, raw, base64url: the private halves are in `secrets`. */
  signKey: string
  dhKey: string
  /** Disconnected by the user: stays so after a restart. */
  paused: boolean
  /** `LinkSecrets` as JSON, encrypted with the system's key store (`lib/secrets.ts`). */
  secrets: string
  members: Member[]
  /** The devices as the server listed them last, for the list while offline. */
  devices: InstanceInfo[]
  /** Remote Control of this device by the others (`shared/remote.ts`): off until the user turns it on. */
  remote: RemoteSettings
}

export interface RemoteSettings {
  enabled: boolean
  /** By instance; a device without one gets `DEFAULT_REMOTE_LEVEL`. */
  levels: Record<string, RemoteLevel>
}

/** What the file says about Remote Control, without anything that isn't a level; files from before it have none. */
function parseRemote(value: unknown): RemoteSettings {
  if (typeof value !== 'object' || value === null) return { enabled: false, levels: {} }
  const { enabled, levels } = value as Partial<RemoteSettings>
  const kept: Record<string, RemoteLevel> = {}
  if (typeof levels === 'object' && levels !== null) {
    for (const [id, level] of Object.entries(levels)) if (isInstanceId(id) && isRemoteLevel(level)) kept[id] = level
  }
  return { enabled: enabled === true, levels: kept }
}

/** The private keys of this instance (PKCS #8, base64url) and the namespace keys it holds. */
export interface LinkSecrets {
  signKey: string
  dhKey: string
  keys: KeyRecord[]
}

/** This instance's keys, ready to use. */
export interface Identity {
  signPrivate: Key
  /** Raw public key, base64url, as the server lists it. */
  signKey: string
  dhPrivate: Key
  dhKey: string
}

export interface SecretCodec {
  encrypt(plain: string): Promise<string>
  decrypt(encrypted: string): Promise<DecryptedSecret | null>
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

/** New keys for an instance: one pair to log in and sign, one for ECDH. A pair is never reused for another pairing. */
export async function generateIdentity(): Promise<{ identity: Identity; secrets: Pick<LinkSecrets, 'signKey' | 'dhKey'> }> {
  const sign = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  const dh = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const exportRaw = async (key: Key) => toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
  const exportPrivate = async (key: Key) => toBase64url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', key)))
  return {
    identity: { signPrivate: sign.privateKey, signKey: await exportRaw(sign.publicKey), dhPrivate: dh.privateKey, dhKey: await exportRaw(dh.publicKey) },
    secrets: { signKey: await exportPrivate(sign.privateKey), dhKey: await exportPrivate(dh.privateKey) },
  }
}

/** The stored keys as `Identity`; the public halves are those the server knows for this instance. */
export async function importIdentity(secrets: Pick<LinkSecrets, 'signKey' | 'dhKey'>, publicKeys: Pick<Identity, 'signKey' | 'dhKey'>): Promise<Identity> {
  const pkcs8 = (text: string) => {
    const bytes = fromBase64url(text)
    if (!bytes) throw new Error('private key: expected base64url')
    return bytes
  }
  return {
    signPrivate: await crypto.subtle.importKey('pkcs8', pkcs8(secrets.signKey), ECDSA, false, ['sign']),
    signKey: publicKeys.signKey,
    dhPrivate: await crypto.subtle.importKey('pkcs8', pkcs8(secrets.dhKey), ECDH, false, ['deriveBits']),
    dhKey: publicKeys.dhKey,
  }
}

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'ok'; link: StoredLink; secrets: LinkSecrets }
  /** There, but its keys don't decrypt (another Windows user, a new system key store): it has to pair again. */
  | { kind: 'locked'; link: StoredLink }

/**
 * The pairing on disk. The file is guarded (`readJsonGuarded`): a broken or locked one is not replaced
 * by an empty state, since its keys can't be made again.
 */
export class LinkStore {
  readonly file: string

  constructor(
    userDataDir: string,
    private readonly codec: SecretCodec = { encrypt: encryptSecret, decrypt: decryptSecret },
  ) {
    this.file = join(userDataDir, 'nexa-server.json')
  }

  async load(): Promise<LoadResult> {
    const link = await readJsonGuarded<StoredLink>(this.file)
    if (!link || link.version !== 1 || typeof link.secrets !== 'string' || typeof link.signKey !== 'string' || typeof link.dhKey !== 'string') {
      return { kind: 'none' }
    }
    const decrypted = await this.codec.decrypt(link.secrets)
    const secrets = decrypted ? parseSecrets(decrypted.plain) : null
    if (!secrets) return { kind: 'locked', link }
    const loaded: StoredLink = { ...link, members: link.members ?? [], devices: link.devices ?? [], paused: link.paused === true, remote: parseRemote(link.remote) }
    if (decrypted?.reEncrypted) await this.write({ ...loaded, secrets: decrypted.reEncrypted })
    return { kind: 'ok', link: loaded, secrets }
  }

  /** Writes the pairing; the secrets are encrypted anew each time (they change only with a new key). */
  async save(link: Omit<StoredLink, 'secrets' | 'version'>, secrets: LinkSecrets): Promise<void> {
    await this.write({ version: 1, ...link, secrets: await this.codec.encrypt(JSON.stringify(secrets)) })
  }

  /** Forgets the pairing, with the backup of the file: it holds the keys as well. */
  async clear(): Promise<void> {
    await rm(this.file, { force: true })
    await rm(`${this.file}.bak`, { force: true })
  }

  private write(link: StoredLink): Promise<void> {
    return writeJsonAtomic(this.file, link, { mode: 0o600, guarded: true })
  }
}

function parseSecrets(plain: string): LinkSecrets | null {
  let data: unknown
  try {
    data = JSON.parse(plain)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const { signKey, dhKey, keys } = data as Record<string, unknown>
  if (typeof signKey !== 'string' || typeof dhKey !== 'string' || !Array.isArray(keys)) return null
  const records = keys.map(parseKeyRecord).filter((key): key is KeyRecord => key !== null)
  return records.length ? { signKey, dhKey, keys: records } : null
}
