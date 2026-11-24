<script setup lang="ts">
import { SearchIcon, SearchXIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { searchTerms } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useClaudeManager } from '@/composables/useClaudeManager'
import { provideSettingsFilter, SETTINGS } from '@/composables/useSettingsSearch'
import { matchSettings } from '@/lib/settings-index'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useUiStore, type SettingsSection } from '@/stores/ui'
import { SETTINGS_ICONS } from './settings-icons'
import SettingsAbout from './SettingsAbout.vue'
import SettingsAccounts from './SettingsAccounts.vue'
import SettingsApi from './SettingsApi.vue'
import SettingsAppearance from './SettingsAppearance.vue'
import SettingsChat from './SettingsChat.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsNotifications from './SettingsNotifications.vue'
import SettingsProviders from './SettingsProviders.vue'
import SettingsUpdates from './SettingsUpdates.vue'
import SettingsUsage from './SettingsUsage.vue'

/**
 * The settings as a dialog over the window: sections on the left, their cards on the right. Changes
 * apply at once, so there is nothing to save. The search goes through all sections at once: instead
 * of one section the dialog shows every card and row that matches, with their controls.
 */
const ui = useUiStore()
const accounts = useAccountsStore()

const SECTIONS: { id: SettingsSection; label: string; description: string; icon: Component; page: Component }[] = [
  { id: 'general', label: 'Allgemein', description: 'Fenster, Infobereich und Start', icon: SETTINGS_ICONS.general, page: SettingsGeneral },
  { id: 'appearance', label: 'Darstellung', description: 'Theme, Fenster und Chat-Breite', icon: SETTINGS_ICONS.appearance, page: SettingsAppearance },
  { id: 'accounts', label: 'Accounts', description: 'Mehrere Logins je CLI, Vorgabe für neue Chats', icon: SETTINGS_ICONS.accounts, page: SettingsAccounts },
  { id: 'usage', label: 'Verbrauch', description: 'Limits je Account und Tokens der Chats', icon: SETTINGS_ICONS.usage, page: SettingsUsage },
  { id: 'providers', label: 'CLIs', description: 'Claude Code und Codex', icon: SETTINGS_ICONS.providers, page: SettingsProviders },
  { id: 'chat', label: 'Chat', description: 'Verlauf, Eingabe, Löschen und Nexa-Werkzeuge', icon: SETTINGS_ICONS.chat, page: SettingsChat },
  {
    id: 'notifications',
    label: 'Benachrichtigungen',
    description: 'Fertige Chats, Rückfragen und Limits',
    icon: SETTINGS_ICONS.notifications,
    page: SettingsNotifications,
  },
  { id: 'api', label: 'Lokale API', description: 'Für Stream Deck und Skripte', icon: SETTINGS_ICONS.api, page: SettingsApi },
  { id: 'updates', label: 'Updates', description: 'Neue Versionen und was sich geändert hat', icon: SETTINGS_ICONS.updates, page: SettingsUpdates },
  { id: 'about', label: 'Info', description: 'Version und Befehl nx', icon: SETTINGS_ICONS.about, page: SettingsAbout },
]
const current = computed(() => SECTIONS.find((s) => s.id === ui.settingsSection) ?? SECTIONS[0])

const query = ref('')
const terms = computed(() => searchTerms(query.value))
const match = computed(() => matchSettings(SETTINGS.value, terms.value))
provideSettingsFilter(terms, match)

/** The sections with something that matches, in their order. */
const results = computed(() => (match.value ? SECTIONS.filter((s) => match.value!.tabs.has(s.id)) : []))
const hitCount = computed(() => [...(match.value?.tabs.values() ?? [])].reduce((sum, n) => sum + n, 0))

const content = ref<HTMLElement | null>(null)
const SEARCH_ID = 'settings-search'

watch(
  () => ui.settingsSection,
  () => content.value?.scrollTo({ top: 0 }),
)
watch(terms, () => content.value?.scrollTo({ top: 0 }))
// A new opening starts without the last search, and asks again whether the Claude Manager is there
// (uninstalled meanwhile, its import and hints go).
const claudeManager = useClaudeManager()
watch(
  () => ui.settingsOpen,
  (open) => {
    if (!open) return
    query.value = ''
    void claudeManager.refresh()
  },
)

function focusSearch(): void {
  const input = document.getElementById(SEARCH_ID)
  if (input instanceof HTMLInputElement) {
    input.focus()
    input.select()
  }
}

/** A section from the list: the search ends and the section shows. */
function select(id: SettingsSection): void {
  query.value = ''
  ui.selectSettings(id)
}

/** How long a card or row asked for from the quick open stays marked. */
const REVEAL_MS = 1600

/**
 * A card or row asked for from the quick open: it scrolls into view, briefly marked, and a row's
 * control gets the keyboard. False when nothing was asked for or it isn't there.
 */
async function reveal(): Promise<boolean> {
  const anchor = ui.settingsAnchor
  if (!anchor) return false
  ui.settingsAnchor = null
  await nextTick()
  const target = content.value?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(anchor)}"]`)
  if (!target) return false
  target.scrollIntoView({ block: 'center' })
  target.dataset.revealed = ''
  setTimeout(() => delete target.dataset.revealed, REVEAL_MS)
  const control = target.matches('[data-slot=card]')
    ? null
    : target.querySelector<HTMLElement>('input, select, textarea, button, [role=switch], [role=combobox], [tabindex="0"]')
  ;(control ?? content.value)?.focus({ preventScroll: true })
  return true
}

// Asked for while the settings are open already (the quick open over them).
watch(
  () => ui.settingsAnchor,
  (anchor) => {
    if (!anchor || !ui.settingsOpen || !content.value) return
    query.value = ''
    void reveal()
  },
)

/** Focus goes to the search, as in the settings of most apps: typing finds a setting right away. */
function onOpen(event: Event): void {
  event.preventDefault()
  void nextTick(async () => {
    if (!(await reveal())) focusSearch()
  })
}

/** Escape clears the search first; while a dialog is open on top (theme editor, account, question), it belongs to it. */
function onEscape(event: KeyboardEvent): void {
  if (ui.themeEditorRequest || ui.confirmState?.open || accounts.formRequest || accounts.loginId) {
    event.preventDefault()
    return
  }
  if (query.value && document.activeElement?.id === SEARCH_ID) {
    event.preventDefault()
    query.value = ''
  }
}

/** Ctrl+F: to the search. */
function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    focusSearch()
  }
}

/** Enter in the search: the first hit's section, without the search. */
function onSearchEnter(): void {
  const first = results.value[0]
  if (first) select(first.id)
}
</script>

<template>
  <Dialog v-model:open="ui.settingsOpen">
    <DialogContent
      :show-close-button="false"
      class="flex h-[min(52rem,calc(100vh-4rem))] w-[min(68rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      @escape-key-down="onEscape"
      @open-auto-focus="onOpen"
      @keydown="onKeydown"
    >
      <nav class="flex w-56 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2">
        <DialogTitle class="px-2.5 pt-2 pb-3 text-base">Einstellungen</DialogTitle>
        <DialogDescription class="sr-only">Änderungen gelten sofort.</DialogDescription>
        <InputGroup class="mb-2 h-8 bg-background/40">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            :id="SEARCH_ID"
            v-model="query"
            placeholder="Suchen"
            aria-label="Einstellungen suchen"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="onSearchEnter"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton v-if="query" size="icon-xs" aria-label="Suche leeren" @click="query = ''"><XIcon /></InputGroupButton>
            <Kbd v-else>Strg+F</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <button
          v-for="section in SECTIONS"
          :key="section.id"
          type="button"
          :class="
            cn(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted/70',
              !match && current.id === section.id && 'bg-muted font-medium',
              match && !match.tabs.has(section.id) && 'opacity-45',
            )
          "
          :aria-current="!match && current.id === section.id ? 'page' : undefined"
          @click="select(section.id)"
        >
          <component :is="section.icon" class="size-4 text-muted-foreground" />
          <span class="flex-1">{{ section.label }}</span>
          <span v-if="match?.tabs.get(section.id)" class="rounded-full bg-primary/15 px-1.5 text-[0.7rem] font-medium text-primary tabular-nums">
            {{ match.tabs.get(section.id) }}
          </span>
        </button>
      </nav>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center gap-3 border-b px-6 py-3">
          <div class="min-w-0 flex-1">
            <template v-if="match">
              <h2 class="text-base font-semibold">Suche</h2>
              <p class="truncate text-xs text-muted-foreground">
                {{ hitCount === 1 ? 'Ein Treffer' : `${hitCount} Treffer` }} für „{{ query.trim() }}“
              </p>
            </template>
            <template v-else>
              <h2 class="text-base font-semibold">{{ current.label }}</h2>
              <p class="text-xs text-muted-foreground">{{ current.description }}</p>
            </template>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Schließen" @click="ui.settingsOpen = false">
            <XIcon />
          </Button>
        </header>

        <div ref="content" tabindex="-1" class="min-h-0 flex-1 overflow-y-auto px-6 py-5 outline-none">
          <!-- Search: every section with hits, each with only its matching cards and rows. -->
          <div v-if="match" class="flex flex-col gap-8">
            <section v-for="result in results" :key="result.id" class="flex flex-col gap-3" :aria-label="result.label">
              <button
                type="button"
                class="flex w-fit items-center gap-2 rounded-md text-sm font-semibold text-muted-foreground hover:text-foreground"
                @click="select(result.id)"
              >
                <component :is="result.icon" class="size-4" />
                {{ result.label }}
              </button>
              <component :is="result.page" />
            </section>

            <Empty v-if="!results.length" class="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchXIcon /></EmptyMedia>
                <EmptyTitle>Keine Einstellung gefunden</EmptyTitle>
                <EmptyDescription>Nichts passt zu „{{ query.trim() }}“.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
          <component :is="current.page" v-else />
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
