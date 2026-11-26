import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySpellcheck, editMenu, type EditActions } from './edit-menu'

const fakes = vi.hoisted(() => ({
  session: {
    availableSpellCheckerLanguages: ['de', 'de-DE', 'en-GB', 'en-US', 'fr-FR'],
    setSpellCheckerEnabled: vi.fn(),
    setSpellCheckerLanguages: vi.fn(),
  },
  systemLanguages: ['de-DE', 'en-US'],
}))
vi.mock('electron', () => ({
  app: { getPreferredSystemLanguages: () => fakes.systemLanguages },
  Menu: { buildFromTemplate: vi.fn() },
  session: { defaultSession: fakes.session },
}))

const FLAGS = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canDelete: true, canEditRichly: false }

function actions(): EditActions & Record<string, ReturnType<typeof vi.fn>> {
  return { replace: vi.fn(), learn: vi.fn(), undo: vi.fn(), redo: vi.fn(), cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn() }
}
const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => (item.type === 'separator' ? '—' : item.label))
const click = (items: MenuItemConstructorOptions[], label: string) => items.find((item) => item.label === label)!.click!({} as never, undefined, {} as never)

describe('editMenu', () => {
  it('offers the suggestions for a misspelled word, adding it to the dictionary, then what a text field does', () => {
    const act = actions()
    const items = editMenu({ isEditable: true, editFlags: FLAGS, selectionText: '', misspelledWord: 'Tset', dictionarySuggestions: ['Test', 'Tests'] }, act)
    expect(labels(items)).toEqual([
      'Test',
      'Tests',
      'Zum Wörterbuch hinzufügen',
      '—',
      'Rückgängig',
      'Wiederholen',
      '—',
      'Ausschneiden',
      'Kopieren',
      'Einfügen',
      '—',
      'Alles auswählen',
    ])
    click(items, 'Tests')
    expect(act.replace).toHaveBeenCalledWith('Tests')
    click(items, 'Zum Wörterbuch hinzufügen')
    expect(act.learn).toHaveBeenCalledWith('Tset')
    expect(items.find((item) => item.label === 'Wiederholen')).toMatchObject({ enabled: false })
  })

  it('says so when the spellchecker knows no better word, and offers five at most', () => {
    const none = editMenu({ isEditable: true, editFlags: FLAGS, selectionText: '', misspelledWord: 'xqzv', dictionarySuggestions: [] }, actions())
    expect(none[0]).toMatchObject({ label: 'Keine Vorschläge', enabled: false })
    const many = editMenu({ isEditable: true, editFlags: FLAGS, selectionText: '', misspelledWord: 'ab', dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f'] }, actions())
    expect(labels(many).slice(0, 6)).toEqual(['a', 'b', 'c', 'd', 'e', 'Zum Wörterbuch hinzufügen'])
  })

  it('shows only what a text field does for a word spelled right', () => {
    const act = actions()
    const items = editMenu({ isEditable: true, editFlags: { ...FLAGS, canCut: false, canCopy: false }, selectionText: '', misspelledWord: '', dictionarySuggestions: [] }, act)
    expect(labels(items)[0]).toBe('Rückgängig')
    expect(items.find((item) => item.label === 'Kopieren')).toMatchObject({ enabled: false, accelerator: 'CmdOrCtrl+C', registerAccelerator: false })
    click(items, 'Einfügen')
    expect(act.paste).toHaveBeenCalled()
  })

  it('copies text selected outside a field, and shows nothing for a click elsewhere', () => {
    const selected = editMenu({ isEditable: false, editFlags: FLAGS, selectionText: 'eine Antwort', misspelledWord: '', dictionarySuggestions: [] }, actions())
    expect(labels(selected)).toEqual(['Kopieren'])
    expect(editMenu({ isEditable: false, editFlags: FLAGS, selectionText: '  ', misspelledWord: '', dictionarySuggestions: [] }, actions())).toEqual([])
  })
})

describe('applySpellcheck', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks in the system’s language and English, and changes only what differs', () => {
    applySpellcheck({ spellcheck: true, spellcheckLanguages: [] })
    expect(fakes.session.setSpellCheckerEnabled).toHaveBeenCalledWith(true)
    expect(fakes.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['de-DE', 'en-US'])

    vi.clearAllMocks()
    applySpellcheck({ spellcheck: true, spellcheckLanguages: [] })
    expect(fakes.session.setSpellCheckerEnabled).not.toHaveBeenCalled()

    applySpellcheck({ spellcheck: true, spellcheckLanguages: ['fr', 'en-GB'] })
    expect(fakes.session.setSpellCheckerLanguages).toHaveBeenCalledWith(['fr-FR', 'en-GB'])
  })

  it('turns it off without touching the languages, and keeps going when the spellchecker refuses them', () => {
    applySpellcheck({ spellcheck: false, spellcheckLanguages: [] })
    expect(fakes.session.setSpellCheckerEnabled).toHaveBeenCalledWith(false)
    expect(fakes.session.setSpellCheckerLanguages).not.toHaveBeenCalled()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakes.session.setSpellCheckerLanguages.mockImplementationOnce(() => {
      throw new Error('Invalid language code provided')
    })
    expect(() => applySpellcheck({ spellcheck: true, spellcheckLanguages: ['de-DE'] })).not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
