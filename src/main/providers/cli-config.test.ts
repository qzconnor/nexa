import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanList, entriesIn, entriesOut, hookConfigsOut, hookGroupsIn, isSecretEntry, readJsonFile, updateJsonFile, versionOf, withHookEvent } from './cli-config'

describe('isSecretEntry', () => {
  it('knows secrets by name and shape', () => {
    expect(isSecretEntry('API_KEY', 'abc123')).toBe(true)
    expect(isSecretEntry('GITHUB_TOKEN', 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(isSecretEntry('Authorization', 'Bearer xyz')).toBe(true)
    expect(isSecretEntry('X-Api-Key', 'k1')).toBe(true)
    expect(isSecretEntry('SOMETHING', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaa')).toBe(true)
  })

  it('leaves plain values and references to variables', () => {
    expect(isSecretEntry('NODE_ENV', 'production')).toBe(false)
    expect(isSecretEntry('DEBUG', '1')).toBe(false)
    expect(isSecretEntry('GITHUB_TOKEN', '${GITHUB_TOKEN}')).toBe(false)
    expect(isSecretEntry('Authorization', '')).toBe(false)
  })
})

describe('entriesOut / entriesIn', () => {
  it('withholds secrets and keeps them on saving', () => {
    const stored = { API_KEY: 'sk-secret', REGION: 'eu' }
    const out = entriesOut(stored)!
    expect(out).toEqual([
      { name: 'API_KEY', value: '', masked: true },
      { name: 'REGION', value: 'eu' },
    ])
    expect(entriesIn([...out, { name: 'NEW', value: 'x' }], stored)).toEqual({ API_KEY: 'sk-secret', REGION: 'eu', NEW: 'x' })
  })

  it('takes a new value for a masked one only when typed, and fails for one never stored', () => {
    expect(entriesIn([{ name: 'API_KEY', value: 'new' }], { API_KEY: 'old' })).toEqual({ API_KEY: 'new' })
    expect(() => entriesIn([{ name: 'API_KEY', value: '', masked: true }], {})).toThrow('API_KEY')
    expect(entriesIn([], { A: '1' })).toBeUndefined()
  })
})

describe('hooks', () => {
  const raw = {
    PreToolUse: [
      {
        matcher: 'Bash',
        extra: 1,
        hooks: [
          { type: 'command', command: 'echo a', timeout: 5, statusMessage: 'Prüfe' },
          { type: 'prompt', prompt: 'Ist das sicher?\nZweite Zeile' },
        ],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    state: { x: 1 },
  }

  it('reads groups by event in the order given, with where each hook was', () => {
    const configs = hookConfigsOut(raw, ['Stop', 'PreToolUse'])
    expect(configs.map((c) => c.event)).toEqual(['Stop', 'PreToolUse'])
    expect(configs[1].groups[0]).toEqual({
      matcher: 'Bash',
      origin: 0,
      hooks: [
        { type: 'command', command: 'echo a', timeout: 5, origin: { group: 0, index: 0 } },
        { type: 'prompt', summary: 'Ist das sicher?', timeout: undefined, origin: { group: 0, index: 1 } },
      ],
    })
  })

  it('writes the groups back over what they were, keeping what Nexa does not edit', () => {
    const [, pre] = hookConfigsOut(raw, ['Stop', 'PreToolUse'])
    const groups = pre.groups.map((g) => ({ ...g, hooks: g.hooks.map((h) => (h.type === 'command' ? { ...h, command: 'echo b', timeout: undefined } : h)) }))
    expect(hookGroupsIn(groups, raw.PreToolUse)).toEqual([
      {
        matcher: 'Bash',
        extra: 1,
        hooks: [
          { type: 'command', command: 'echo b', statusMessage: 'Prüfe' },
          { type: 'prompt', prompt: 'Ist das sicher?\nZweite Zeile' },
        ],
      },
    ])
  })

  it('adds new hooks, moves one to another matcher and drops empty groups', () => {
    const groups = [
      { matcher: 'Bash', origin: 0, hooks: [] },
      { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo a', origin: { group: 0, index: 0 } }, { type: 'command', command: 'lint', timeout: 30 }] },
    ]
    expect(hookGroupsIn(groups, raw.PreToolUse)).toEqual([
      {
        matcher: 'Edit',
        hooks: [
          { type: 'command', command: 'echo a', statusMessage: 'Prüfe' },
          { type: 'command', command: 'lint', timeout: 30 },
        ],
      },
    ])
  })

  it('refuses a hook without a command or with a bad timeout', () => {
    expect(() => hookGroupsIn([{ matcher: null, hooks: [{ type: 'command', command: ' ' }] }], [])).toThrow('Befehl')
    expect(() => hookGroupsIn([{ matcher: null, hooks: [{ type: 'command', command: 'x', timeout: -1 }] }], [])).toThrow('Zeitgrenze')
  })

  it('replaces one event and drops what is empty', () => {
    expect(withHookEvent({ Stop: [1] }, 'Stop', [])).toBeUndefined()
    expect(withHookEvent({ Stop: [1], A: [2] }, 'Stop', [])).toEqual({ A: [2] })
    expect(withHookEvent(undefined, 'Stop', [{ hooks: [] }])).toEqual({ Stop: [{ hooks: [] }] })
  })

  it('versions what was read', () => {
    expect(versionOf(raw)).toBe(versionOf(JSON.parse(JSON.stringify(raw))))
    expect(versionOf(raw)).not.toBe(versionOf({}))
    expect(versionOf(undefined)).toBe(versionOf(null))
  })
})

describe('cleanList', () => {
  it('drops empty lines and doubles', () => {
    expect(cleanList([' a ', '', 'b', 'a'])).toEqual(['a', 'b'])
    expect(cleanList(null)).toEqual([])
  })
})

describe('JSON files', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-cli-config-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a missing file as null and refuses a broken one', async () => {
    expect(await readJsonFile(join(dir, 'none.json'))).toBeNull()
    await writeFile(join(dir, 'bad.json'), '{ // comment\n}')
    await expect(readJsonFile(join(dir, 'bad.json'))).rejects.toThrow('kein gültiges JSON')
    await writeFile(join(dir, 'list.json'), '[1]')
    await expect(readJsonFile(join(dir, 'list.json'))).rejects.toThrow('kein JSON-Objekt')
  })

  it('changes a file and keeps its other keys, and leaves a broken one alone', async () => {
    const file = join(dir, 'settings.json')
    await writeFile(file, '﻿{"model":"opus","permissions":{"allow":["Bash"]}}')
    await updateJsonFile(file, (data) => {
      data.hooks = { Stop: [] }
    })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ model: 'opus', permissions: { allow: ['Bash'] }, hooks: { Stop: [] } })
    await writeFile(file, '{ broken')
    await expect(updateJsonFile(file, () => undefined)).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{ broken')
  })
})
