import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Files of the app that the PWA of nexa-server copies byte for byte (its `scripts/sync-from-app.ts`),
 * so the connection, the rules for members and the chat's timeline are the same in the browser
 * (`docs/NEXA-SERVER.md`, „PWA“). They may import from `@shared/…` (copied along), from the packages
 * named here, and relatively only what the PWA provides itself: a `TypedEmitter` without
 * `node:events`, `Identity` with its keys in IndexedDB, and the channel's error. Moving one, or a new
 * import, needs a word to nexa-server first.
 */
const COPIED: Record<string, { relative?: readonly string[]; packages?: readonly string[] }> = {
  'src/main/server-link/connection.ts': { relative: ['../lib/typed-emitter'] },
  'src/main/server-link/device-channel.ts': { relative: ['./link-store'] },
  'src/main/server-link/membership.ts': { relative: ['./link-store'] },
  'src/main/remote/remote-client.ts': { relative: ['../lib/typed-emitter', '../server-link/device-channel'] },
  'src/renderer/src/lib/tools.ts': { packages: ['@lucide/vue', 'vue'] },
}

/** Only their types: the PWA's `Identity` is a type of its own, and no Vue code is copied along. */
const TYPE_ONLY = new Set(['./link-store', 'vue'])

/** The colours of tools the PWA has in its own `main.css`; a new one has to go there too. */
const PWA_TOOL_COLORS = new Set(['--tool-read', '--tool-search', '--tool-write', '--tool-run'])

/** What a browser hasn't got. */
const NODE_ONLY = [/\bprocess\./, /\bBuffer\b/, /\brequire\(/, /\bNodeJS\./, /\.unref\(/, /\b__dirname\b/, /\bimport\(/]

const IMPORT = /^import\s+(type\s+)?[^;]*?\sfrom\s+'([^']+)'/gms

describe('files the PWA copies', () => {
  for (const [file, allowed] of Object.entries(COPIED)) {
    const text = readFileSync(join(process.cwd(), file), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    it(`${file} imports only what the PWA has`, () => {
      const imports = [...text.matchAll(IMPORT)].map((m) => ({ from: m[2]!, typeOnly: !!m[1] }))
      expect(imports.length).toBeGreaterThan(0)
      for (const { from, typeOnly } of imports) {
        if (from.startsWith('@shared/')) continue
        expect([...(allowed.relative ?? []), ...(allowed.packages ?? [])], `${file}: import of '${from}'`).toContain(from)
        if (TYPE_ONLY.has(from)) expect(typeOnly, `${file}: '${from}' only as a type`).toBe(true)
      }
    })

    it(`${file} uses no Node APIs`, () => {
      for (const pattern of NODE_ONLY) expect(code, `${file}: ${pattern}`).not.toMatch(pattern)
    })

    it(`${file} uses only the tool colours the PWA has`, () => {
      for (const [color] of code.matchAll(/--tool-[a-z-]+/g)) expect([...PWA_TOOL_COLORS], `${file}: ${color} (tell nexa-server)`).toContain(color)
    })
  }
})
