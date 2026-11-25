<script setup lang="ts">
import {
  BlocksIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  LogInIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  SquareSlashIcon,
} from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { McpServerInfo } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/errors'
import { containsTerms, searchText } from '@/lib/search'
import { cn } from '@/lib/utils'
import { useCliConfigStore } from '@/stores/cli-config'
import ComposerPluginsMenu from './ComposerPluginsMenu.vue'

/**
 * The composer's „+“, as in Claude Desktop: files and photos, another folder for the agent, the
 * commands, and in a chat its CLI's MCP servers („Konnektoren“) to switch on and off for the project,
 * connect anew or sign in to, and its plugins.
 */
const props = defineProps<{ sessionId?: string; provider: ProviderId; disabled?: boolean }>()
const emit = defineEmits<{ files: []; folder: []; commands: [] }>()
const cliConfig = useCliConfigStore()

const open = ref(false)
const servers = shallowRef<McpServerInfo[] | null>(null)
const loadedAt = ref(0)
const loading = ref(false)
const failed = ref<string | null>(null)
const query = ref('')

async function loadServers(force = false): Promise<void> {
  const id = props.sessionId
  if (!id || loading.value || (!force && servers.value && Date.now() - loadedAt.value < 30_000)) return
  loading.value = true
  failed.value = null
  try {
    const list = await window.api.sessions.mcpServers(id)
    if (id !== props.sessionId) return
    servers.value = list
    loadedAt.value = Date.now()
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

// Another chat (or CLI) has other servers.
watch(
  () => [props.sessionId, props.provider],
  () => {
    servers.value = null
    loadedAt.value = 0
    query.value = ''
    signedIn.value = new Set()
    clearInterval(signInTimer)
  },
)

/** The unused connectors below the others, as in the CLI's `/mcp`: folded until asked for. */
const showUnused = ref(false)

// Asked for as the menu opens, so the list is there when the submenu is.
watch(open, (value) => {
  if (value) void loadServers()
  else {
    query.value = ''
    showUnused.value = false
  }
})

const shown = computed(() => {
  const list = servers.value ?? []
  const terms = query.value.trim().split(/\s+/).filter(Boolean)
  return terms.length ? list.filter((s) => containsTerms(searchText(s.name, scopeText(s)), terms)) : list
})

/** Never signed in: of the claude.ai connectors usually most, and nothing the chat can use. */
const isUnused = (server: McpServerInfo) => server.status === 'needs-auth'

type Row = { type: 'server'; server: McpServerInfo } | { type: 'unused'; count: number }

/** The servers in use, then the unused ones behind a row that unfolds them; a search finds them all. */
const rows = computed<Row[]>(() => {
  const list = shown.value
  const unused = list.filter(isUnused)
  const asRows = (servers: McpServerInfo[]): Row[] => servers.map((server) => ({ type: 'server', server }))
  if (query.value.trim() || !unused.length) return asRows(list)
  return [...asRows(list.filter((s) => !isUnused(s))), { type: 'unused', count: unused.length }, ...(showUnused.value ? asRows(unused) : [])]
})

/**
 * A claude.ai connector shows by its name, without the prefix all of them share; a plugin's server
 * (`plugin:<plugin>:<server>`) by the server's, with the plugin when it is named otherwise.
 */
function label(server: McpServerInfo): string {
  if (server.scope === 'claudeai') return server.name.replace(/^claude\.ai\s+/, '')
  const plugin = /^plugin:([^:]+):(.+)$/.exec(server.name)
  if (plugin) return plugin[1] === plugin[2] ? plugin[2]! : `${plugin[2]} (${plugin[1]})`
  return server.name
}

/** Where a server is configured, in the words of the settings. */
const SCOPES: Record<string, string> = {
  user: 'Nutzer',
  project: 'Projekt',
  local: 'Lokal',
  claudeai: 'claude.ai',
  enterprise: 'Verwaltet',
  managed: 'Verwaltet',
  dynamic: 'Dynamisch',
}

function scopeText(server: McpServerInfo): string {
  if (server.name.startsWith('plugin:')) return 'Plugin'
  return server.scope ? (SCOPES[server.scope] ?? server.scope) : ''
}

const STATUS: Record<McpServerInfo['status'], { dot: string; text: string }> = {
  connected: { dot: 'bg-success', text: 'Verbunden' },
  pending: { dot: 'bg-muted-foreground animate-pulse', text: 'Verbindet …' },
  failed: { dot: 'bg-destructive', text: 'Fehlgeschlagen' },
  'needs-auth': { dot: 'bg-warning', text: 'Anmeldung nötig' },
  disabled: { dot: 'bg-muted-foreground/40', text: 'Aus' },
}

function statusText(server: McpServerInfo): string {
  if (!server.enabled) return 'Aus in diesem Projekt'
  const parts = [STATUS[server.status].text]
  if (server.tools) parts.push(`${server.tools} Werkzeuge`)
  const scope = scopeText(server)
  if (scope) parts.push(scope)
  if (server.error) parts.push(server.error)
  return parts.join(' · ')
}

async function toggle(server: McpServerInfo): Promise<void> {
  const id = props.sessionId
  if (!id) return
  const enabled = !server.enabled
  // At once in the list; back if it fails.
  servers.value = (servers.value ?? []).map((s) => (s.name === server.name ? { ...s, enabled } : s))
  try {
    await window.api.sessions.setMcp(id, server.name, enabled)
  } catch (error) {
    toastError(error, 'Umschalten fehlgeschlagen')
    servers.value = (servers.value ?? []).map((s) => (s.name === server.name ? { ...s, enabled: !enabled } : s))
  }
}

/** Servers being connected anew or signed in to. */
const working = ref(new Set<string>())
/** Signed in on the CLI's website (a claude.ai connector): they connect once asked to. */
const signedIn = ref(new Set<string>())

function setWorking(name: string, on: boolean): void {
  const next = new Set(working.value)
  if (on) next.add(name)
  else next.delete(name)
  working.value = next
}

type ServerAction = { kind: 'reconnect' | 'authenticate'; text: string }

/** What a server's row offers besides its switch: connect a failed one anew, sign in to a signed-out one. */
function actionOf(server: McpServerInfo): ServerAction | null {
  if (!server.enabled) return null
  if (server.status === 'failed' || (server.status === 'needs-auth' && signedIn.value.has(server.name))) return { kind: 'reconnect', text: 'Neu verbinden' }
  if (server.status === 'needs-auth') return { kind: 'authenticate', text: 'Anmelden' }
  return null
}

async function reconnect(server: McpServerInfo): Promise<void> {
  const id = props.sessionId
  if (!id) return
  setWorking(server.name, true)
  try {
    await window.api.sessions.reconnectMcp(id, server.name)
    const next = new Set(signedIn.value)
    next.delete(server.name)
    signedIn.value = next
    await loadServers(true)
  } catch (error) {
    toastError(error, `„${label(server)}“ ließ sich nicht verbinden`)
  } finally {
    setWorking(server.name, false)
  }
}

async function authenticate(server: McpServerInfo): Promise<void> {
  const id = props.sessionId
  if (!id) return
  setWorking(server.name, true)
  try {
    const start = await window.api.sessions.authenticateMcp(id, server.name)
    if (!start) {
      await loadServers(true)
      return
    }
    await window.api.app.openExternal(start.url)
    if (start.waits) {
      toast.info(`Im Browser bei „${label(server)}“ anmelden`, { description: 'Der Konnektor verbindet sich danach von selbst.' })
      watchSignIn(server.name)
    } else {
      signedIn.value = new Set(signedIn.value).add(server.name)
      toast.info(`Im Browser bei „${label(server)}“ anmelden`, { description: 'Danach hier „Neu verbinden“ wählen.' })
    }
  } catch (error) {
    toastError(error, 'Anmeldung fehlgeschlagen')
  } finally {
    setWorking(server.name, false)
  }
}

/** The CLI takes the browser's answer itself: the list looks again until the server is connected. */
let signInTimer: ReturnType<typeof setInterval> | undefined
function watchSignIn(name: string): void {
  clearInterval(signInTimer)
  const until = Date.now() + 5 * 60_000
  signInTimer = setInterval(() => {
    const server = servers.value?.find((s) => s.name === name)
    if (Date.now() > until || server?.status === 'connected') {
      clearInterval(signInTimer)
      return
    }
    // Only while someone looks; opened again, the menu asks anyway.
    if (open.value) void loadServers(true)
  }, 5000)
}
onBeforeUnmount(() => clearInterval(signInTimer))

function runAction(server: McpServerInfo): void {
  const action = actionOf(server)
  if (!action || working.value.has(server.name)) return
  if (action.kind === 'reconnect') void reconnect(server)
  else void authenticate(server)
}

/** The chat's CLI, account and folder under Einstellungen › CLI-Konfiguration, at its MCP servers. */
async function manageConnectors(): Promise<void> {
  const id = props.sessionId
  if (!id) return
  try {
    await cliConfig.open(await window.api.sessions.configTarget(id))
  } catch (error) {
    toastError(error, 'Konnektoren lassen sich nicht öffnen')
  }
}

/** The connectors' submenu, opened by `/mcp` as well. */
const connectorsOpen = ref(false)
watch(open, (value) => {
  if (!value) connectorsOpen.value = false
})

/** `/mcp`: the menu opens right at its connectors. */
async function openConnectors(): Promise<void> {
  if (!props.sessionId) return
  open.value = true
  // The submenu needs its trigger on screen first.
  await nextTick()
  connectorsOpen.value = true
}

defineExpose({ openConnectors })

function onSearchKey(event: KeyboardEvent): void {
  // The menu would take the letters for its type-ahead and the arrows away from the field.
  if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Hinzufügen" :disabled="disabled" v-tooltip="'Dateien, Ordner, Befehle, Konnektoren und Plugins'">
        <PlusIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" class="w-max min-w-60">
      <DropdownMenuItem @select="emit('files')">
        <PaperclipIcon /> Dateien oder Fotos hinzufügen
        <DropdownMenuShortcut>Strg+U</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem v-if="sessionId" @select="emit('folder')"><FolderPlusIcon /> Ordner hinzufügen</DropdownMenuItem>
      <DropdownMenuItem @select="emit('commands')"><SquareSlashIcon /> Slash-Befehle</DropdownMenuItem>
      <template v-if="sessionId">
        <DropdownMenuSeparator />
        <DropdownMenuSub v-model:open="connectorsOpen">
          <DropdownMenuSubTrigger><BlocksIcon /> Konnektoren</DropdownMenuSubTrigger>
          <DropdownMenuSubContent class="w-80 p-1">
            <div class="flex items-center gap-2 px-2 py-1.5">
              <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
              <input
                v-model="query"
                class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                placeholder="Konnektoren durchsuchen"
                aria-label="Konnektoren durchsuchen"
                @keydown="onSearchKey"
              />
            </div>
            <DropdownMenuSeparator />
            <div class="max-h-[min(24rem,60vh)] overflow-x-hidden overflow-y-auto">
              <p v-if="loading && !servers" class="px-2 py-3 text-[0.8rem] text-muted-foreground">Wird geladen …</p>
              <p v-else-if="failed" class="px-2 py-3 text-[0.8rem] text-destructive">{{ failed }}</p>
              <p v-else-if="servers && !servers.length" class="px-2 py-3 text-[0.8rem] text-muted-foreground">
                {{ PROVIDERS[provider].name }} hat keine MCP-Server eingerichtet.
              </p>
              <p v-else-if="!shown.length && servers" class="px-2 py-3 text-[0.8rem] text-muted-foreground">Kein Treffer.</p>
              <template v-for="row in rows" :key="row.type === 'server' ? `server:${row.server.name}` : 'unused'">
                <DropdownMenuItem
                  v-if="row.type === 'unused'"
                  class="gap-2.5 text-muted-foreground"
                  :aria-expanded="showUnused"
                  @select="(event: Event) => { event.preventDefault(); showUnused = !showUnused }"
                >
                  <ChevronRightIcon :class="cn('transition-transform', showUnused && 'rotate-90')" />
                  <span class="flex-1">{{ showUnused ? 'Ungenutzte Konnektoren ausblenden' : 'Ungenutzte Konnektoren zeigen' }}</span>
                  <span class="text-[0.75rem] tabular-nums">{{ row.count }}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-else
                  class="gap-2.5"
                  :title="statusText(row.server)"
                  @select="(event: Event) => { event.preventDefault(); void toggle(row.server) }"
                >
                  <span :class="cn('size-2 shrink-0 rounded-full', row.server.enabled ? STATUS[row.server.status].dot : 'bg-muted-foreground/30')" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span :class="cn('truncate', !row.server.enabled && 'text-muted-foreground')">{{ label(row.server) }}</span>
                    <span class="truncate text-[0.7rem] text-muted-foreground">{{ statusText(row.server) }}</span>
                  </span>
                  <LoaderCircleIcon v-if="working.has(row.server.name)" class="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  <button
                    v-else-if="actionOf(row.server)"
                    type="button"
                    tabindex="-1"
                    class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                    :aria-label="`${label(row.server)}: ${actionOf(row.server)!.text}`"
                    v-tooltip="actionOf(row.server)!.text"
                    @pointerdown.stop
                    @pointerup.stop
                    @click.stop.prevent="runAction(row.server)"
                  >
                    <RefreshCwIcon v-if="actionOf(row.server)!.kind === 'reconnect'" class="size-3.5" />
                    <LogInIcon v-else class="size-3.5" />
                  </button>
                  <Switch
                    :model-value="row.server.enabled"
                    class="pointer-events-none"
                    tabindex="-1"
                    :aria-label="`${label(row.server)} ${row.server.enabled ? 'an' : 'aus'}`"
                  />
                </DropdownMenuItem>
              </template>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="manageConnectors"><SlidersHorizontalIcon /> Konnektoren verwalten</DropdownMenuItem>
            <p class="px-2 py-1.5 text-[0.7rem] leading-snug text-muted-foreground">
              Schalter gelten für alle Chats des Projekts.
              <template v-if="provider === 'codex'">Codex übernimmt sie mit dem nächsten Prompt.</template>
            </p>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <ComposerPluginsMenu :session-id="sessionId" :provider="provider" :menu-open="open" />
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
