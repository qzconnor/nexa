import { describe, expect, it } from 'vitest'
import type { HookGroup } from '@shared/cli-config'
import { addHook, normalMatcher, removeHook, updateHook } from './cli-hooks'

const trust = { status: 'trusted' as const, key: 'k', hash: 'sha256:a' }
const groups: HookGroup[] = [
  { matcher: 'Bash', origin: 0, hooks: [{ type: 'command', command: 'a', origin: { group: 0, index: 0 }, trust }] },
  { matcher: null, origin: 1, hooks: [{ type: 'command', command: 'b', origin: { group: 1, index: 0 } }] },
]

describe('cli-hooks', () => {
  it('takes an empty matcher as none', () => {
    expect(normalMatcher('  ')).toBeNull()
    expect(normalMatcher(' Bash ')).toBe('Bash')
  })

  it('adds a hook to the group of its matcher, or a new group, without trust', () => {
    const same = addHook(groups, ' Bash', { type: 'command', command: 'c' })
    expect(same[0]?.hooks.map((h) => h.command)).toEqual(['a', 'c'])
    expect(same[0]?.hooks[0]?.trust).toBeUndefined()
    const other = addHook(groups, 'Edit', { type: 'command', command: 'd' })
    expect(other.at(-1)).toEqual({ matcher: 'Edit', hooks: [{ type: 'command', command: 'd' }] })
    expect(groups[0]?.hooks).toHaveLength(1)
  })

  it('removes a hook and the group it leaves empty', () => {
    expect(removeHook(groups, { group: 0, index: 0 }).map((g) => g.origin)).toEqual([1])
  })

  it('changes a hook in place, or moves it with its origin to another matcher', () => {
    const inPlace = updateHook(groups, { group: 1, index: 0 }, '', { type: 'command', command: 'b2', timeout: 5 })
    expect(inPlace[1]?.hooks[0]).toEqual({ type: 'command', command: 'b2', timeout: 5, origin: { group: 1, index: 0 } })
    const moved = updateHook(groups, { group: 0, index: 0 }, null, { type: 'command', command: 'a' })
    expect(moved).toEqual([
      {
        matcher: null,
        origin: 1,
        hooks: [
          { type: 'command', command: 'b', origin: { group: 1, index: 0 } },
          { type: 'command', command: 'a', origin: { group: 0, index: 0 } },
        ],
      },
    ])
  })
})
