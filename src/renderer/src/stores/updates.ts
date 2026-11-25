import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ReleaseNote, ReleaseReference, UpdateState } from '@shared/updates'
import { attempt, errorMessage } from '@/lib/errors'
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
  const releases = ref<ReleaseNote[] | null>(null)
  const releasesLoading = ref(false)
  const releasesError = ref<string | null>(null)
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
    apply(await window.api.updates.state())

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

  /** Loads the notes again – the main process keeps them for a few minutes, so this is cheap. */
  async function loadReleases(): Promise<void> {
    releasesLoading.value = true
    try {
      releases.value = await window.api.updates.releases()
      releasesError.value = null
    } catch (error) {
      // Notes shown already stay; the error only matters without them.
      if (!releases.value?.length) releasesError.value = errorMessage(error)
    } finally {
      releasesLoading.value = false
    }
  }

  const check = () => attempt(() => window.api.updates.check(), 'Update-Suche fehlgeschlagen')
  const download = () => attempt(() => window.api.updates.download(), 'Download fehlgeschlagen')

  /** The installer closes the app, which ends the answers that are still running: asked before. */
  async function install(): Promise<void> {
    const sessions = useSessionsStore()
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
    releasesLoading,
    releasesError,
    references,
    justUpdated,
    hasUpdate,
    announced,
    unseen,
    load,
    markSeen,
    loadReleases,
    loadReference,
    check,
    download,
    install,
  }
})
