import { describe, expect, it } from 'vitest'
import { filterGuard } from './git-filters'

describe('filterGuard', () => {
  it('switches off the filters of the repository, not those of the user', () => {
    const out = ['global\tfilter.lfs.process', 'local\tfilter.evil.clean', 'worktree\tfilter.a=b.c.process\r', 'command\tfilter.mine.clean', ''].join('\n')
    expect(filterGuard(out)).toEqual({
      GIT_CONFIG_KEY_0: 'filter.evil.clean',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'filter.evil.process',
      GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'filter.evil.required',
      GIT_CONFIG_VALUE_2: 'false',
      GIT_CONFIG_KEY_3: 'filter.a=b.c.clean',
      GIT_CONFIG_VALUE_3: '',
      GIT_CONFIG_KEY_4: 'filter.a=b.c.process',
      GIT_CONFIG_VALUE_4: '',
      GIT_CONFIG_KEY_5: 'filter.a=b.c.required',
      GIT_CONFIG_VALUE_5: 'false',
      GIT_CONFIG_COUNT: '6',
    })
  })

  it('adds to settings the environment gives git already, and is empty without filters', () => {
    expect(filterGuard('local\tfilter.x.clean', '2')).toMatchObject({ GIT_CONFIG_KEY_2: 'filter.x.clean', GIT_CONFIG_COUNT: '5' })
    expect(filterGuard(null)).toEqual({})
    expect(filterGuard('global\tfilter.lfs.clean')).toEqual({})
  })

  it('also switches off what a checkout runs', () => {
    expect(filterGuard('local\tfilter.evil.smudge', undefined, true)).toEqual({
      GIT_CONFIG_KEY_0: 'filter.evil.clean',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'filter.evil.smudge',
      GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'filter.evil.process',
      GIT_CONFIG_VALUE_2: '',
      GIT_CONFIG_KEY_3: 'filter.evil.required',
      GIT_CONFIG_VALUE_3: 'false',
      GIT_CONFIG_COUNT: '4',
    })
  })
})
