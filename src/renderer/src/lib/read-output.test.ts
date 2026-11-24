import { describe, expect, it } from 'vitest'
import { numberedLines } from './read-output'

describe('numberedLines', () => {
  it("takes Claude Code's numbers off the lines, empty lines and tabs in them included", () => {
    expect(numberedLines('11\tAntwort von 8.8.8.8\n12\t\n13\t\tPakete: 10')).toEqual({
      lines: [
        { n: 11, text: 'Antwort von 8.8.8.8' },
        { n: 12, text: '' },
        { n: 13, text: '\tPakete: 10' },
      ],
      note: '',
    })
  })

  it('keeps an empty last line whose tab went with the trimmed end', () => {
    expect(numberedLines('20\t[exited with code 0]\n21')).toEqual({
      lines: [
        { n: 20, text: '[exited with code 0]' },
        { n: 21, text: '' },
      ],
      note: '',
    })
  })

  it('reads the older form with padding and an arrow', () => {
    expect(numberedLines('     1→# Titel\n     2→')?.lines).toEqual([
      { n: 1, text: '# Titel' },
      { n: 2, text: '' },
    ])
  })

  it('keeps what follows the lines apart, without reminders for the model', () => {
    const output = '1\tGr�ße\n\n[This file is not valid UTF-8: …]\n<system-reminder>\nintern\n</system-reminder>\n'
    expect(numberedLines(output)?.note).toBe('[This file is not valid UTF-8: …]')
  })

  it('is null for an answer without numbered lines', () => {
    expect(numberedLines('File does not exist.')).toBeNull()
    expect(numberedLines('')).toBeNull()
  })
})
