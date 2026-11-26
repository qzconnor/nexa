import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { defaultSettings } from '@shared/defaults'
import { levelAllows, type RemoteLevel } from '@shared/remote'
import type { Project, ProjectSection, SessionMeta } from '@shared/types'

// This device's settings and what the other one allows: the store reads both, the tests set them.
const local = reactive({ settings: defaultSettings() })
let level: RemoteLevel = 'full'
vi.mock('./settings', () => ({ useSettingsStore: () => local }))
vi.mock('./devices', () => ({ useDevicesStore: () => ({ can: (_device: string | null, needed: RemoteLevel) => levelAllows(level, needed) }) }))

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
})

const { useKeptHereStore } = await import('./kept-here')

const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, name: id, path: `C:\\${id}`, createdAt: 0, ...extra }) as Project
const section = (id: string, extra: Partial<ProjectSection> = {}): ProjectSection => ({ id, name: id, ...extra }) as ProjectSection
const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
  ({ id, projectId: 'p', title: id, titleSource: 'auto', provider: 'claude', model: '', effort: '', permissionMode: 'ask', createdAt: 0, updatedAt: 0, cli: {}, ...extra }) as SessionMeta

beforeEach(() => {
  setActivePinia(createPinia())
  storage.clear()
  local.settings = defaultSettings()
  level = 'full'
})

const flush = () => new Promise((resolve) => setTimeout(resolve))

describe('useKeptHereStore', () => {
  it('sends everything while all is shared and allowed', () => {
    const kept = useKeptHereStore('laptop')
    expect(kept.keepPlace('project', 'p', { collapsed: true, name: 'Neu' })).toEqual({ collapsed: true, name: 'Neu' })
    expect(kept.keepChat('c', { pinned: true, model: 'opus' } as never)).toEqual({ pinned: true, model: 'opus' })
    expect(kept.keepLayout([{ id: 's', projects: ['p'] }])).toBe(false)
    expect(kept.keepSettings({ defaults: { provider: 'codex' } })).toBe(false)
  })

  it('keeps folding here when it isn’t shared, and still sends a rename', () => {
    local.settings.remote.sync.foldProjects = false
    const kept = useKeptHereStore('laptop')
    expect(kept.keepPlace('project', 'p', { collapsed: true, name: 'Neu' })).toEqual({ name: 'Neu' })
    const { projects } = kept.projectsView([project('p'), project('q')], [])
    expect(projects.map((p) => p.collapsed)).toEqual([true, undefined])
  })

  it('keeps what the device doesn’t allow, whatever the setting', () => {
    level = 'read'
    const kept = useKeptHereStore('laptop')
    expect(kept.keeps('foldSections')).toBe(true)
    expect(kept.keepPlace('section', 's', { collapsed: true })).toEqual({})
    expect(kept.projectsView([], [section('s')]).sections[0]?.collapsed).toBe(true)
    // The start page's picks need everything.
    level = 'prompt'
    expect(kept.keeps('defaults')).toBe(true)
    expect(kept.keeps('pin')).toBe(false)
  })

  it('shows what is kept only while it is kept', () => {
    local.settings.remote.sync.pin = false
    const kept = useKeptHereStore('laptop')
    kept.keepChat('c', { pinned: true })
    expect(kept.chatView(meta('c')).pinned).toBe(true)
    local.settings.remote.sync.pin = true
    expect(kept.chatView(meta('c')).pinned).toBeUndefined()
  })

  it('drops what was kept of a field once it is sent', () => {
    local.settings.remote.sync.rename = false
    const kept = useKeptHereStore('laptop')
    kept.keepChat('c', { title: 'Hier', pinned: true })
    local.settings.remote.sync.rename = true
    expect(kept.keepChat('c', { title: 'Dort' })).toEqual({ title: 'Dort' })
    local.settings.remote.sync.rename = false
    expect(kept.chatView(meta('c')).title).toBe('c')
  })

  it('keeps the order here and lays the device’s lists out by it', () => {
    local.settings.remote.sync.order = false
    const kept = useKeptHereStore('laptop')
    expect(kept.keepLayout([{ id: 'b', projects: ['q'] }, { id: 'a', projects: ['p'] }])).toBe(true)
    const shown = kept.projectsView([project('p', { sectionId: 'a' }), project('q', { sectionId: 'a' }), project('r')], [section('a'), section('b')])
    expect(shown.sections.map((s) => s.id)).toEqual(['b', 'a'])
    expect(shown.projects.map((p) => [p.id, p.sectionId])).toEqual([
      ['q', 'b'],
      ['p', 'a'],
      ['r', undefined],
    ])
  })

  it('uses this device’s look always, and its chat display where that isn’t shared', () => {
    const kept = useKeptHereStore('laptop')
    const theirs = defaultSettings()
    theirs.appearance.theme = 'theirs'
    theirs.chat.showThinking = !local.settings.chat.showThinking
    theirs.chat.enterSends = !local.settings.chat.enterSends
    let view = kept.settingsView(theirs)
    expect(view.appearance).toEqual(local.settings.appearance)
    expect(view.chat.showThinking).toBe(theirs.chat.showThinking)

    local.settings.remote.sync.showThinking = false
    view = kept.settingsView(theirs)
    expect(view.chat.showThinking).toBe(local.settings.chat.showThinking)
    expect(view.chat.enterSends).toBe(theirs.chat.enterSends)
  })

  it('keeps the start page’s picks here and shows them over the device’s defaults', () => {
    local.settings.remote.sync.defaults = false
    const kept = useKeptHereStore('laptop')
    expect(kept.keepSettings({ defaults: { provider: 'codex' } })).toBe(true)
    expect(kept.keepSettings({ codex: { model: 'gpt-5' } })).toBe(true)
    const view = kept.settingsView(defaultSettings())
    expect(view.defaults.provider).toBe('codex')
    expect(view.codex.model).toBe('gpt-5')
    expect(view.defaults.permissionMode).toBe(defaultSettings().defaults.permissionMode)
  })

  it('forgets what was kept of a setting, and only of it', () => {
    local.settings.remote.sync.pin = false
    local.settings.remote.sync.foldProjects = false
    const kept = useKeptHereStore('laptop')
    kept.keepChat('c', { pinned: true })
    kept.keepPlace('project', 'p', { collapsed: true })
    kept.forget(['pin'])
    expect(kept.chatView(meta('c')).pinned).toBeUndefined()
    expect(kept.projectsView([project('p')], []).projects[0]?.collapsed).toBe(true)
  })

  it('remembers it per device across a restart of the window', async () => {
    local.settings.remote.sync.pin = false
    useKeptHereStore('laptop').keepChat('c', { pinned: true })
    await flush()
    setActivePinia(createPinia())
    expect(useKeptHereStore('laptop').chatView(meta('c')).pinned).toBe(true)
    expect(useKeptHereStore('desktop').chatView(meta('c')).pinned).toBeUndefined()
  })
})
