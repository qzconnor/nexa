import { safeStorage } from 'electron'

/** Chromium's Linux format for data encrypted with the key built into it, not one from the keyring. */
const LINUX_FIXED_KEY_PREFIX = 'v10'

/**
 * Encrypts tokens and API keys with the system's key store (DPAPI on Windows, the Keychain on macOS,
 * the Secret Service on Linux). Without one nothing is stored: a secret never lands on disk in plain text.
 */
export async function encryptSecret(plain: string): Promise<string> {
  const unavailable = () =>
    new Error(
      process.platform === 'linux'
        ? 'Kein Schlüsselbund gefunden. Tokens und API-Keys speichert Nexa nur verschlüsselt: Richte GNOME Keyring oder KWallet ein und starte Nexa neu.'
        : 'Die sichere Speicherung des Betriebssystems ist nicht verfügbar.',
    )
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw unavailable()
  const encrypted = await safeStorage.encryptStringAsync(plain)
  // Without a reachable keyring Chromium encrypts with a fixed key ("v10"), as good as plain text.
  if (process.platform === 'linux' && encrypted.subarray(0, 3).toString('latin1') === LINUX_FIXED_KEY_PREFIX) throw unavailable()
  return encrypted.toString('base64')
}

export interface DecryptedSecret {
  plain: string
  /** Set when the system's key changed: this should be stored instead of the old value. */
  reEncrypted: string | null
}

/** `null` when it can't be decrypted (e.g. the file came from another Windows user). */
export async function decryptSecret(encrypted: string): Promise<DecryptedSecret | null> {
  let decrypted: Electron.DecryptStringAsyncReturnValue
  try {
    decrypted = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
  let reEncrypted: string | null = null
  if (decrypted.shouldReEncrypt) {
    try {
      reEncrypted = await encryptSecret(decrypted.result)
    } catch {
      // The old value still decrypts; it is kept.
    }
  }
  return { plain: decrypted.result, reEncrypted }
}
