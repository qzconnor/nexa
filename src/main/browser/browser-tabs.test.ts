import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BLANK_PAGE } from '@shared/browser'
import { BrowserTabs, MAX_TABS_PER_SESSION } from './browser-tabs'

describe('BrowserTabs', () => {
  it('opens tabs per chat and shows the newest unless it opens in the background', () => {
    const tabs = new BrowserTabs(null)
    const first = tabs.open('a', { url: 'https://example.com/' })
    expect(tabs.shownOf('a')).toBe(first.id)
    const second = tabs.open('a', { url: 'https://example.org/', background: true })
    expect(tabs.shownOf('a')).toBe(first.id)
    const third = tabs.open('a')
    expect(third.url).toBe(BLANK_PAGE)
    expect(tabs.shownOf('a')).toBe(third.id)
    expect(tabs.ofSession('a').map((t) => t.id)).toEqual([first.id, second.id, third.id])
    expect(tabs.ofSession('b')).toEqual([])
    expect(tabs.shownOf('b')).toBeNull()
  })

  it('keeps who opened a tab, so the agent closes only its own', () => {
    const tabs = new BrowserTabs(null)
    expect(tabs.open('a', { byAgent: true }).openedByAgent).toBe(true)
    expect(tabs.open('a').openedByAgent).toBe(false)
  })

  it('refuses other schemes and too many tabs', () => {
    const tabs = new BrowserTabs(null)
    expect(() => tabs.open('a', { url: 'file:///C:/Windows' })).toThrow()
    for (let i = 0; i < MAX_TABS_PER_SESSION; i++) tabs.open('a')
    expect(() => tabs.open('a')).toThrow()
    expect(() => tabs.open('b')).not.toThrow()
  })

  it('shows the neighbour of a closed tab, like a browser', () => {
    const tabs = new BrowserTabs(null)
    const [one, two, three] = [tabs.open('a'), tabs.open('a'), tabs.open('a')]
    tabs.show('a', two.id)
    tabs.close(two.id)
    expect(tabs.shownOf('a')).toBe(three.id)
    tabs.close(three.id)
    expect(tabs.shownOf('a')).toBe(one.id)
    tabs.close(one.id)
    expect(tabs.shownOf('a')).toBeNull()
  })

  it('shows only tabs of the same chat', () => {
    const tabs = new BrowserTabs(null)
    tabs.open('a')
    const other = tabs.open('b')
    tabs.show('a', other.id)
    expect(tabs.shownOf('a')).not.toBe(other.id)
  })

  it('takes what the page reports, and drops the tabs of chats that are gone', () => {
    const tabs = new BrowserTabs(null)
    const tab = tabs.open('a')
    tabs.open('b')
    const changes: number[] = []
    tabs.on('changed', (state) => changes.push(state.tabs.length))
    tabs.setPage(tab.id, { url: 'https://example.com/', title: '  Example \n Domain ' })
    expect(tabs.get(tab.id)).toMatchObject({ url: 'https://example.com/', title: 'Example Domain' })
    tabs.setPage(tab.id, { url: 'javascript:alert(1)', title: 'x' })
    expect(tabs.get(tab.id)?.url).toBe('https://example.com/')
    tabs.keepSessions((id) => id === 'a')
    expect(tabs.list().map((t) => t.sessionId)).toEqual(['a'])
    expect(changes).toEqual([2, 1])
  })

  describe('saved', () => {
    let dir: string | null = null
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = null
    })

    it('comes back after a restart, with the shown tab', async () => {
      dir = await mkdtemp(join(tmpdir(), 'nexa-browser-tabs-'))
      const file = join(dir, 'browser-tabs.json')
      const tabs = new BrowserTabs(file)
      tabs.open('a', { url: 'https://example.com/' })
      const shown = tabs.open('a', { url: 'https://example.org/', byAgent: true })
      await tabs.flush()
      expect(JSON.parse(await readFile(file, 'utf8')).tabs).toHaveLength(2)

      const again = new BrowserTabs(file)
      expect(again.ofSession('a').map((t) => t.url)).toEqual(['https://example.com/', 'https://example.org/'])
      expect(again.shownOf('a')).toBe(shown.id)
      expect(again.get(shown.id)?.openedByAgent).toBe(true)
    })
  })
})
