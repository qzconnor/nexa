import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { perWindow } from './per-window'

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
