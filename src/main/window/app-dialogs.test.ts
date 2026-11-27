import { describe, expect, it } from 'vitest'
import type { AppDialogRequest } from '@shared/types'
import { AppDialogs, type DialogWindow } from './app-dialogs'

/** A main window that records what it was asked, and can go away. */
function fakeWindow() {
  const shown: AppDialogRequest[] = []
  const gone = new Set<() => void>()
  const win: DialogWindow = {
    show: (request) => shown.push(request),
    onGone: (cb) => {
      gone.add(cb)
      return () => gone.delete(cb)
    },
  }
  return { win, shown, close: () => [...gone].forEach((cb) => cb()), listening: () => gone.size }
}

describe('AppDialogs', () => {
  it('asks in the window and waits for its answer', async () => {
    const w = fakeWindow()
    const dialogs = new AppDialogs(() => w.win)
    const answer = dialogs.ask({ title: 'Nexa beenden?', confirmText: 'Beenden' })
    expect(w.shown).toEqual([{ id: 1, title: 'Nexa beenden?', confirmText: 'Beenden' }])
    dialogs.answer(1, true)
    await expect(answer).resolves.toBe(true)
    expect(w.listening()).toBe(0)
  })

  it('counts a question the window can no longer answer as the caller says', async () => {
    const w = fakeWindow()
    const dialogs = new AppDialogs(() => w.win)
    const quit = dialogs.ask({ title: 'Nexa beenden?' }, true)
    const other = dialogs.ask({ title: 'Etwas anderes?' })
    w.close()
    await expect(quit).resolves.toBe(true)
    await expect(other).resolves.toBe(false)
  })

  it('takes one answer per question; a late or unknown one changes nothing', async () => {
    const w = fakeWindow()
    const dialogs = new AppDialogs(() => w.win)
    const answer = dialogs.ask({ title: 'A' })
    dialogs.answer(1, false)
    dialogs.answer(1, true)
    dialogs.answer(99, true)
    await expect(answer).resolves.toBe(false)
  })

  it('keeps what is open for a page that starts listening later, and forgets it once answered', () => {
    const w = fakeWindow()
    const dialogs = new AppDialogs(() => w.win)
    void dialogs.ask({ title: 'A' })
    void dialogs.ask({ title: 'B' })
    dialogs.answer(1, true)
    expect(dialogs.pending()).toEqual([{ id: 2, title: 'B' }])
  })

  it('tells with one button and waits for nothing', () => {
    const w = fakeWindow()
    new AppDialogs(() => w.win).tell({ title: '„nx“ konnte keinen Chat öffnen', description: 'Kein Ordner', warning: true })
    expect(w.shown).toEqual([{ id: 1, kind: 'alert', title: '„nx“ konnte keinen Chat öffnen', description: 'Kein Ordner', warning: true }])
  })
})
