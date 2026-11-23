import { describe, expect, it } from 'vitest'
import { relativeTo, shortenIn } from './useProjectPath'

describe('relativeTo', () => {
  it('makes paths inside the project relative', () => {
    expect(relativeTo('F:\\Work\\app\\src\\main.ts', 'F:\\Work\\app')).toBe('src/main.ts')
    expect(relativeTo('f:/work/APP/README.md', 'F:\\Work\\app\\')).toBe('README.md')
    expect(relativeTo('/home/me/app/a.ts', '/home/me/app')).toBe('a.ts')
  })

  it('leaves other paths as they are', () => {
    expect(relativeTo('F:\\Work\\application\\a.ts', 'F:\\Work\\app')).toBe('F:\\Work\\application\\a.ts')
    expect(relativeTo('/home/me/App/a.ts', '/home/me/app')).toBe('/home/me/App/a.ts')
    expect(relativeTo('a.ts', null)).toBe('a.ts')
  })
})

describe('shortenIn', () => {
  it('drops the project folder from a command', () => {
    expect(shortenIn('Get-Content F:\\Work\\app\\README.md', 'F:\\Work\\app')).toBe('Get-Content README.md')
    expect(shortenIn('cat "F:/Work/app/src/x.ts"', 'F:\\Work\\app')).toBe('cat "src/x.ts"')
    expect(shortenIn('type F:\\\\Work\\\\app\\\\x.json', 'F:\\Work\\app')).toBe('type x.json')
  })
})
