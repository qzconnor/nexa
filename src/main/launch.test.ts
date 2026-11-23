import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLaunchRequest, parseLaunch, readLaunchRequest } from './launch'

const encode = (cwd: string, ...args: string[]) => `--nx=${Buffer.from([cwd, ...args].join('\0'), 'utf8').toString('base64')}`

describe('readLaunchRequest', () => {
  it('reads folder and arguments of `nx`', () => {
    expect(readLaunchRequest(['Nexa.exe', encode('C:\\work', '-c', 'Grüße')])).toEqual({ cwd: 'C:\\work', args: ['-c', 'Grüße'] })
  })

  it('ignores a start without it', () => {
    expect(readLaunchRequest(['Nexa.exe', '--inspect'])).toBeNull()
  })
})

describe('isLaunchRequest', () => {
  it('accepts only the right shape', () => {
    expect(isLaunchRequest({ cwd: 'C:\\', args: ['-c'] })).toBe(true)
    expect(isLaunchRequest({ cwd: 'C:\\', args: [1] })).toBe(false)
    expect(isLaunchRequest(null)).toBe(false)
  })
})

describe('parseLaunch', () => {
  const cwd = resolve('/work')

  it('opens the working folder by default', () => {
    expect(parseLaunch({ cwd, args: [] })).toEqual({ dir: cwd, continue: false, provider: null, prompt: null })
  })

  it('reads the options', () => {
    expect(parseLaunch({ cwd, args: ['app', '-c', '--codex', '-m', 'Fix the tests'] })).toEqual({
      dir: resolve(cwd, 'app'),
      continue: true,
      provider: 'codex',
      prompt: 'Fix the tests',
    })
  })

  it('rejects what it does not know', () => {
    expect(() => parseLaunch({ cwd, args: ['--bogus'] })).toThrow(/Unbekannte Option/)
    expect(() => parseLaunch({ cwd, args: ['-m'] })).toThrow(/braucht einen Prompt/)
    expect(() => parseLaunch({ cwd, args: ['a', 'b'] })).toThrow(/Nur ein Ordner/)
  })
})
