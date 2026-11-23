import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderPromptText, PROMPT_FILE, readFolderPrompt, writeFolderPrompt } from './folder-prompts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-prompts-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('folder prompts', () => {
  it('reads the file without a BOM', async () => {
    writeFileSync(join(dir, PROMPT_FILE), '\ufeffNur Open-Source-Bibliotheken.\n')
    expect(await readFolderPrompt(dir)).toBe('Nur Open-Source-Bibliotheken.\n')
  })

  it('is empty without a file', async () => {
    expect(await readFolderPrompt(dir)).toBe('')
  })

  it('writes the text trimmed with one line end, and no file for nothing', async () => {
    await writeFolderPrompt(dir, '')
    expect(existsSync(join(dir, PROMPT_FILE))).toBe(false)
    await writeFolderPrompt(dir, '  Deutsch antworten.\r\nKurz.  \n\n')
    expect(readFileSync(join(dir, PROMPT_FILE), 'utf8')).toBe('Deutsch antworten.\nKurz.\n')
    await writeFolderPrompt(dir, '')
    expect(readFileSync(join(dir, PROMPT_FILE), 'utf8')).toBe('')
  })

  it('puts the prompts together outermost first, leaving out empty ones', () => {
    const text = folderPromptText([
      { name: 'Apps', path: 'F:\\Apps', text: 'Außen.' },
      { name: 'Leer', path: 'F:\\Apps\\Leer', text: '  ' },
      { name: 'nexa', path: 'F:\\Apps\\nexa', text: 'Innen.\n' },
    ])
    expect(text).toBe(
      'The user set these instructions for "Apps" (F:\\Apps). Follow them in this session:\n\nAußen.\n\n' +
        'The user set these instructions for "nexa" (F:\\Apps\\nexa). Follow them in this session:\n\nInnen.\n',
    )
  })
})
