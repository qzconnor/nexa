import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitBranch } from '@shared/files'
import { claudeWorktrees, GitService, parseWorktrees, pullRequestUrl, repoWebUrl } from './git-service'

const HASH = '0123456789abcdef0123456789abcdef01234567'

let dir: string
let service: GitService

/** Runs git without the user's configuration getting in the way (templates, hooks, default branch). */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args], {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'no-gitconfig') },
  })
}

async function repo(name = 'repo'): Promise<string> {
  const path = join(dir, name)
  await mkdir(path, { recursive: true })
  git(path, 'init', '-q')
  return path
}

/** A repository on `main` with `a.txt` and the empty folder `src` in its one commit's checkout. */
async function committed(): Promise<string> {
  const path = await repo()
  await writeFile(join(path, 'a.txt'), 'a')
  await mkdir(join(path, 'src'))
  git(path, 'add', '.')
  git(path, 'commit', '-qm', 'init')
  return path
}

/** Git names the real path: on CI runners the temp folder comes as a short name (`RUNNER~1`). */
const same = (p: string) => realpathSync.native(p).replaceAll('\\', '/').toLowerCase()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cm-test-'))
  // GitService runs git with this environment: no repository above the temp folder, none set by a git hook.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir())
  vi.stubEnv('GIT_DIR', undefined)
  vi.stubEnv('GIT_WORK_TREE', undefined)
  service = new GitService()
})

afterEach(async () => {
  service.dispose()
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

describe('GitService.branch', () => {
  it('reads the checked-out branch', async () => {
    const path = await repo()
    expect(await service.branch(path)).toEqual({ name: 'main', detached: false })
  })

  it('keeps slashes in branch names', async () => {
    const path = await repo()
    git(path, 'symbolic-ref', 'HEAD', 'refs/heads/feature/login-flow')
    expect(await service.branch(path)).toEqual({ name: 'feature/login-flow', detached: false })
  })

  it('finds the repository from a subfolder', async () => {
    const path = await repo()
    const sub = join(path, 'src', 'deep')
    await mkdir(sub, { recursive: true })
    expect(await service.branch(sub)).toEqual({ name: 'main', detached: false })
  })

  it('shows a detached HEAD as the short commit hash', async () => {
    const path = await repo()
    await writeFile(join(path, '.git', 'HEAD'), `${HASH}\n`)
    expect(await service.branch(path)).toEqual({ name: '0123456', detached: true })
  })

  it('asks git for the branch with reftable refs, whose HEAD only stands in', async () => {
    const path = join(dir, 'reftable')
    await mkdir(path)
    try {
      git(path, 'init', '-q', '--ref-format=reftable')
    } catch {
      // git before 2.45 has no reftable.
      return
    }
    expect(await service.branch(path)).toEqual({ name: 'main', detached: false })
    git(path, 'symbolic-ref', 'HEAD', 'refs/heads/feature')
    expect(await service.branch(path)).toEqual({ name: 'feature', detached: false })
  })

  it('follows a .git file to the repository elsewhere', async () => {
    const path = join(dir, 'work')
    await mkdir(path)
    git(path, 'init', '-q', '--separate-git-dir', join(dir, 'store.git'))
    git(path, 'symbolic-ref', 'HEAD', 'refs/heads/separate')
    expect(await service.branch(path)).toEqual({ name: 'separate', detached: false })
  })

  it('reads the branch of a worktree, not the one of the main checkout', async () => {
    const main = await repo('main')
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(main, 'worktree', 'add', '-q', '-b', 'side', join(dir, 'side'))
    expect(await service.branch(join(dir, 'side'))).toEqual({ name: 'side', detached: false })
    expect(await service.branch(main)).toEqual({ name: 'main', detached: false })
  })

  it('is null outside a repository and for a missing folder', async () => {
    expect(await service.branch(dir)).toBeNull()
    expect(await service.branch(join(dir, 'missing'))).toBeNull()
  })

  it('notices a folder that became a repository later', async () => {
    const path = join(dir, 'later')
    await mkdir(path)
    expect(await service.branch(path)).toBeNull()
    git(path, 'init', '-q')
    expect(await service.branch(path)).toEqual({ name: 'main', detached: false })
  })

  it('is null for a HEAD it cannot read', async () => {
    const path = await repo()
    expect(await service.branch(path)).not.toBeNull()
    // The repository is known now; its HEAD goes missing.
    await rm(join(path, '.git', 'HEAD'))
    expect(await service.branch(path)).toBeNull()
  })

  it('reports a checkout in the watched repository', async () => {
    const path = await repo()
    const changes: [string, GitBranch | null][] = []
    service.on('changed', (cwd, branch) => changes.push([cwd, branch]))
    await service.watch([path])
    await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/next\n')
    await expect.poll(() => changes.at(-1), { timeout: 5000 }).toEqual([path, { name: 'next', detached: false }])
  })

  it('watches several repositories at once', async () => {
    const first = await repo('first')
    const second = await repo('second')
    const changes: [string, GitBranch | null][] = []
    service.on('changed', (cwd, branch) => changes.push([cwd, branch]))
    await service.watch([first, second])
    await writeFile(join(first, '.git', 'HEAD'), 'ref: refs/heads/one\n')
    await writeFile(join(second, '.git', 'HEAD'), 'ref: refs/heads/two\n')
    await expect
      .poll(() => new Map(changes), { timeout: 5000 })
      .toEqual(
        new Map([
          [first, { name: 'one', detached: false }],
          [second, { name: 'two', detached: false }],
        ]),
      )
  })

  it('reports to every folder of the same repository', async () => {
    const path = await repo()
    const sub = join(path, 'packages', 'app')
    await mkdir(sub, { recursive: true })
    const changes: [string, GitBranch | null][] = []
    service.on('changed', (cwd, branch) => changes.push([cwd, branch]))
    await service.watch([path, sub])
    await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/next\n')
    await expect.poll(() => changes.map(([cwd]) => cwd).sort(), { timeout: 5000 }).toEqual([path, sub].sort())
  })

  it('stops watching the folders left out of the next call', async () => {
    const kept = await repo('kept')
    const dropped = await repo('dropped')
    const changes: [string, GitBranch | null][] = []
    service.on('changed', (cwd, branch) => changes.push([cwd, branch]))
    await service.watch([kept, dropped])
    await service.watch([kept])
    await writeFile(join(dropped, '.git', 'HEAD'), 'ref: refs/heads/gone\n')
    await writeFile(join(kept, '.git', 'HEAD'), 'ref: refs/heads/next\n')
    await expect.poll(() => changes.at(-1), { timeout: 5000 }).toEqual([kept, { name: 'next', detached: false }])
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(changes.map(([cwd]) => cwd)).not.toContain(dropped)
  })

  it('picks up a folder that becomes a repository (git init)', async () => {
    const path = join(dir, 'later')
    await mkdir(path)
    const changes: [string, GitBranch | null][] = []
    service.on('changed', (cwd, branch) => changes.push([cwd, branch]))
    await service.watch([path])
    git(path, 'init', '-q')
    await expect.poll(() => changes[0], { timeout: 5000 }).toEqual([path, { name: 'main', detached: false }])
    // From now on its checkouts are reported too, once it is watched.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/next\n')
    await expect.poll(() => changes.at(-1), { timeout: 3000 }).toEqual([path, { name: 'next', detached: false }])
  }, 10_000)

  it('stops reporting after dispose', async () => {
    const path = await repo()
    const changes: unknown[] = []
    service.on('changed', (...args) => changes.push(args))
    await service.watch([path])
    service.dispose()
    await writeFile(join(path, '.git', 'HEAD'), 'ref: refs/heads/next\n')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(changes).toEqual([])
  })
})

describe('worktreeCheck', () => {
  it('needs a repository', async () => {
    const plain = join(dir, 'plain')
    await mkdir(plain)
    expect(await service.worktreeCheck(plain)).toEqual({ ok: false, reason: 'Der Ordner liegt in keinem Git-Repository.' })
    expect(await service.worktreeCheck(join(dir, 'missing'))).toEqual({ ok: false, reason: 'Den Ordner gibt es nicht.' })
  })

  it('needs a commit to branch from', async () => {
    const path = await repo()
    expect(await service.worktreeCheck(path)).toMatchObject({ ok: false, reason: expect.stringContaining('keinen Commit') })
  })

  it("names the root, what a worktree starts from and the worktrees and branches made there", async () => {
    const path = await committed()
    git(path, 'worktree', 'add', '-q', '-b', 'worktree-login', join(path, '.claude', 'worktrees', 'login'))
    git(path, 'worktree', 'add', '-q', '-b', 'elsewhere', join(dir, 'elsewhere'))
    git(path, 'branch', 'worktree-kept')
    const check = await service.worktreeCheck(join(path, '.claude'))
    expect(check).toMatchObject({ ok: true, existing: ['login'], branches: ['kept'], base: { name: 'main', detached: false }, ignored: false })
    expect(check.ok && same(check.root)).toBe(same(path))
  })

  it('knows whether git ignores the worktrees', async () => {
    const path = await committed()
    await writeFile(join(path, '.gitignore'), '.claude/worktrees/\n')
    expect(await service.worktreeCheck(path)).toMatchObject({ ok: true, ignored: true })
  })

  it('names the main checkout from a worktree too, and that worktree as what a new one starts from', async () => {
    const path = await committed()
    git(path, 'worktree', 'add', '-q', '-b', 'side', join(dir, 'side'))
    const check = await service.worktreeCheck(join(dir, 'side'))
    expect(check).toMatchObject({ ok: true, base: { name: 'side', detached: false } })
    expect(check.ok && same(check.root)).toBe(same(path))
  })
})

describe('GitService.addWorktree', () => {
  it('makes it where Claude Code would, on a branch of its own from the HEAD of the folder', async () => {
    const path = await committed()
    const added = await service.addWorktree(join(path, 'src'), 'login')
    expect(same(added.path)).toBe(same(join(path, '.claude', 'worktrees', 'login')))
    expect(added.branch).toBe('worktree-login')
    expect(same(added.root)).toBe(same(path))
    expect(await service.branch(added.path)).toEqual({ name: 'worktree-login', detached: false })
    expect(await readFile(join(added.path, 'a.txt'), 'utf8')).toBe('a')
  })

  it('enters one of the same name again, with what is in it', async () => {
    const path = await committed()
    const first = await service.addWorktree(path, 'login')
    await writeFile(join(first.path, 'wip.txt'), 'work')
    const again = await service.addWorktree(path, 'login')
    expect(same(again.path)).toBe(same(first.path))
    expect(again.branch).toBe('worktree-login')
    expect(await readFile(join(again.path, 'wip.txt'), 'utf8')).toBe('work')
  })

  it('goes on with the branch of a worktree that is gone', async () => {
    const path = await committed()
    git(path, 'checkout', '-q', '-b', 'worktree-kept')
    await writeFile(join(path, 'kept.txt'), 'kept')
    git(path, 'add', '.')
    git(path, 'commit', '-qm', 'kept')
    git(path, 'checkout', '-q', 'main')
    const added = await service.addWorktree(path, 'kept')
    expect(await service.branch(added.path)).toEqual({ name: 'worktree-kept', detached: false })
    expect(await readFile(join(added.path, 'kept.txt'), 'utf8')).toBe('kept')
  })

  it('makes up a name when there is none', async () => {
    const path = await committed()
    const added = await service.addWorktree(path, ' ')
    expect(added.branch).toMatch(/^worktree-[a-z]+-[a-z]+-[a-z]+$/)
    expect(existsSync(join(added.path, 'a.txt'))).toBe(true)
  })

  it('lies beside a worktree it is made from, from that worktree’s state', async () => {
    const path = await committed()
    const first = await service.addWorktree(path, 'one')
    await writeFile(join(first.path, 'b.txt'), 'b')
    git(first.path, 'add', '.')
    git(first.path, 'commit', '-qm', 'b')
    const second = await service.addWorktree(first.path, 'two')
    expect(same(second.path)).toBe(same(join(path, '.claude', 'worktrees', 'two')))
    expect(await readFile(join(second.path, 'b.txt'), 'utf8')).toBe('b')
  })

  it('refuses names git or the file system would not take, and folders that are no worktree', async () => {
    const path = await committed()
    await expect(service.addWorktree(path, '../x')).rejects.toThrow('Nur Buchstaben')
    await mkdir(join(path, '.claude', 'worktrees', 'taken'), { recursive: true })
    await expect(service.addWorktree(path, 'taken')).rejects.toThrow('nicht als Worktree')
    await expect(service.addWorktree(await repo('empty'), 'x')).rejects.toThrow('keinen Commit')
  })

  it("doesn't run the repository's own filters on the files it checks out", async () => {
    const path = await committed()
    await writeFile(join(path, '.gitattributes'), '*.txt filter=evil\n')
    git(path, 'add', '.')
    git(path, 'commit', '-qm', 'attributes')
    const marker = join(dir, 'smudged').replaceAll('\\', '/')
    git(path, 'config', 'filter.evil.smudge', `echo x > "${marker}"; cat`)
    await service.addWorktree(path, 'safe')
    expect(existsSync(marker)).toBe(false)
    // git itself would have run it.
    git(path, 'worktree', 'add', '-q', '-b', 'plain', join(dir, 'plain'))
    expect(existsSync(marker)).toBe(true)
  })
})

describe('GitService.removeWorktree', () => {
  const hasBranch = (path: string, name: string) => {
    try {
      git(path, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)
      return true
    } catch {
      return false
    }
  }

  it('removes one without new work, with its branch and the files git ignores', async () => {
    const path = await committed()
    await writeFile(join(path, '.gitignore'), 'build/\n')
    git(path, 'add', '.')
    git(path, 'commit', '-qm', 'ignore')
    const added = await service.addWorktree(path, 'done')
    await mkdir(join(added.path, 'build'))
    await writeFile(join(added.path, 'build', 'out.js'), 'x')
    expect(await service.removeWorktree(added.path, added.branch)).toBeNull()
    expect(existsSync(added.path)).toBe(false)
    expect(hasBranch(path, 'worktree-done')).toBe(false)
  })

  it('keeps one with changed or new files', async () => {
    const path = await committed()
    const added = await service.addWorktree(path, 'wip')
    await writeFile(join(added.path, 'a.txt'), 'changed')
    expect(await service.removeWorktree(added.path, added.branch)).toBe('Darin sind Änderungen, die noch nicht committet sind.')
    git(added.path, 'checkout', '-q', '--', 'a.txt')
    await writeFile(join(added.path, 'new.txt'), 'new')
    expect(await service.removeWorktree(added.path, added.branch)).toContain('Änderungen')
    expect(existsSync(join(added.path, 'new.txt'))).toBe(true)
  })

  it('keeps one whose branch has commits of its own, until another branch has them', async () => {
    const path = await committed()
    const added = await service.addWorktree(path, 'feature')
    await writeFile(join(added.path, 'f.txt'), 'f')
    git(added.path, 'add', '.')
    git(added.path, 'commit', '-qm', 'feature')
    expect(await service.removeWorktree(added.path, added.branch)).toBe('Sein Branch „worktree-feature“ hat Commits, die auf keinem anderen Branch sind.')
    expect(hasBranch(path, 'worktree-feature')).toBe(true)
    git(path, 'merge', '-q', '--ff-only', 'worktree-feature')
    expect(await service.removeWorktree(added.path, added.branch)).toBeNull()
    expect(existsSync(added.path)).toBe(false)
    expect(hasBranch(path, 'worktree-feature')).toBe(false)
  })

  it('removes the worktree but keeps its branch when another branch is checked out there', async () => {
    const path = await committed()
    const added = await service.addWorktree(path, 'moved')
    await writeFile(join(added.path, 'm.txt'), 'm')
    git(added.path, 'add', '.')
    git(added.path, 'commit', '-qm', 'moved')
    git(added.path, 'checkout', '-q', '-b', 'other', 'main')
    expect(await service.removeWorktree(added.path, added.branch)).toContain('sein Branch „worktree-moved“ bleibt')
    expect(existsSync(added.path)).toBe(false)
    expect(hasBranch(path, 'worktree-moved')).toBe(true)
    expect(hasBranch(path, 'other')).toBe(true)
  })

  it('leaves alone what is gone, a main checkout and a folder outside every repository', async () => {
    const path = await committed()
    expect(await service.removeWorktree(join(dir, 'gone'), 'worktree-gone')).toBeNull()
    expect(await service.removeWorktree(path, 'main')).toBeNull()
    expect(existsSync(join(path, 'a.txt'))).toBe(true)
    await mkdir(join(dir, 'plain'))
    expect(await service.removeWorktree(join(dir, 'plain'), 'x')).toBeNull()
    expect(existsSync(join(dir, 'plain'))).toBe(true)
  })
})

describe('GitService.mainWorktree', () => {
  it('names the main checkout of a linked worktree, also from a subfolder', async () => {
    const main = await repo('main')
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(main, 'worktree', 'add', '-q', '-b', 'side', join(dir, 'side'))
    await mkdir(join(dir, 'side', 'src'))
    // Git names the real path (see worktreeCheck).
    const same = (p: string | null) => p && realpathSync.native(p).replaceAll('\\', '/').toLowerCase()
    expect(same(await service.mainWorktree(join(dir, 'side')))).toBe(same(main))
    expect(same(await service.mainWorktree(join(dir, 'side', 'src')))).toBe(same(main))
  })

  it('is null in the main checkout, outside a repository and for a separate git directory', async () => {
    const main = await repo('main')
    expect(await service.mainWorktree(main)).toBeNull()
    expect(await service.mainWorktree(dir)).toBeNull()
    const separate = join(dir, 'separate')
    await mkdir(separate)
    git(separate, 'init', '-q', '--separate-git-dir', join(dir, 'store.git'))
    expect(await service.mainWorktree(separate)).toBeNull()
  })
})

describe('GitService.webUrl', () => {
  it('opens the page of origin', async () => {
    const path = await repo()
    git(path, 'remote', 'add', 'origin', 'git@github.com:owner/app.git')
    expect(await service.webUrl(path)).toBe('https://github.com/owner/app')
  })

  it('takes the only remote when there is no origin', async () => {
    const path = await repo()
    git(path, 'remote', 'add', 'upstream', 'https://gitlab.com/group/app.git')
    expect(await service.webUrl(path)).toBe('https://gitlab.com/group/app')
  })

  it('is null without a remote, outside a repository and for a local remote', async () => {
    const path = await repo()
    expect(await service.webUrl(path)).toBeNull()
    expect(await service.webUrl(dir)).toBeNull()
    git(path, 'remote', 'add', 'origin', join(dir, 'elsewhere'))
    expect(await service.webUrl(path)).toBeNull()
  })
})

describe('repoWebUrl', () => {
  it.each([
    ['https://github.com/owner/app.git', 'https://github.com/owner/app'],
    ['https://github.com/owner/app', 'https://github.com/owner/app'],
    ['https://github.com/owner/app/', 'https://github.com/owner/app'],
    ['https://user:token@github.com/owner/app.git', 'https://github.com/owner/app'],
    ['http://git.local:8080/team/app.git', 'http://git.local:8080/team/app'],
    ['git@github.com:owner/app.git', 'https://github.com/owner/app'],
    ['github.com:owner/app', 'https://github.com/owner/app'],
    ['ssh://git@gitlab.example.com:2222/group/sub/app.git', 'https://gitlab.example.com/group/sub/app'],
    ['git://example.org/app.git', 'https://example.org/app'],
    ['git@ssh.dev.azure.com:v3/org/project/app', 'https://dev.azure.com/org/project/_git/app'],
    ['https://org@dev.azure.com/org/project/_git/app', 'https://dev.azure.com/org/project/_git/app'],
  ])('%s', (remote, web) => {
    expect(repoWebUrl(remote)).toBe(web)
  })

  it.each(['C:/Code/app', 'C:\\Code\\app', '/srv/git/app.git', '../app', 'file:///srv/git/app.git', 'origin', ''])(
    'is null for the local path %j',
    (remote) => {
      expect(repoWebUrl(remote)).toBeNull()
    },
  )
})

describe('parseWorktrees and claudeWorktrees', () => {
  const porcelain = [
    'worktree F:/Code/app',
    'HEAD 0123',
    'branch refs/heads/main',
    '',
    'worktree F:/Code/app/.claude/worktrees/login-fix',
    'HEAD 4567',
    'branch refs/heads/worktree-login-fix',
    'locked',
    '',
    'worktree F:/Code/app/.claude/worktrees/gone',
    'HEAD 89ab',
    'detached',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree F:/Code/app/sub/.claude/worktrees/nested',
    'HEAD cdef',
    'branch refs/heads/worktree-nested',
    '',
    'worktree F:/Code/other',
    'HEAD 0000',
    'branch refs/heads/feature/x',
    '',
  ].join('\n')

  it('reads every checkout with its branch', () => {
    expect(parseWorktrees(porcelain)).toEqual([
      { path: 'F:/Code/app', branch: 'main', bare: false, prunable: false },
      { path: 'F:/Code/app/.claude/worktrees/login-fix', branch: 'worktree-login-fix', bare: false, prunable: false },
      { path: 'F:/Code/app/.claude/worktrees/gone', branch: null, bare: false, prunable: true },
      { path: 'F:/Code/app/sub/.claude/worktrees/nested', branch: 'worktree-nested', bare: false, prunable: false },
      { path: 'F:/Code/other', branch: 'feature/x', bare: false, prunable: false },
    ])
    expect(parseWorktrees('worktree /srv/app.git\nbare\n')).toEqual([{ path: '/srv/app.git', branch: null, bare: true, prunable: false }])
  })

  it.runIf(process.platform === 'win32')('picks those in .claude/worktrees of the main checkout that are there', () => {
    expect(claudeWorktrees(parseWorktrees(porcelain), 'F:\\Code\\app').map((w) => w.name)).toEqual(['login-fix'])
  })
})

describe('pullRequestUrl', () => {
  it('opens a pull request of the branch on its host', () => {
    expect(pullRequestUrl('https://github.com/me/app', 'master', 'feat/app-review')).toBe(
      'https://github.com/me/app/compare/master...feat/app-review?expand=1',
    )
    expect(pullRequestUrl('https://github.example.com/me/app', 'main', 'fix/ä#1')).toBe(
      'https://github.example.com/me/app/compare/main...fix/%C3%A4%231?expand=1',
    )
    expect(pullRequestUrl('https://gitlab.com/group/sub/app', 'main', 'feat/x')).toBe(
      'https://gitlab.com/group/sub/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx&merge_request%5Btarget_branch%5D=main',
    )
    expect(pullRequestUrl('https://gitlab.example.com/app', 'main', 'x')).toBe(
      'https://gitlab.example.com/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=x&merge_request%5Btarget_branch%5D=main',
    )
    expect(pullRequestUrl('https://bitbucket.org/team/app', 'main', 'feat/x')).toBe(
      'https://bitbucket.org/team/app/pull-requests/new?source=feat%2Fx&dest=main',
    )
    expect(pullRequestUrl('https://dev.azure.com/org/project/_git/app', 'main', 'feat/x')).toBe(
      'https://dev.azure.com/org/project/_git/app/pullrequestcreate?sourceRef=feat%2Fx&targetRef=main',
    )
  })

  it('knows no other host', () => {
    expect(pullRequestUrl('https://git.example.com/me/app', 'main', 'feat/x')).toBeNull()
    expect(pullRequestUrl('not a url', 'main', 'feat/x')).toBeNull()
  })
})
