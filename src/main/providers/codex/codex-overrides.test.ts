import { describe, expect, it } from 'vitest'
import { codexOverrides } from './codex-overrides'

describe('codexOverrides', () => {
  it('reads every form of -c', () => {
    expect(codexOverrides(['-c', 'model_reasoning_effort=high', '--config', 'a.b=1', '--config=c=true']).config).toEqual({
      model_reasoning_effort: 'high',
      'a.b': 1,
      c: true,
    })
  })

  it('reads values as Codex does: TOML where it can, else the text', () => {
    const { config } = codexOverrides(['-c', 'a="x y"', '-c', "b='lit'", '-c', 'c=[1,2]', '-c', 'd=null', '-c', 'e=o3=mini'])
    expect(config).toEqual({ a: 'x y', b: 'lit', c: [1, 2], d: 'null', e: 'o3=mini' })
  })

  it('leaves what is no override', () => {
    expect(codexOverrides(['--search', '-c', '=x', '-c'])).toEqual({ config: {}, rest: ['--search', '-c', '=x', '-c'] })
    expect(codexOverrides(['-c', 'a b=1']).rest).toEqual(['-c', 'a b=1'])
  })
})
