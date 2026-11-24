import { describe, expect, it } from 'vitest'
import { randomWorktreeName, worktreeBranch, worktreeFolder, worktreeNameError } from './worktree'

describe('worktreeNameError', () => {
  it('takes names that suit a folder and a branch, and none', () => {
    for (const name of ['', '  ', 'login-fix', 'v2.1', 'Feature_42', 'a']) expect(worktreeNameError(name)).toBeNull()
  })

  it('names what is wrong', () => {
    expect(worktreeNameError('a'.repeat(65))).toBe('Höchstens 64 Zeichen.')
    expect(worktreeNameError('mit leerzeichen')).toContain('Nur Buchstaben')
    expect(worktreeNameError('größe')).toContain('ohne Umlaute')
    expect(worktreeNameError('a/b')).toContain('Nur Buchstaben')
    expect(worktreeNameError('-x')).toContain('beginnt mit')
    expect(worktreeNameError('.hidden')).toContain('beginnt mit')
    expect(worktreeNameError('a..b')).toContain('zwei Punkte')
    expect(worktreeNameError('end.')).toContain('am Ende')
    expect(worktreeNameError('x.lock')).toContain('.lock')
  })

  it('refuses the device names of Windows, also with an extension', () => {
    expect(worktreeNameError('con')).toBe('„con“ ist unter Windows ein Gerätename.')
    expect(worktreeNameError('NUL.txt')).toContain('Gerätename')
    expect(worktreeNameError('com1')).toContain('Gerätename')
    expect(worktreeNameError('console')).toBeNull()
    expect(worktreeNameError('com10')).toBeNull()
  })
})

describe('worktree places', () => {
  it('follows Claude Code', () => {
    expect(worktreeBranch('login')).toBe('worktree-login')
    expect(worktreeFolder('login')).toBe('.claude/worktrees/login')
  })
})

describe('randomWorktreeName', () => {
  it('makes up a valid name of three words', () => {
    const name = randomWorktreeName()
    expect(name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
    expect(worktreeNameError(name)).toBeNull()
  })

  it('avoids taken names', () => {
    const values = [0, 0, 0, 0.99, 0.99, 0.99]
    let i = 0
    const random = () => values[i++ % values.length]!
    const first = randomWorktreeName(() => false, () => 0)
    expect(randomWorktreeName((name) => name === first, random)).not.toBe(first)
  })

  it('adds a number when every try is taken', () => {
    expect(randomWorktreeName(() => true, () => 0)).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d+$/)
  })
})
