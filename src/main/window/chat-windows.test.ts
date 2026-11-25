import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { ChatWindowsEvent, type ChatHandoff } from '@shared/chat-windows'
import { ChatWindows, CLOSING_WAIT_MS } from './chat-windows'
import type { SavedBounds } from './window-place'

let nextId = 1

/** A window as far as ChatWindows uses it: closing asks the listeners of `close` first. */
class FakeWindow extends EventEmitter {
  destroyed = false
  readonly sent: string[] = []
  readonly webContents = {
    id: nextId++,
    loading: false,
    send: (channel: string) => this.sent.push(channel),
    isLoading: () => this.webContents.loading,
    isCrashed: () => false,
  }
  isDestroyed = () => this.destroyed
  close(): void {
    let prevented = false
    this.emit('close', { preventDefault: () => (prevented = true) })
    if (prevented) return
    this.destroyed = true
    this.emit('closed')
  }
}

const handoff = (text: string): ChatHandoff => ({ draft: { text, images: [] }, terminal: true, browser: false })

describe('ChatWindows', () => {
  let dir: string
  let quitting: boolean
  let created: { id: string; saved: SavedBounds | null; win: FakeWindow; onBounds: (b: SavedBounds) => void }[]
  let instances: ChatWindows[]

  function service(): ChatWindows {
    const windows = new ChatWindows({
      file: join(dir, 'chat-windows.json'),
      quitting: () => quitting,
      create: (id, saved, onBounds) => {
        const win = new FakeWindow()
        created.push({ id, saved, win, onBounds })
        return win as unknown as BrowserWindow
      },
    })
    instances.push(windows)
    return windows
  }
  const contents = (win: FakeWindow) => win.webContents as never

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-chat-windows-'))
    quitting = false
    created = []
    instances = []
  })

  afterEach(async () => {
    vi.useRealTimers()
    // Pending saves go before their folder does.
    await Promise.all(instances.map((windows) => windows.flush()))
    await rm(dir, { recursive: true, force: true })
  })

  it('opens one window per chat and hands its window what came along', () => {
    const windows = service()
    const changed: string[][] = []
    windows.on('changed', (ids) => changed.push(ids))
    const first = windows.open('s1', handoff('Entwurf'))
    expect(windows.open('s1')).toBe(first)
    expect(created).toHaveLength(1)
    expect(changed).toEqual([['s1']])
    expect(windows.sessionOf(contents(created[0]!.win))).toBe('s1')
    expect(windows.takeHandoff('s1')?.draft?.text).toBe('Entwurf')
    expect(windows.takeHandoff('s1')).toBeNull()
  })

  it('asks a closing window what goes back, and gives it to the main window', () => {
    const windows = service()
    const returned: unknown[][] = []
    windows.on('returned', (...args) => returned.push(args))
    windows.open('s1')
    const win = created[0]!.win
    win.close()
    expect(win.destroyed).toBe(false)
    expect(win.sent).toEqual([ChatWindowsEvent.closing])
    windows.closing(contents(win), handoff('noch nicht gesendet'))
    expect(win.destroyed).toBe(true)
    expect(windows.ids()).toEqual([])
    expect(returned).toEqual([['s1', handoff('noch nicht gesendet'), false]])
  })

  it('lets a window close itself with what goes back, without asking it', () => {
    const windows = service()
    const returned: unknown[][] = []
    windows.on('returned', (...args) => returned.push(args))
    windows.open('s1')
    const win = created[0]!.win
    windows.closing(contents(win), handoff('Chat beendet'))
    expect(win.destroyed).toBe(true)
    expect(win.sent).toEqual([])
    expect(returned).toEqual([['s1', handoff('Chat beendet'), false]])
  })

  it('closes a window that does not answer after a while', () => {
    vi.useFakeTimers()
    const windows = service()
    windows.open('s1')
    const win = created[0]!.win
    win.close()
    vi.advanceTimersByTime(CLOSING_WAIT_MS)
    expect(win.destroyed).toBe(true)
  })

  it('docks a chat back: the main window shows it', () => {
    const windows = service()
    const returned: unknown[][] = []
    windows.on('returned', (...args) => returned.push(args))
    windows.open('s1')
    windows.dock(contents(created[0]!.win), handoff('x'))
    expect(returned).toEqual([['s1', handoff('x'), true]])
  })

  it('gives back what a window never took', () => {
    const windows = service()
    const returned: unknown[][] = []
    windows.on('returned', (...args) => returned.push(args))
    windows.open('s1', handoff('mitgebracht'))
    created[0]!.win.webContents.loading = true
    created[0]!.win.close()
    expect(returned).toEqual([['s1', handoff('mitgebracht'), false]])
  })

  it('opens the windows of the last run again, where they were', async () => {
    const first = service()
    first.open('s1')
    first.open('gone')
    created[0]!.onBounds({ x: 10, y: 20, width: 600, height: 700, maximized: false })
    // Nexa quits: the windows close without asking and are kept for the next start.
    quitting = true
    for (const { win } of created) win.close()
    await first.flush()

    created = []
    quitting = false
    const next = service()
    await next.init()
    next.restore((id) => id !== 'gone')
    expect(created.map((c) => [c.id, c.saved])).toEqual([['s1', { x: 10, y: 20, width: 600, height: 700, maximized: false }]])
    await next.flush()
    const stored = JSON.parse(await readFile(join(dir, 'chat-windows.json'), 'utf8')) as { open: string[] }
    expect(stored.open).toEqual(['s1'])
  })

  it('forgets a window the user closed, and closes those of deleted chats', async () => {
    const windows = service()
    windows.open('s1')
    windows.open('s2')
    windows.close(['s1'])
    expect(created[0]!.win.destroyed).toBe(true)
    windows.keepSessions((id) => id !== 's2')
    expect(created[1]!.win.destroyed).toBe(true)
    await windows.flush()
    const stored = JSON.parse(await readFile(join(dir, 'chat-windows.json'), 'utf8')) as { open: string[] }
    expect(stored.open).toEqual([])
  })
})
