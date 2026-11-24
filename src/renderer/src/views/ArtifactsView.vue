<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, CloudOffIcon, RefreshCwIcon, SearchIcon, ShapesIcon, XIcon } from '@lucide/vue'
import { until } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { chatOfArtifact, type Artifact } from '@shared/artifacts'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ArtifactCard from '@/components/artifacts/ArtifactCard.vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { filterArtifacts, type ArtifactFilter } from '@/lib/artifacts'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useArtifactsStore } from '@/stores/artifacts'
import { useBrowsersStore } from '@/stores/browsers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useUiStore } from '@/stores/ui'

/**
 * The pages and documents Claude published on claude.ai with its Artifact tool, per account: shown
 * beside the chat they came from, in the default browser, or their link copied. Codex has no such
 * list (yet): its app-server doesn't give out its Sites.
 */
const accounts = useAccountsStore()
const store = useArtifactsStore()
const sessions = useSessionsStore()
const browsers = useBrowsersStore()
const settings = useSettingsStore()
const themes = useThemesStore()
const ui = useUiStore()
const chat = useChatActions()
// Every 30 seconds: `formatRelative` takes up to 45 seconds as just now.
const now = useClock(30_000)

/** Claude's accounts with a login at claude.ai: API keys have no artifacts. */
const loginAccounts = computed(() => accounts.ofProvider('claude').filter((a) => a.kind !== 'apiKey'))

const accountId = ref('')
watch(
  () => loginAccounts.value.map((a) => a.id),
  (ids) => {
    if (ids.includes(accountId.value)) return
    const preferred = accounts.defaultId('claude')
    accountId.value = ids.includes(preferred) ? preferred : (ids[0] ?? '')
  },
  { immediate: true },
)
const account = computed(() => accounts.get(accountId.value))

const list = computed(() => (accountId.value ? (store.lists[accountId.value] ?? null) : null))
const loading = computed(() => store.loading[accountId.value] === true)

function load(): void {
  if (accountId.value) void attempt(() => store.load(accountId.value), 'Artefakte ließen sich nicht laden')
}
watch(accountId, (id) => id && !store.lists[id] && load(), { immediate: true })
// Back on the page after a while: what changed on claude.ai meanwhile, and the chats since.
onMounted(() => {
  if (list.value && Date.now() - list.value.fetchedAt > 5 * 60_000) load()
  else if (list.value?.artifacts.length) void store.loadChats()
})

/** The chat an artifact came from, while Nexa still has it. */
function chatOf(artifact: Artifact): string | null {
  const sessionId = chatOfArtifact(store.chats, artifact)
  return sessionId && sessions.get(sessionId) ? sessionId : null
}
const chatTitle = (artifact: Artifact) => {
  const sessionId = chatOf(artifact)
  return sessionId ? (sessions.get(sessionId)?.title ?? null) : null
}

const filter = ref<ArtifactFilter>('all')
const query = ref('')
const filterOptions = [
  { value: 'all' as const, label: 'Alle' },
  { value: 'mine' as const, label: 'Eigene' },
  { value: 'shared' as const, label: 'Geteilt' },
  { value: 'chats' as const, label: 'Aus Chats' },
]
const shown = computed(() => (list.value ? filterArtifacts(list.value.artifacts, filter.value, query.value, chatTitle) : []))
const summary = computed(() => {
  const total = list.value?.artifacts.length ?? 0
  const count = shown.value.length
  const noun = (n: number) => (n === 1 ? 'Artefakt' : 'Artefakte')
  return count === total ? `${total} ${noun(total)}` : `${count} von ${total} ${noun(total)}`
})

/** Thumbnails in the theme's brightness. */
const dark = computed(() => themes.find(settings.settings.appearance.theme).mode === 'dark')

const failure = computed(() => {
  const status = list.value?.status
  if (!status || status === 'ok') return null
  const titles = { unavailable: 'Keine Artefakte für diesen Account', 'signed-out': 'Nicht angemeldet', error: 'claude.ai nicht erreichbar' }
  return { title: titles[status], message: list.value!.message, signedOut: status === 'signed-out' }
})

/** A click on the card: beside the chat it came from, without one in the default browser. */
function open(artifact: Artifact): void {
  if (chatOf(artifact)) void showBesideChat(artifact)
  else external(artifact)
}

/**
 * The chat it came from, with the artifact in its browser panel: a tab that shows it already, else a
 * new one. claude.ai asks for a sign-in there once, the browser keeps it.
 */
async function showBesideChat(artifact: Artifact): Promise<void> {
  const sessionId = chatOf(artifact)
  if (!sessionId) return
  await chat.open(sessionId)
  const paths = [artifact.shortId, artifact.id].filter(Boolean).map((id) => `/artifact/${id}`)
  const existing = browsers.tabsOf(sessionId).find((t) => paths.some((path) => t.url.includes(path)))
  const tabId = existing?.id ?? (await browsers.openTab(sessionId, artifact.url))?.id
  if (!tabId) return
  // The panel opens only for a tab it knows of, which the main process reports after it made it.
  await until(() => !!browsers.tab(tabId)).toBe(true, { timeout: 3000 })
  browsers.openInPanel(sessionId, tabId)
}

function external(artifact: Artifact): void {
  void attempt(() => window.api.app.openExternal(artifact.url), 'Artefakt ließ sich nicht öffnen')
}

function goToChat(artifact: Artifact): void {
  const sessionId = chatOf(artifact)
  if (sessionId) void chat.open(sessionId)
}

async function copy(artifact: Artifact): Promise<void> {
  await navigator.clipboard.writeText(artifact.url)
  toast.success('Link kopiert')
}

function resetFilters(): void {
  query.value = ''
  filter.value = 'all'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-8">
      <header class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h1 class="text-xl font-semibold tracking-tight">Artefakte</h1>
          <p class="text-sm text-muted-foreground">Seiten und Dokumente, die Claude auf claude.ai veröffentlicht hat.</p>
        </div>
        <template v-if="loginAccounts.length">
          <DropdownMenu v-if="loginAccounts.length > 1">
            <DropdownMenuTrigger as-child>
              <Button variant="outline" class="gap-2">
                <AccountDot :color="account?.color" />
                <span class="max-w-40 truncate">{{ account?.name ?? 'Account' }}</span>
                <ChevronDownIcon class="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-64">
              <DropdownMenuLabel>Artefakte von</DropdownMenuLabel>
              <DropdownMenuItem v-for="a in loginAccounts" :key="a.id" class="gap-2.5" @select="accountId = a.id">
                <AccountDot :color="a.color" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{{ a.name }}</span>
                  <span v-if="a.identity.email" class="truncate text-xs text-muted-foreground">{{ a.identity.email }}</span>
                </span>
                <CheckIcon v-if="a.id === accountId" class="ml-auto" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" :disabled="loading" @click="load">
            <Spinner v-if="loading" />
            <RefreshCwIcon v-else />
            Aktualisieren
          </Button>
        </template>
      </header>

      <Empty v-if="!loginAccounts.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><ShapesIcon /></EmptyMedia>
          <EmptyTitle>Kein Claude-Account mit Login</EmptyTitle>
          <EmptyDescription>Artefakte gehören zu einem Login bei claude.ai. Accounts mit API-Key haben keine.</EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <div v-if="list?.status === 'ok' && list.artifacts.length" class="flex flex-wrap items-center gap-3">
          <InputGroup class="w-72">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput v-model="query" placeholder="Artefakte durchsuchen" aria-label="Artefakte durchsuchen" spellcheck="false" @keydown.esc="query = ''" />
            <InputGroupAddon v-if="query" align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Suche leeren" @click="query = ''"><XIcon /></InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <SegmentedControl v-model="filter" :options="filterOptions" />
          <span class="ml-auto flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <Spinner v-if="store.searching" class="size-3" v-tooltip="'Sucht die Chats, aus denen sie kamen'" />
            {{ summary }}
          </span>
        </div>

        <div v-if="!list" class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          <div v-for="i in 6" :key="i" class="flex flex-col overflow-hidden rounded-xl border">
            <Skeleton class="aspect-[2/1] w-full rounded-none" />
            <div class="flex flex-col gap-2 p-3">
              <Skeleton class="h-4 w-2/3" />
              <Skeleton class="h-3 w-1/2" />
            </div>
          </div>
        </div>

        <Empty v-else-if="failure" class="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CloudOffIcon /></EmptyMedia>
            <EmptyTitle>{{ failure.title }}</EmptyTitle>
            <EmptyDescription class="selectable">{{ failure.message }}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent class="flex-row justify-center">
            <Button variant="outline" :disabled="loading" @click="load">Erneut versuchen</Button>
            <Button v-if="failure.signedOut" variant="ghost" @click="ui.openSettings('accounts')">Zu den Accounts</Button>
          </EmptyContent>
        </Empty>

        <Empty v-else-if="!list.artifacts.length" class="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ShapesIcon /></EmptyMedia>
            <EmptyTitle>Noch keine Artefakte</EmptyTitle>
            <EmptyDescription>
              Bittest du Claude in einem Chat um eine Seite, ein Diagramm oder ein Dokument zum Teilen, veröffentlicht es sie auf claude.ai. Sie
              erscheinen dann hier.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>

        <Empty v-else-if="!shown.length" class="border">
          <EmptyHeader>
            <EmptyTitle>Keine Treffer</EmptyTitle>
            <EmptyDescription>Kein Artefakt passt zu Suche und Filter.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" @click="resetFilters">Suche und Filter zurücksetzen</Button>
          </EmptyContent>
        </Empty>

        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          <ArtifactCard
            v-for="artifact in shown"
            :key="artifact.id"
            :artifact="artifact"
            :account-id="accountId"
            :dark="dark"
            :chat="chatTitle(artifact)"
            :now="now"
            @open="open(artifact)"
            @panel="showBesideChat(artifact)"
            @external="external(artifact)"
            @chat="goToChat(artifact)"
            @copy="copy(artifact)"
          />
        </div>

        <p v-if="list?.truncated" class="text-xs text-muted-foreground">Es gibt mehr Artefakte, als Nexa auflistet. Alle stehen auf claude.ai.</p>
      </template>
    </div>
  </div>
</template>
