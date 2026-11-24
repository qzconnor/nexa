import { readonly, ref } from 'vue'
import type { ClaudeManagerFound } from '@shared/import-ipc'

/**
 * Whether the Claude Manager is on this computer, for what Nexa shows of it. Its import shows while its
 * data is there (`found`; the data stays after an uninstall, and so do the logins Nexa's accounts use in
 * it); hints at what the Claude Manager does show only while it is installed. Neither: nothing of it.
 */
const found = ref<ClaudeManagerFound | null>(null)
const installed = ref(false)
let loaded: Promise<void> | null = null

async function load(): Promise<void> {
  const [data, present] = await Promise.all([
    window.api.claudeManager.detect().catch(() => null),
    window.api.claudeManager.installed().catch(() => false),
  ])
  found.value = data
  installed.value = present
}

export function useClaudeManager() {
  loaded ??= load()
  return {
    found: readonly(found),
    installed: readonly(installed),
    /** Asks again, e.g. when the settings open: it may have been uninstalled meanwhile. */
    refresh: () => (loaded = load()),
    ready: () => loaded!,
  }
}
