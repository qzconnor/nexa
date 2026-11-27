import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Files of the app that the PWA of nexa-server copies byte for byte (its `scripts/sync-from-app.ts`),
 * so the connection, the rules for members, the chat's timeline and its diffs are the same in the
 * browser (`docs/NEXA-SERVER.md`, „PWA“). They may import from `@shared/…` (copied along), from the
 * packages named here, and relatively only what the PWA provides itself or another file of this list: a
 * `TypedEmitter` without `node:events`, `Identity` with its keys in IndexedDB, and the channel's error.
 * Moving one, or a new import, needs a word to nexa-server first.
 */
const COPIED: Record<string, { relative?: readonly string[]; packages?: readonly string[]; dynamic?: readonly string[] }> = {
  'src/main/server-link/connection.ts': { relative: ['../lib/typed-emitter'] },
  'src/main/server-link/device-channel.ts': { relative: ['./link-store'] },
  'src/main/server-link/membership.ts': { relative: ['./link-store'] },
  'src/main/remote/remote-client.ts': { relative: ['../lib/typed-emitter', '../server-link/device-channel'] },
  'src/renderer/src/lib/tools.ts': { packages: ['@lucide/vue', 'vue'] },
  'src/renderer/src/lib/pull-requests.ts': {},
  'src/renderer/src/lib/diff.ts': {},
  'src/renderer/src/lib/word-diff.ts': {},
  'src/renderer/src/lib/file-diff.ts': { relative: ['./word-diff'] },
  'src/renderer/src/lib/syntax.ts': {
    relative: ['./file-diff'],
    packages: ['highlight.js', 'highlight.js/lib/core'],
    dynamic: ['./hljs-vue', 'highlight.js/lib/languages/*'],
  },
  'src/renderer/src/lib/hljs-vue.ts': { packages: ['highlight.js'] },
  'src/renderer/src/composables/useProjectPath.ts': { packages: ['vue'] },
}

/** Only its types: the PWA's `Identity` is a type of its own. */
const TYPE_ONLY = new Set(['./link-store'])

/** The colours of tools the PWA has in its own `main.css`; a new one has to go there too. */
const PWA_TOOL_COLORS = new Set(['--tool-read', '--tool-search', '--tool-write', '--tool-run'])

/** What a browser hasn't got. */
const NODE_ONLY = [/\bprocess\./, /\bBuffer\b/, /\brequire\(/, /\bNodeJS\./, /\.unref\(/, /\b__dirname\b/]

const IMPORT = /^import\s+(type\s+)?[^;]*?\sfrom\s+'([^']+)'/gms

/** `import('…')` loads only what is named for the file; a trailing `*` stands for any rest of the path. */
const loadable = (patterns: readonly string[], from: string) =>
  patterns.some((p) => (p.endsWith('*') ? from.startsWith(p.slice(0, -1)) : from === p))

describe('files the PWA copies', () => {
  for (const [file, allowed] of Object.entries(COPIED)) {
    const text = readFileSync(join(process.cwd(), file), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    it(`${file} imports only what the PWA has`, () => {
      const imports = [...text.matchAll(IMPORT)].map((m) => ({ from: m[2]!, typeOnly: !!m[1] }))
      // Every import line read: one the pattern misses would go unchecked.
      expect(imports.length).toBe(text.match(/^import\b/gm)?.length ?? 0)
      for (const { from, typeOnly } of imports) {
        if (from.startsWith('@shared/')) continue
        expect([...(allowed.relative ?? []), ...(allowed.packages ?? [])], `${file}: import of '${from}'`).toContain(from)
        if (TYPE_ONLY.has(from)) expect(typeOnly, `${file}: '${from}' only as a type`).toBe(true)
      }
      for (const [, args] of code.matchAll(/\bimport\(([^)]*)\)/g)) {
        const from = /^\s*'([^']+)'\s*$/.exec(args!)?.[1]
        expect(from, `${file}: import(${args}) only with a fixed path`).toBeDefined()
        expect(loadable(allowed.dynamic ?? [], from!), `${file}: import('${from}')`).toBe(true)
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
