import { reactive, watch } from 'vue'
import { DISPLAY_KEYS, SYNC_LEVEL, type SyncKey } from '@shared/remote-sync'
import { applyLayout, type SectionLayout } from '@shared/sections'
import type { AppSettings, DeepPartial, Project, ProjectSection, SessionMeta } from '@shared/types'
import { isPlainObject, mergeKnown } from '@shared/utils'
import { scopedStore } from './device'
import { useDevicesStore } from './devices'
import { useSettingsStore } from './settings'

/** What a project or separator of the other device is here only. */
interface KeptPlace {
  collapsed?: boolean
  name?: string
}

/** What a chat of the other device is here only. */
interface KeptChat {
  pinned?: boolean
  archived?: boolean
  title?: string
}

interface Kept {
  projects: Record<string, KeptPlace>
  sections: Record<string, KeptPlace>
  sessions: Record<string, KeptChat>
  layout: SectionLayout[] | null
  /** The start page's picks for new chats (`defaults`, a CLI's model and effort). */
  settings: DeepPartial<AppSettings>
}

/** Which setting decides about each field kept here. */
const PLACE_KEYS: Record<keyof KeptPlace, (kind: 'project' | 'section') => SyncKey> = {
  collapsed: (kind) => (kind === 'project' ? 'foldProjects' : 'foldSections'),
  name: () => 'rename',
}
const CHAT_KEYS: Record<keyof KeptChat, SyncKey> = { pinned: 'pin', archived: 'archive', title: 'rename' }

const STORAGE = 'nexa.keptHere.'

/** A copy without Vue's proxies (`structuredClone` refuses them). */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function empty(): Kept {
  return { projects: {}, sections: {}, sessions: {}, layout: null, settings: {} }
}

function read(device: string): Kept {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE + device) ?? 'null')
    if (!isPlainObject(parsed)) return empty()
    const record = (value: unknown) => (isPlainObject(value) ? (value as Record<string, never>) : {})
    return {
      projects: record(parsed.projects),
      sections: record(parsed.sections),
      sessions: record(parsed.sessions),
      layout: Array.isArray(parsed.layout) ? (parsed.layout as SectionLayout[]) : null,
      settings: record(parsed.settings),
    }
  } catch {
    return empty()
  }
}

/** Partial settings into partial settings: unlike `mergeKnown`, keys the target lacks come along. */
function mergePartial(into: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const current = into[key]
    if (isPlainObject(value) && isPlainObject(current)) mergePartial(current, value)
    else into[key] = isPlainObject(value) ? plain(value) : value
  }
}

/**
 * What of another device is kept on this one only (`shared/remote-sync.ts`): its folding, order, pins,
 * archive, names and start-page picks, where the user doesn't share them (Einstellungen › Geräte ›
 * Abgleich) or the device doesn't let this one change them. Its stores show their device's things
 * through it (`projectsView`, `chatView`, `settingsView`) and leave changes here (`keep*`) instead of
 * sending them. Kept per device in the window's storage, like the sidebar's open folders.
 */
export const useKeptHereStore = scopedStore('keptHere', (device) => {
  const kept = reactive<Kept>(device ? read(device) : empty())
  if (device) watch(kept, () => localStorage.setItem(STORAGE + device, JSON.stringify(kept)), { deep: true })

  /** Whether a change of `key` stays here: the user shares it not, or the device doesn't allow it. */
  function keeps(key: SyncKey): boolean {
    if (!device) return false
    if (!useSettingsStore(null).settings.remote.sync[key]) return true
    const needed = SYNC_LEVEL[key]
    return !!needed && !useDevicesStore().can(device, needed)
  }

  // --- What shows --------------------------------------------------------------------------------

  function place<T extends Project | ProjectSection>(item: T, own: KeptPlace | undefined, kind: 'project' | 'section'): T {
    if (!own) return item
    let next = item
    for (const field of Object.keys(own) as (keyof KeptPlace)[]) {
      if (own[field] === undefined || !keeps(PLACE_KEYS[field](kind))) continue
      if (next === item) next = { ...item }
      ;(next as unknown as Record<string, unknown>)[field] = own[field]
    }
    return next
  }

  /** The device's projects and separators as they show here. */
  function projectsView(projects: Project[], sections: ProjectSection[]): { projects: Project[]; sections: ProjectSection[] } {
    let shown = { projects, sections }
    if (kept.layout && keeps('order')) shown = applyLayout(projects, sections, kept.layout)
    return {
      projects: shown.projects.map((p) => place(p, kept.projects[p.id], 'project')),
      sections: shown.sections.map((s) => place(s, kept.sections[s.id], 'section')),
    }
  }

  /** A chat of the device as it shows here. */
  function chatView(meta: SessionMeta): SessionMeta {
    const own = kept.sessions[meta.id]
    if (!own) return meta
    let next = meta
    for (const field of Object.keys(own) as (keyof KeptChat)[]) {
      if (own[field] === undefined || !keeps(CHAT_KEYS[field])) continue
      if (next === meta) next = { ...meta }
      ;(next as unknown as Record<string, unknown>)[field] = own[field]
    }
    return next
  }

  /**
   * The device's settings as its chats and start page use them here: this device's look always (the
   * theme and fonts are this screen's), this one's chat display where it isn't shared, and the picks for
   * new chats kept here.
   */
  function settingsView(own: AppSettings): AppSettings {
    const local = useSettingsStore(null).settings
    let view: AppSettings = { ...own, appearance: local.appearance }
    if (keeps('defaults') && Object.keys(kept.settings).length) view = mergeKnown(view, kept.settings)
    const display = DISPLAY_KEYS.filter((key) => keeps(key))
    if (display.length) view = { ...view, chat: { ...view.chat, ...Object.fromEntries(display.map((key) => [key, local.chat[key]])) } }
    return view
  }

  // --- What stays here ---------------------------------------------------------------------------

  /**
   * Splits a change of a project or separator: what stays here is kept, the rest is to send. Fields
   * that go clear what was kept of them, so turning the setting off later starts from the shared state.
   */
  function keepPlace<P extends KeptPlace>(kind: 'project' | 'section', id: string, patch: P): Partial<P> {
    const list = kind === 'project' ? kept.projects : kept.sections
    const send: Partial<P> = {}
    for (const [field, value] of Object.entries(patch) as [keyof KeptPlace, unknown][]) {
      if (value === undefined) continue
      if (field in PLACE_KEYS && keeps(PLACE_KEYS[field](kind))) {
        list[id] = { ...list[id], [field]: value }
      } else {
        ;(send as Record<string, unknown>)[field] = value
        if (list[id] && field in list[id]) {
          const { [field]: _gone, ...rest } = list[id]
          list[id] = rest
        }
      }
    }
    return send
  }

  /** As `keepPlace`, for a chat. */
  function keepChat<P extends KeptChat>(id: string, patch: P): Partial<P> {
    const send: Partial<P> = {}
    for (const [field, value] of Object.entries(patch) as [string, unknown][]) {
      if (value === undefined) continue
      const key = CHAT_KEYS[field as keyof KeptChat]
      if (key && keeps(key)) {
        kept.sessions[id] = { ...kept.sessions[id], [field]: value }
      } else {
        ;(send as Record<string, unknown>)[field] = value
        const own = kept.sessions[id]
        if (own && field in own) {
          const { [field as keyof KeptChat]: _gone, ...rest } = own
          kept.sessions[id] = rest
        }
      }
    }
    return send
  }

  /** The order after a drag and drop: true when it stays here (nothing to send). */
  function keepLayout(layout: SectionLayout[]): boolean {
    if (!keeps('order')) {
      kept.layout = null
      return false
    }
    kept.layout = plain(layout)
    return true
  }

  /** A pick of the start page: true when it stays here. */
  function keepSettings(patch: DeepPartial<AppSettings>): boolean {
    if (!keeps('defaults')) return false
    mergePartial(kept.settings as Record<string, unknown>, plain(patch) as Record<string, unknown>)
    return true
  }

  /** What was kept of `keys`: a setting turned on or off starts from what the device has. */
  function forget(keys: readonly SyncKey[]): void {
    const has = new Set(keys)
    const strip = <T extends object>(map: Record<string, T>, keyOf: (field: string) => SyncKey | undefined) => {
      for (const [id, own] of Object.entries(map)) {
        const rest = Object.fromEntries(Object.entries(own).filter(([field]) => !has.has(keyOf(field)!))) as T
        if (Object.keys(rest).length) map[id] = rest
        else delete map[id]
      }
    }
    strip(kept.projects, (field) => PLACE_KEYS[field as keyof KeptPlace]?.('project'))
    strip(kept.sections, (field) => PLACE_KEYS[field as keyof KeptPlace]?.('section'))
    strip(kept.sessions, (field) => CHAT_KEYS[field as keyof KeptChat])
    if (has.has('order')) kept.layout = null
    if (has.has('defaults')) kept.settings = {}
  }

  /** A project, separator or chat the device no longer has. */
  function drop(kind: 'projects' | 'sections' | 'sessions', ids: readonly string[]): void {
    for (const id of ids) delete kept[kind][id]
  }

  return { keeps, projectsView, chatView, settingsView, keepPlace, keepChat, keepLayout, keepSettings, forget, drop }
})

/** What was kept of `keys` for every device this window kept something of. */
export function forgetKept(keys: readonly SyncKey[]): void {
  const devices = Object.keys(localStorage)
    .filter((key) => key.startsWith(STORAGE))
    .map((key) => key.slice(STORAGE.length))
  for (const device of devices) useKeptHereStore(device).forget(keys)
}
