import { describe, expect, it } from 'vitest'
import type { ShortcutKey } from './browser'
import { chatAt, cycleChat, matchAppShortcut } from './shortcuts'

const key = (k: string, mods: Partial<ShortcutKey> = {}, code = ''): ShortcutKey => ({
  type: 'keydown',
  key: k,
  code,
  ctrlKey: true,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('matchAppShortcut', () => {
  it('switches chats like browser tabs', () => {
    expect(matchAppShortcut(key('Tab'))).toEqual({ action: 'cycle-chat', step: 1 })
    expect(matchAppShortcut(key('Tab', { shiftKey: true }))).toEqual({ action: 'cycle-chat', step: -1 })
    expect(matchAppShortcut(key('1', {}, 'Digit1'))).toEqual({ action: 'select-chat', index: 0 })
    expect(matchAppShortcut(key('8', {}, 'Digit8'))).toEqual({ action: 'select-chat', index: 7 })
    expect(matchAppShortcut(key('9', {}, 'Digit9'))).toEqual({ action: 'select-chat', index: -1 })
  })

  it('takes the digit from the number row of other layouts', () => {
    expect(matchAppShortcut(key('&', {}, 'Digit1'))).toEqual({ action: 'select-chat', index: 0 })
    expect(matchAppShortcut(key('End', {}, 'Numpad1'))).toBeNull()
  })

  it('opens a new chat, the settings and the quick open', () => {
    expect(matchAppShortcut(key('T', { shiftKey: true }))).toEqual({ action: 'new-chat' })
    expect(matchAppShortcut(key(','))).toEqual({ action: 'open-settings' })
    expect(matchAppShortcut(key('A', { shiftKey: true }))).toEqual({ action: 'palette', prefix: '' })
    expect(matchAppShortcut(key('P', { shiftKey: true }))).toEqual({ action: 'palette', prefix: '>' })
  })

  it('goes to the next chat that waits with Ctrl+Shift+J', () => {
    expect(matchAppShortcut(key('J', { shiftKey: true }))).toEqual({ action: 'next-waiting' })
    expect(matchAppShortcut(key('j'))).toBeNull()
  })

  it('shows or hides the terminal with Ctrl+Ö and Ctrl+`, as VS Code does', () => {
    expect(matchAppShortcut(key('ö', {}, 'Semicolon'))).toEqual({ action: 'toggle-terminal' })
    expect(matchAppShortcut(key('Ö', {}, 'Semicolon'))).toEqual({ action: 'toggle-terminal' })
    expect(matchAppShortcut(key('`', {}, 'Backquote'))).toEqual({ action: 'toggle-terminal' })
    expect(matchAppShortcut(key('ö', { ctrlKey: false }, 'Semicolon'))).toBeNull()
  })

  it('scales the window with plus, minus and 0', () => {
    expect(matchAppShortcut(key('+', {}, 'BracketRight'))).toEqual({ action: 'zoom', step: 1 })
    // US layouts: the plus is Shift+=, and Ctrl+= zooms in browsers as well.
    expect(matchAppShortcut(key('+', { shiftKey: true }, 'Equal'))).toEqual({ action: 'zoom', step: 1 })
    expect(matchAppShortcut(key('=', {}, 'Equal'))).toEqual({ action: 'zoom', step: 1 })
    expect(matchAppShortcut(key('+', {}, 'NumpadAdd'))).toEqual({ action: 'zoom', step: 1 })
    expect(matchAppShortcut(key('-', {}, 'Slash'))).toEqual({ action: 'zoom', step: -1 })
    expect(matchAppShortcut(key('-', {}, 'NumpadSubtract'))).toEqual({ action: 'zoom', step: -1 })
    expect(matchAppShortcut(key('0', {}, 'Digit0'))).toEqual({ action: 'zoom', step: 0 })
  })

  it('leaves other keys to the fields', () => {
    expect(matchAppShortcut(key('a'))).toBeNull()
    expect(matchAppShortcut(key('t'))).toBeNull()
    expect(matchAppShortcut(key('Tab', { ctrlKey: false }))).toBeNull()
    expect(matchAppShortcut(key('1', { altKey: true }, 'Digit1'))).toBeNull()
    expect(matchAppShortcut({ ...key('Tab'), type: 'keyup' })).toBeNull()
  })
})

describe('cycleChat', () => {
  const order = ['a', 'b', 'c']

  it('goes round at the ends', () => {
    expect(cycleChat(order, 'b', 1)).toBe('c')
    expect(cycleChat(order, 'c', 1)).toBe('a')
    expect(cycleChat(order, 'a', -1)).toBe('c')
  })

  it('starts at the first or the last without an open chat in the list', () => {
    expect(cycleChat(order, null, 1)).toBe('a')
    expect(cycleChat(order, 'x', -1)).toBe('c')
    expect(cycleChat([], 'a', 1)).toBeNull()
  })
})

describe('chatAt', () => {
  it('finds a chat by its place, -1 the last', () => {
    expect(chatAt(['a', 'b'], 1)).toBe('b')
    expect(chatAt(['a', 'b'], -1)).toBe('b')
    expect(chatAt(['a', 'b'], 4)).toBeNull()
  })
})
