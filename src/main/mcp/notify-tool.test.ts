import { describe, expect, it, vi } from 'vitest'
import { notifyRequest, notifyResult, NotifyTool } from './notify-tool'

describe('notifyRequest', () => {
  it('takes title, message and distinct actions, with the default wait', () => {
    expect(notifyRequest({ title: ' Briefing \n fertig ', message: 'Drei neue Issues.\nEins dringend.', actions: ['Öffnen', ' Später ', 'Öffnen', ''] })).toEqual({
      title: 'Briefing fertig',
      message: 'Drei neue Issues.\nEins dringend.',
      actions: ['Öffnen', 'Später'],
      waitMs: 10 * 60_000,
    })
  })

  it('keeps the wait within bounds and cuts long texts', () => {
    expect(notifyRequest({ title: 'T', waitMinutes: 600 }).waitMs).toBe(14 * 60_000)
    expect(notifyRequest({ title: 'T', waitMinutes: 0 }).waitMs).toBe(30_000)
    expect(notifyRequest({ title: 'x'.repeat(500) }).title).toHaveLength(120)
  })

  it('refuses what makes no notification, saying why', () => {
    expect(() => notifyRequest({ message: 'ohne Titel' })).toThrow(/title/)
    expect(() => notifyRequest({ title: 'T', actions: 'Ja' })).toThrow(/list/)
    expect(() => notifyRequest({ title: 'T', actions: ['a', 'b', 'c', 'd'] })).toThrow(/at most 3/)
  })
})

describe('notifyResult', () => {
  it('tells the agent what the user picked, or that nothing came', () => {
    expect(notifyResult({ kind: 'action', action: 'Freigeben' }).content[0]).toMatchObject({ text: 'The user picked "Freigeben".' })
    expect(notifyResult({ kind: 'timeout', minutes: 10 }).content[0]).toMatchObject({ text: expect.stringContaining('10 minutes') })
    expect(notifyResult({ kind: 'cancelled' }).isError).toBe(true)
    expect(notifyResult({ kind: 'off' }).isError).toBeUndefined()
  })
})

describe('NotifyTool', () => {
  it('sends the notification for the calling chat', async () => {
    const notify = vi.fn(async () => ({ kind: 'shown' as const }))
    const tool = new NotifyTool({ notify })
    const result = await tool.call('chat-1', { title: 'Fertig' })
    expect(notify).toHaveBeenCalledWith('chat-1', { title: 'Fertig', actions: [], waitMs: 600_000 }, undefined)
    expect(result.isError).toBeUndefined()
  })

  it('needs a chat and valid arguments', async () => {
    const notify = vi.fn()
    const tool = new NotifyTool({ notify })
    expect((await tool.call(null, { title: 'T' })).isError).toBe(true)
    expect((await tool.call('chat-1', {})).isError).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
})
