import { describe, expect, it } from 'vitest'
import { ghFailure, PullRequests, type GhResult } from './pull-requests'

const pr = (number: number, patch: Record<string, unknown> = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  headRefName: `feat/${number}`,
  baseRefName: 'main',
  isDraft: false,
  reviewDecision: '',
  author: { login: 'me' },
  updatedAt: `2026-11-2${number}T10:00:00Z`,
  statusCheckRollup: [],
  ...patch,
})

function make(result: () => GhResult, webUrl: string | null = 'https://github.com/o/r') {
  let now = 1_000_000
  const calls: { cwd: string; args: string[] }[] = []
  const prs = new PullRequests({
    webUrl: async () => webUrl,
    gh: async (cwd, args) => {
      calls.push({ cwd, args })
      return result()
    },
    now: () => now,
  })
  return { prs, calls, later: (ms: number) => (now += ms) }
}

describe('PullRequests', () => {
  it('lists the open pull requests of a GitHub repository, the newest change first', async () => {
    const { prs, calls } = make(() => ({ ok: true, out: JSON.stringify([pr(1), pr(3, { isDraft: true, reviewDecision: 'APPROVED' })]) }))
    const list = await prs.list('F:\\nexa')
    expect(calls[0]).toMatchObject({ cwd: 'F:\\nexa', args: expect.arrayContaining(['pr', 'list', '--state', 'open', '--json']) })
    expect(list).toMatchObject({ ok: true, webUrl: 'https://github.com/o/r' })
    expect(list.ok && list.pullRequests.map((p) => [p.number, p.branch, p.draft, p.review])).toEqual([
      [3, 'feat/3', true, 'approved'],
      [1, 'feat/1', false, null],
    ])
  })

  it('asks GitHub at most once a minute per repository, unless fresh, and shares a reading', async () => {
    const { prs, calls, later } = make(() => ({ ok: true, out: '[]' }))
    await Promise.all([prs.list('F:\\nexa'), prs.list('F:\\nexa-worktree')])
    expect(calls).toHaveLength(1)
    later(30_000)
    await prs.list('F:\\nexa')
    expect(calls).toHaveLength(1)
    await prs.list('F:\\nexa', true)
    expect(calls).toHaveLength(2)
    later(61_000)
    await prs.list('F:\\nexa')
    expect(calls).toHaveLength(3)
  })

  it('leaves out repositories without a page on GitHub, and never asks gh for them', async () => {
    for (const web of [null, 'https://gitlab.com/o/r']) {
      const { prs, calls } = make(() => ({ ok: true, out: '[]' }), web)
      expect(await prs.list('F:\\nexa')).toEqual({ ok: false, missing: 'no-github' })
      expect(calls).toHaveLength(0)
    }
  })

  it('says why gh gave nothing', async () => {
    expect(ghFailure({ ok: false, missing: true, error: 'spawn gh ENOENT' })).toEqual({ ok: false, missing: 'no-gh' })
    expect(ghFailure({ ok: false, missing: false, error: 'To get started with GitHub CLI, please run:  gh auth login' })).toEqual({ ok: false, missing: 'signed-out' })
    expect(ghFailure({ ok: false, missing: false, error: 'none of the git remotes configured for this repository point to a known GitHub host' }).missing).toBe('no-github')
    expect(ghFailure({ ok: false, missing: false, error: '\nHTTP 502: Bad Gateway\nmore' })).toEqual({ ok: false, missing: 'error', message: 'HTTP 502: Bad Gateway' })
    const { prs } = make(() => ({ ok: true, out: 'not json' }))
    expect(await prs.list('F:\\nexa')).toMatchObject({ ok: false, missing: 'error' })
  })
})
