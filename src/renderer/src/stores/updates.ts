import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ReleaseNotes, ReleaseReference, UpdateState } from '@shared/updates'
import { attempt } from '@/lib/errors'
import { useSessionsStore } from './sessions'
import { useUiStore } from './ui'

const SEEN_KEY = 'nexa.seenVersion'
/** A version the user found themselves and downloaded: once it runs, it gets no dot on the settings button. */
const QUIET_KEY = 'nexa.quietVersion'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, version: string | null): void {
  try {
    if (version === null) localStorage.removeItem(key)
    else localStorage.setItem(key, version)
  } catch {
    // Private storage off: the hint after an update just comes again.
  }
}

const readSeen = () => readStored(SEEN_KEY)
const writeSeen = (version: string) => writeStored(SEEN_KEY, version)

/** New versions of the installed app and their release notes (the section „Updates“ of the settings). */
export const useUpdatesStore = defineStore('updates', () => {
  const state = ref<UpdateState>({
    status: 'unsupported',
    current: '',
    next: null,
    progress: 0,
    checkedAt: null,
    error: null,
    foundByUser: false,
  })
  /** The release notes as main has them: the newest page comes with each check, older ones on request. */
  const releases = ref<ReleaseNotes>({
    notes: [],
    complete: false,
    loadedAt: null,
    loading: false,
    error: null,
    loadingMore: false,
    moreError: null,
  })
  /** Version whose notes were looked at – if the installed one differs, the app was updated. */
  const seenVersion = ref<string | null>(readSeen())
  /** Version installed by an update since the notes were looked at last – highlighted while the app runs. */
  const justUpdated = ref<string | null>(null)
  /** Pull request descriptions loaded so far, kept while the app runs (GitHub allows 60 requests an hour). */
  const references = ref<Record<number, ReleaseReference>>({})

  /** A newer version is offered (also while downloading, or after a failed download). */
  const hasUpdate = computed(
    () =>
      ['available', 'downloading', 'downloaded'].includes(state.value.status) ||
      (state.value.status === 'error' && state.value.next !== null),
  )
  /** An update the automatic check found: the settings button pulses for it. One the user looked for, they know of. */
  const announced = computed(() => hasUpdate.value && !state.value.foundByUser)
  /** Updated since the notes were last opened – "what's new" is still to be seen. */
  const unseen = computed(() => !!state.value.current && !!seenVersion.value && seenVersion.value !== state.value.current)

  const show = () => useUiStore().openSettings('updates')

  let toasted: string | null = null

  function apply(next: UpdateState): void {
    const before = state.value.status
    state.value = next
    // Found by the user's own search: the page they look at says so already.
    if (next.status === 'available' && next.next && toasted !== next.next && !next.foundByUser) {
      toasted = next.next
      toast(`Update auf ${next.next} verfügbar`, {
        description: 'Es lässt sich direkt in der App installieren.',
        duration: 12_000,
        action: { label: 'Ansehen', onClick: show },
      })
    }
    // Remembered across the restart that installs it, also one on quitting.
    if (next.status === 'downloaded' && next.next) writeStored(QUIET_KEY, next.foundByUser ? next.next : null)
    if (next.status === 'downloaded' && before !== 'downloaded') {
      toast.success('Update ist bereit', {
        description: `Version ${next.next} wird beim nächsten Start installiert.`,
        duration: 15_000,
        action: { label: 'Jetzt neu starten', onClick: () => void install() },
      })
    }
  }

  async function load(): Promise<void> {
    window.api.updates.onChanged(apply)
    window.api.updates.onShow(show)
    window.api.updates.onReleases((notes) => (releases.value = notes))
    apply(await window.api.updates.state())
    releases.value = await window.api.updates.releases()

    // A fresh install has nothing new to announce.
    if (seenVersion.value === null) {
      seenVersion.value = state.value.current
      writeSeen(state.value.current)
    } else if (unseen.value) {
      toast.success(`Nexa ist jetzt auf Version ${state.value.current}`, {
        duration: 12_000,
        action: { label: 'Was ist neu?', onClick: show },
      })
      // Installed after a search of the user's own: no dot on the settings button for it.
      if (readStored(QUIET_KEY) === state.value.current) markSeen()
    }
    if (readStored(QUIET_KEY) === state.value.current) writeStored(QUIET_KEY, null)
  }

  function markSeen(): void {
    if (unseen.value) justUpdated.value = state.value.current
    seenVersion.value = state.value.current
    writeSeen(state.value.current)
  }

  /** Loads the description of a pull request (or issue) from the notes once; throws if GitHub refuses. */
  async function loadReference(number: number): Promise<void> {
    if (references.value[number]) return
    references.value[number] = await window.api.updates.reference(number)
  }

  /** Asks GitHub for the newest notes again; how it went comes with the notes (`error`). */
  const reloadReleases = () => attempt(() => window.api.updates.reloadReleases(), 'Versionshinweise konnten nicht geladen werden')
  /** Asks GitHub for the next older notes; how it went comes with the notes (`moreError`). */
  const moreReleases = () => attempt(() => window.api.updates.moreReleases(), 'Ältere Versionen konnten nicht geladen werden')

  const check = () => attempt(() => window.api.updates.check(), 'Update-Suche fehlgeschlagen')
  const download = () => attempt(() => window.api.updates.download(), 'Download fehlgeschlagen')

  /** The installer closes the app, which ends the answers that are still running: asked before. */
  async function install(): Promise<void> {
    const sessions = useSessionsStore(null)
    const running = [...sessions.runtimes.values()].filter((r) => r.status === 'running' || r.status === 'waiting').length
    if (running > 0) {
      const confirmed = await useUiStore().confirm({
        title: 'Neu starten und installieren?',
        description:
          running === 1
            ? 'In 1 Chat läuft noch eine Antwort. Sie bricht dabei ab, der Chat lässt sich danach fortsetzen.'
            : `In ${running} Chats laufen noch Antworten. Sie brechen dabei ab, die Chats lassen sich danach fortsetzen.`,
        confirmText: 'Neu starten',
        destructive: true,
      })
      if (!confirmed) return
    }
    await attempt(() => window.api.updates.install(), 'Update konnte nicht installiert werden')
  }

  return {
    state,
    releases,
    references,
    justUpdated,
    hasUpdate,
    announced,
    unseen,
    load,
    markSeen,
    reloadReleases,
    moreReleases,
    loadReference,
    check,
    download,
    install,
  }
})
