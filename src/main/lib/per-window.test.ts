import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { endRemoteSender, perWindow, remoteSender } from './per-window'

class Sender extends EventEmitter {
  constructor(readonly id: number) {
    super()
  }
}

describe('perWindow', () => {
  it('joins what every window asks for, and drops a window that goes', async () => {
    const apply = vi.fn((all: string[]) => all.length)
    const watch = perWindow(apply)
    const main = new Sender(1)
    const chat = new Sender(2)
    watch(main, ['a', 'b'])
    expect(watch(chat, ['c'])).toBe(3)
    expect(apply).toHaveBeenLastCalledWith(['a', 'b', 'c'])
    watch(main, ['a'])
    expect(apply).toHaveBeenLastCalledWith(['a', 'c'])
    chat.emit('destroyed')
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(['a']))
  })

  it('listens for the end of a window once', () => {
    const watch = perWindow(() => undefined)
    const main = new Sender(1)
    watch(main, ['a'])
    watch(main, ['b'])
    expect(main.listenerCount('destroyed')).toBe(1)
  })
})

describe('remoteSender', () => {
  it('keeps what another device asks for apart from the windows, until it stops watching', async () => {
    const apply = vi.fn((all: string[]) => all.length)
    const watch = perWindow(apply)
    const main = new Sender(1)
    watch(main, ['a'])
    const laptop = remoteSender('laptop')
    expect(remoteSender('laptop')).toBe(laptop)
    expect(laptop.id).toBeLessThan(0)
    expect(remoteSender('tablet').id).not.toBe(laptop.id)
    watch(laptop, ['x'])
    watch(remoteSender('tablet'), ['y'])
    expect(apply).toHaveBeenLastCalledWith(['a', 'x', 'y'])
    // The laptop's list replaces its own, not the window's.
    watch(laptop, ['z'])
    expect(apply).toHaveBeenLastCalledWith(['a', 'z', 'y'])
    endRemoteSender('laptop')
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(['a', 'y']))
    // Watching again later, it starts anew.
    const again = remoteSender('laptop')
    expect(again).not.toBe(laptop)
    watch(again, ['w'])
    expect(apply).toHaveBeenLastCalledWith(['a', 'y', 'w'])
    endRemoteSender('tablet')
    endRemoteSender('laptop')
    endRemoteSender('nobody')
    await vi.waitFor(() => expect(apply).toHaveBeenLastCalledWith(['a']))
  })
})
