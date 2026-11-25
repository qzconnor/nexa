import { describe, expect, it } from 'vitest'
import { linkedFile, useMarkdown } from './useMarkdown'

describe('useMarkdown links', () => {
  const { render } = useMarkdown()

  it('keeps file links as links, as the CLIs write them for files they made', () => {
    const html = render('Siehe [walkthrough.md](file:///C:/Users/ada/.gemini/antigravity-cli/brain/4c75/walkthrough.md).')
    expect(html).toContain('<a href="file:///C:/Users/ada/.gemini/antigravity-cli/brain/4c75/walkthrough.md"')
    expect(html).toContain('>walkthrough.md</a>')
  })

  it('still drops script links', () => {
    expect(render('[x](javascript:alert(1))')).not.toContain('<a ')
    expect(render('[x](vbscript:msgbox)')).not.toContain('<a ')
  })
})

describe('linkedFile', () => {
  it('reads file URLs and absolute paths', () => {
    expect(linkedFile('file:///C:/Users/ada/notes%20neu.md')).toBe('C:/Users/ada/notes neu.md')
    expect(linkedFile('file:///home/ada/a.ts#L12')).toBe('/home/ada/a.ts')
    expect(linkedFile('C:\\src\\a.ts')).toBe('C:\\src\\a.ts')
    expect(linkedFile('/home/ada/a.ts')).toBe('/home/ada/a.ts')
  })

  it('takes nothing else', () => {
    expect(linkedFile('src/a.ts')).toBeNull()
    expect(linkedFile('https://example.com/a')).toBeNull()
    expect(linkedFile('mailto:ada@example.com')).toBeNull()
  })

  it('never opens a share on another computer', () => {
    expect(linkedFile('//server/share/a.md')).toBeNull()
    expect(linkedFile('file:////server/share/a.md')).toBeNull()
    expect(linkedFile('file://server/share/a.md')).toBeNull()
  })

  it('keeps a path whose escapes are broken as written', () => {
    expect(linkedFile('file:///C:/a%E0.md')).toBe('C:/a%E0.md')
  })
})
