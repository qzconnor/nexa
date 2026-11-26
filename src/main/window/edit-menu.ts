import { app, Menu, session, type BrowserWindow, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { spellcheckLanguages } from '@shared/spellcheck'
import type { AppSettings } from '@shared/types'

/**
 * The menu of a right click into the app's text fields: the spellchecker's suggestions for the word
 * under the mouse, then what a text field does. Electron shows none of its own, so without it the
 * squiggles had no suggestions. Where the page shows a menu of its own (sidebar, file tree), it
 * prevents the default and this one stays away.
 */

export type EditMenuParams = Pick<ContextMenuParams, 'isEditable' | 'editFlags' | 'selectionText' | 'misspelledWord' | 'dictionarySuggestions'>

export interface EditActions {
  replace(word: string): void
  learn(word: string): void
  undo(): void
  redo(): void
  cut(): void
  copy(): void
  paste(): void
  selectAll(): void
}

/** Chromium offers up to five; more would push what the field does far down. */
const MAX_SUGGESTIONS = 5

export function editMenu(params: EditMenuParams, actions: EditActions): MenuItemConstructorOptions[] {
  const separator: MenuItemConstructorOptions = { type: 'separator' }
  // Shortcuts as hints only: the page handles the keys itself.
  const item = (label: string, enabled: boolean, click: () => void, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    enabled,
    click,
    ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
  })
  if (!params.isEditable) return params.selectionText.trim() ? [item('Kopieren', true, actions.copy, 'CmdOrCtrl+C')] : []

  const items: MenuItemConstructorOptions[] = []
  const word = params.misspelledWord
  if (word) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SUGGESTIONS)
    for (const suggestion of suggestions) items.push({ label: suggestion, click: () => actions.replace(suggestion) })
    if (!suggestions.length) items.push({ label: 'Keine Vorschläge', enabled: false })
    items.push(item('Zum Wörterbuch hinzufügen', true, () => actions.learn(word)), separator)
  }
  const { canUndo, canRedo, canCut, canCopy, canPaste, canSelectAll } = params.editFlags
  items.push(
    item('Rückgängig', canUndo, actions.undo, 'CmdOrCtrl+Z'),
    item('Wiederholen', canRedo, actions.redo, process.platform === 'darwin' ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
    separator,
    item('Ausschneiden', canCut, actions.cut, 'CmdOrCtrl+X'),
    item('Kopieren', canCopy, actions.copy, 'CmdOrCtrl+C'),
    item('Einfügen', canPaste, actions.paste, 'CmdOrCtrl+V'),
    separator,
    item('Alles auswählen', canSelectAll, actions.selectAll, 'CmdOrCtrl+A'),
  )
  return items
}

/** The menu for every right click in an app window (the browser's views have their own, browser-guests.ts). */
export function attachEditMenu(win: BrowserWindow): void {
  const contents = win.webContents
  contents.on('context-menu', (_event, params) => {
    const items = editMenu(params, {
      replace: (word) => contents.replaceMisspelling(word),
      learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      undo: () => contents.undo(),
      redo: () => contents.redo(),
      cut: () => contents.cut(),
      copy: () => contents.copy(),
      paste: () => contents.paste(),
      selectAll: () => contents.selectAll(),
    })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

let applied = ''

/**
 * Spell checking on or off, in the languages of the settings, for the app's session (its windows; the
 * browser beside the chat has a session of its own). Chromium keeps both itself from one start to the
 * next, so this only changes what differs. macOS checks in the languages the system has set.
 */
export function applySpellcheck(chat: Pick<AppSettings['chat'], 'spellcheck' | 'spellcheckLanguages'>): void {
  const appSession = session.defaultSession
  const languages =
    process.platform === 'darwin' ? [] : spellcheckLanguages(chat.spellcheckLanguages, app.getPreferredSystemLanguages(), appSession.availableSpellCheckerLanguages)
  const key = `${chat.spellcheck}:${languages.join(',')}`
  if (key === applied) return
  applied = key
  appSession.setSpellCheckerEnabled(chat.spellcheck)
  if (!chat.spellcheck || !languages.length) return
  try {
    appSession.setSpellCheckerLanguages(languages)
  } catch (error) {
    // Only ever ones from its own list; should it refuse anyway, it keeps checking in the ones before.
    console.warn('[spellcheck] languages not set', error)
  }
}

/** The languages there are dictionaries for; none on macOS, where the system chooses. */
export function availableSpellcheckLanguages(): string[] {
  return process.platform === 'darwin' ? [] : session.defaultSession.availableSpellCheckerLanguages
}
