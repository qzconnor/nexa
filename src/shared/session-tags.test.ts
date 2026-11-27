import { describe, expect, it } from 'vitest'
import { allTags, cleanTag, cleanTags, hasTag, MAX_CHAT_TAGS, MAX_TAG_LENGTH } from './session-tags'

describe('cleanTag', () => {
  it('keeps a tag on one line, without a leading #, not longer than a badge takes', () => {
    expect(cleanTag('  #Bug  ')).toBe('Bug')
    expect(cleanTag('Neues\n  Release')).toBe('Neues Release')
    expect(cleanTag('#  ')).toBe('')
    expect(cleanTag('x'.repeat(50))).toHaveLength(MAX_TAG_LENGTH)
  })
})

describe('cleanTags', () => {
  it('takes each tag once, in the first spelling, and leaves out what is no tag', () => {
    expect(cleanTags(['Bug', 'bug', ' ', 3, '#Release', 'BUG'])).toEqual(['Bug', 'Release'])
  })

  it('takes at most as many as a chat may have', () => {
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(MAX_CHAT_TAGS)
  })
})

describe('hasTag', () => {
  it('finds a tag whatever its case', () => {
    expect(hasTag(['Bug'], 'bug')).toBe(true)
    expect(hasTag(['Bug'], 'Release')).toBe(false)
    expect(hasTag(undefined, 'Bug')).toBe(false)
  })
})

describe('allTags', () => {
  it('lists the tags of all chats once, alphabetically, in the spelling met first', () => {
    expect(allTags([{ tags: ['release', 'Bug'] }, {}, { tags: ['bug', 'Ärger'] }])).toEqual(['Ärger', 'Bug', 'release'])
  })
})
