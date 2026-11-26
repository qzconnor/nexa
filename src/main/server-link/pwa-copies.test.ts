import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Files of main that the PWA of nexa-server copies byte for byte (its `scripts/sync-from-app.ts`), so
 * the connection and the rules for members are the same in the browser (`docs/NEXA-SERVER.md`, „PWA“).
 * They may import from `@shared/…` (copied along), and relatively only what the PWA provides itself: a
 * `TypedEmitter` without `node:events`, `Identity` with its keys in IndexedDB, and the channel's error.
 * Moving one, or a new relative import, needs a word to nexa-server first.
 */
const COPIED: Record<string, readonly string[]> = {
  'src/main/server-link/connection.ts': ['../lib/typed-emitter'],
  'src/main/server-link/device-channel.ts': ['./link-store'],
  'src/main/server-link/membership.ts': ['./link-store'],
  'src/main/remote/remote-client.ts': ['../lib/typed-emitter', '../server-link/device-channel'],
}

/** Only its type: the PWA's `Identity` is a type of its own. */
const TYPE_ONLY = new Set(['./link-store'])

/** What a browser hasn't got. */
const NODE_ONLY = [/\bprocess\./, /\bBuffer\b/, /\brequire\(/, /\bNodeJS\./, /\.unref\(/, /\b__dirname\b/, /\bimport\(/]

const IMPORT = /^import\s+(type\s+)?[^;]*?\sfrom\s+'([^']+)'/gms

describe('files the PWA copies', () => {
  for (const [file, relative] of Object.entries(COPIED)) {
    const text = readFileSync(join(process.cwd(), file), 'utf8')

    it(`${file} imports only what the PWA has`, () => {
      const imports = [...text.matchAll(IMPORT)].map((m) => ({ from: m[2]!, typeOnly: !!m[1] }))
      expect(imports.length).toBeGreaterThan(0)
      for (const { from, typeOnly } of imports) {
        if (from.startsWith('@shared/')) continue
        expect(relative, `${file}: import of '${from}'`).toContain(from)
        if (TYPE_ONLY.has(from)) expect(typeOnly, `${file}: '${from}' only as a type`).toBe(true)
      }
    })

    it(`${file} uses no Node APIs`, () => {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const pattern of NODE_ONLY) expect(code, `${file}: ${pattern}`).not.toMatch(pattern)
    })
  }
})
