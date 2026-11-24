import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { settingsIndex, type SettingsAnchor, type SettingsEntry, type SettingsMatch } from '@/lib/settings-index'
import { useClaudeManager } from './useClaudeManager'

const claudeManager = useClaudeManager()

/** The cards and rows of the settings on this system; the Claude Manager's import only while its data is there. */
export const SETTINGS = computed<readonly SettingsEntry[]>(() => settingsIndex(window.api.platform, !!claudeManager.found.value))

export interface SettingsFilter {
  /** Words of the search, to mark them; empty without a search. */
  terms: Readonly<Ref<string[]>>
  /** Whether a card or row is shown; without a search every one is. */
  shows: (anchor: SettingsAnchor) => boolean
}

const KEY: InjectionKey<SettingsFilter> = Symbol('settings-filter')
const UNFILTERED: SettingsFilter = { terms: ref([]), shows: () => true }

/** Hands the search of the settings dialog to its cards and rows. */
export function provideSettingsFilter(terms: Readonly<Ref<string[]>>, match: Readonly<Ref<SettingsMatch | null>>): void {
  provide(KEY, { terms, shows: (anchor) => !match.value || match.value.ids.has(anchor) })
}

/** The search of the settings, for a card or row; outside of it everything is shown. */
export const useSettingsFilter = (): SettingsFilter => inject(KEY, UNFILTERED)
