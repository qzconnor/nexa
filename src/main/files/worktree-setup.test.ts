import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeBaseRef, copyIncluded, includeMatcher, includePatterns, includePreview, inWorktreesFolder, parseIncludeRules, pickIncluded, reachesInto } from './worktree-setup'

const matcher = (text: string) => includeMatcher(parseIncludeRules(text))

describe('includeMatcher', () => {
  it('matches a name without a slash at any depth, one with a slash from the main checkout', () => {
    const takes = matcher('.env\n/config/secrets.json\n')
    expect(takes('.env', false)).toBe(true)
    expect(takes('apps/web/.env', false)).toBe(true)
    expect(takes('.env.local', false)).toBe(false)
    expect(takes('config/secrets.json', false)).toBe(true)
    expect(takes('apps/config/secrets.json', false)).toBe(false)
  })

  it('knows wildcards, character sets and double stars', () => {
    const takes = matcher('*.local\n.env.[dp]*\nvendor/**/config.json\n**/keys/*.pem\n')
    expect(takes('settings.local', false)).toBe(true)
    expect(takes('a/b/settings.local', false)).toBe(true)
    expect(takes('.env.dev', false)).toBe(true)
    expect(takes('.env.prod', false)).toBe(true)
    expect(takes('.env.test', false)).toBe(false)
    expect(takes('vendor/config.json', false)).toBe(true)
    expect(takes('vendor/a/b/config.json', false)).toBe(true)
    expect(takes('other/config.json', false)).toBe(false)
    expect(takes('deep/keys/id.pem', false)).toBe(true)
    expect(takes('keys/sub/id.pem', false)).toBe(false)
  })

  it('takes everything in a folder it takes, a trailing slash only for folders', () => {
    const takes = matcher('secrets/\n')
    expect(takes('secrets', true)).toBe(true)
    expect(takes('secrets/a/b.txt', false)).toBe(true)
    expect(takes('secrets', false)).toBe(false)
  })

  it('lets the last line decide, with ! taking a file out again', () => {
    const takes = matcher('*.json\n!package.json\n')
    expect(takes('a.json', false)).toBe(true)
    expect(takes('package.json', false)).toBe(false)
    expect(takes('sub/package.json', false)).toBe(false)
  })

  it('ignores case, comments, blank lines and trailing spaces, and reads escapes', () => {
    const takes = matcher('﻿# comment\n\n.ENV   \n\\#hash\n\\!bang\n')
    expect(takes('.env', false)).toBe(true)
    expect(takes('#hash', false)).toBe(true)
    expect(takes('!bang', false)).toBe(true)
    expect(takes('comment', false)).toBe(false)
    expect(includePatterns('# c\n\n  .env  \n')).toEqual(['.env'])
  })
})

describe('reachesInto', () => {
  const patterns = ['.env', 'vendor/**/config.json', '**/.claude/skills/*.md', 'config/secrets.json', 'tmp*/x', 'cache/']
  const reaches = (dir: string) => reachesInto(dir, patterns, matcher(patterns.join('\n')))

  it('searches a folder git ignores as a whole only when a pattern leads into it', () => {
    expect(reaches('node_modules/')).toBe(false)
    expect(reaches('vendor/')).toBe(true)
    expect(reaches('config/')).toBe(true)
    expect(reaches('tmp-build/')).toBe(true)
    expect(reaches('cache/')).toBe(true)
  })

  it('follows a leading double star only into folders named right after it', () => {
    expect(reaches('apps/web/.claude/')).toBe(true)
    expect(reaches('.CLAUDE/')).toBe(true)
    expect(reaches('apps/web/')).toBe(false)
  })
})

describe('pickIncluded', () => {
  it('takes the ignored files that match and lists only the folders a pattern reaches', async () => {
    const asked: string[][] = []
    const files = await pickIncluded(
      '.env\nconfig/secrets.json\n',
      ['.env', '.env.test', 'build.log', 'config/', 'node_modules/', '.claude/worktrees/', ''],
      async (dirs) => {
        asked.push(dirs)
        return ['config/secrets.json', 'config/other.json']
      },
    )
    expect(files).toEqual(['.env', 'config/secrets.json'])
    expect(asked).toEqual([['config/']])
  })

  it('never takes the worktrees themselves', async () => {
    const files = await pickIncluded('.claude/\n', ['.claude/'], async () => ['.claude/settings.local.json', '.claude/worktrees/a/.env'])
    expect(files).toEqual(['.claude/settings.local.json'])
    expect(inWorktreesFolder('.claude/worktrees/x/y')).toBe(true)
    expect(inWorktreesFolder('.claude/settings.json')).toBe(false)
  })

  it('is null without patterns', async () => {
    expect(await pickIncluded('# nothing\n\n', ['.env'], async () => [])).toBeNull()
  })
})

describe('copying into a worktree', () => {
  let dir: string
  let from: string
  let to: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-include-'))
    from = join(dir, 'main')
    to = join(dir, 'worktree')
    await mkdir(join(from, 'config'), { recursive: true })
    await mkdir(to)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
  })

  it('copies files into new folders, never over a file the checkout has', async () => {
    await writeFile(join(from, '.env'), 'new')
    await writeFile(join(from, 'config', 'secrets.json'), '{}')
    await writeFile(join(to, '.env'), 'tracked')
    const result = await copyIncluded(from, to, ['.env', 'config/secrets.json', 'missing.txt'])
    expect(result.copied).toEqual(['config/secrets.json'])
    expect(result.skipped).toEqual(['.env'])
    expect(result.failed.map((f) => f.path)).toEqual(['missing.txt'])
    expect(await readFile(join(to, '.env'), 'utf8')).toBe('tracked')
    expect(await readFile(join(to, 'config', 'secrets.json'), 'utf8')).toBe('{}')
  })

  it('doesn’t write through a link in the worktree, nor take paths out of it', async () => {
    const outside = join(dir, 'outside')
    await mkdir(outside)
    // A junction needs no rights on Windows; elsewhere it is a plain symlink.
    await symlink(outside, join(to, 'config'), 'junction')
    await writeFile(join(from, 'config', 'secrets.json'), '{}')
    const result = await copyIncluded(from, to, ['config/secrets.json', '../escape.txt', 'a//b'])
    expect(result.copied).toEqual([])
    expect(result.skipped.sort()).toEqual(['../escape.txt', 'a//b', 'config/secrets.json'])
    expect(existsSync(join(outside, 'secrets.json'))).toBe(false)
  })

  it('leaves out links in the main checkout', async () => {
    await mkdir(join(dir, 'elsewhere'))
    await writeFile(join(dir, 'elsewhere', 'secret.txt'), 'x')
    await symlink(join(dir, 'elsewhere'), join(from, 'linked'), 'junction')
    const result = await copyIncluded(from, to, ['linked'])
    expect(result.skipped).toEqual(['linked'])
    expect(existsSync(join(to, 'linked'))).toBe(false)
  })

  it('previews how many files and how big', async () => {
    await writeFile(join(from, '.env'), '12345')
    await writeFile(join(from, 'config', 'secrets.json'), '{}')
    expect(await includePreview(from, ['.env', 'config/secrets.json'])).toEqual({ files: 2, sample: ['.env', 'config/secrets.json'], bytes: 7 })
    const many = Array.from({ length: 2001 }, (_, i) => `f${i}`)
    expect(await includePreview(from, many)).toMatchObject({ files: 2001, bytes: null })
  })

  it('reads worktree.baseRef from the local, project and user settings of Claude Code', async () => {
    const user = join(dir, 'user')
    await mkdir(join(from, '.claude'), { recursive: true })
    await mkdir(user)
    expect(await claudeBaseRef(from, user)).toBe('fresh')
    await writeFile(join(user, 'settings.json'), JSON.stringify({ worktree: { baseRef: 'head' } }))
    expect(await claudeBaseRef(from, user)).toBe('head')
    await writeFile(join(from, '.claude', 'settings.json'), JSON.stringify({ worktree: { baseRef: 'fresh' } }))
    expect(await claudeBaseRef(from, user)).toBe('fresh')
    await writeFile(join(from, '.claude', 'settings.local.json'), '{ not json')
    expect(await claudeBaseRef(from, user)).toBe('fresh')
    await writeFile(join(from, '.claude', 'settings.local.json'), JSON.stringify({ worktree: { baseRef: 'head' } }))
    expect(await claudeBaseRef(from, user)).toBe('head')
  })
})
