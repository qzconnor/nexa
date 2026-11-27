import { describe, expect, it } from 'vitest'
import { checksOf, isGitHub, parsePullRequests } from './pull-requests'

describe('checksOf', () => {
  const run = (status: string, conclusion = '') => ({ __typename: 'CheckRun', status, conclusion })
  const commitStatus = (state: string) => ({ __typename: 'StatusContext', state })

  it('takes the checks together as GitHub marks them', () => {
    expect(checksOf([])).toBeNull()
    expect(checksOf(undefined)).toBeNull()
    expect(checksOf([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), commitStatus('SUCCESS')])).toBe('passing')
    expect(checksOf([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS')])).toBe('pending')
    expect(checksOf([run('QUEUED'), run('COMPLETED', 'FAILURE')])).toBe('failing')
    expect(checksOf([commitStatus('PENDING')])).toBe('pending')
    expect(checksOf([commitStatus('ERROR')])).toBe('failing')
  })
})

describe('parsePullRequests', () => {
  it('reads what gh gives and leaves out what it cannot', () => {
    const list = parsePullRequests([
      { number: 7, url: 'https://github.com/o/r/pull/7', title: 'feat: x', headRefName: 'feat/x', baseRefName: 'main', isDraft: false, reviewDecision: 'CHANGES_REQUESTED', author: { login: 'a' }, updatedAt: '2026-11-27T10:00:00Z' },
      { number: 'eight' },
      'nine',
    ])
    expect(list).toEqual([
      { number: 7, title: 'feat: x', url: 'https://github.com/o/r/pull/7', branch: 'feat/x', base: 'main', draft: false, review: 'changes', checks: null, author: 'a', updatedAt: Date.parse('2026-11-27T10:00:00Z') },
    ])
    expect(parsePullRequests({})).toEqual([])
  })
})

describe('isGitHub', () => {
  it('knows github.com and Enterprise hosts named after it', () => {
    expect(isGitHub('https://github.com/o/r')).toBe(true)
    expect(isGitHub('https://github.example.com/o/r')).toBe(true)
    expect(isGitHub('https://gitlab.com/o/r')).toBe(false)
  })
})
