import { describe, expect, it } from 'vitest'
import type { PullRequestInfo } from '@shared/pull-requests'
import { pullRequestState, sortForBranch } from './pull-requests'

describe('pullRequestState', () => {
  const state = (patch: Partial<PullRequestInfo>) => pullRequestState({ draft: false, review: null, checks: null, ...patch })

  it('says first what holds a pull request up, then what it waits for, then that it may go in', () => {
    expect(state({ draft: true, checks: 'failing' })).toEqual({ tone: 'draft', label: 'Entwurf' })
    expect(state({ checks: 'failing', review: 'approved' }).tone).toBe('bad')
    expect(state({ review: 'changes', checks: 'passing' }).label).toBe('Änderungen angefragt')
    expect(state({ checks: 'pending', review: 'approved' }).label).toBe('Checks laufen')
    expect(state({ review: 'required', checks: 'passing' }).label).toBe('Review ausstehend')
    expect(state({ review: 'approved', checks: 'passing' }).tone).toBe('ok')
    expect(state({ checks: 'passing' }).label).toBe('Checks bestanden')
    expect(state({})).toEqual({ tone: 'open', label: 'Offen' })
  })
})

describe('sortForBranch', () => {
  const pr = (number: number, branch: string) => ({ number, branch }) as PullRequestInfo
  it('puts the pull request of the checked-out branch first', () => {
    const list = [pr(3, 'a'), pr(2, 'b'), pr(1, 'c')]
    expect(sortForBranch(list, 'c').map((p) => p.number)).toEqual([1, 3, 2])
    expect(sortForBranch(list, 'main').map((p) => p.number)).toEqual([3, 2, 1])
    expect(sortForBranch(list, null).map((p) => p.number)).toEqual([3, 2, 1])
  })
})
