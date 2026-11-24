import { describe, expect, it } from 'vitest'
import type { ShortcutKey } from '@shared/browser'
import { terminalKey } from './terminal-keys'

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

describe('terminalKey', () => {
  it('copies with a selection, and interrupts without one', () => {
    expect(terminalKey(key('c'), true)).toBe('copy')
    expect(terminalKey(key('c'), false)).toBeNull()
    expect(terminalKey(key('C', { shiftKey: true }), false)).toBe('copy')
  })

  it('pastes with Ctrl+V and Ctrl+Shift+V', () => {
    expect(terminalKey(key('v'), false)).toBe('paste')
    expect(terminalKey(key('V', { shiftKey: true }), false)).toBe('paste')
  })

  it("leaves the window's shortcuts to the window", () => {
    expect(terminalKey(key('Tab'), false)).toBe('app')
    expect(terminalKey(key('P', { shiftKey: true }), false)).toBe('app')
    expect(terminalKey(key('ö', {}, 'Semicolon'), false)).toBe('app')
  })

  it('sends everything else to the shell', () => {
    expect(terminalKey(key('r'), false)).toBeNull()
    expect(terminalKey(key('w'), false)).toBeNull()
    expect(terminalKey(key('a', { ctrlKey: false }), false)).toBeNull()
    expect(terminalKey(key('c', { altKey: true }), true)).toBeNull()
  })
})
