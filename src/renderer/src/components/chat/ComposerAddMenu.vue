<script setup lang="ts">
import { BlocksIcon, ChevronRightIcon, FolderPlusIcon, PaperclipIcon, PlusIcon, SearchIcon, SquareSlashIcon } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
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

/**
 * The composer's „+“, as in Claude Desktop: files and photos, another folder for the agent, the
 * commands, and in a chat its CLI's MCP servers („Konnektoren“) to switch on and off for the project.
 */
const props = defineProps<{ sessionId?: string; provider: ProviderId; disabled?: boolean }>()
const emit = defineEmits<{ files: []; folder: []; commands: [] }>()

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

function onSearchKey(event: KeyboardEvent): void {
  // The menu would take the letters for its type-ahead and the arrows away from the field.
  if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Hinzufügen" :disabled="disabled" v-tooltip="'Dateien, Ordner, Befehle und Konnektoren'">
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
        <DropdownMenuSub>
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
            <p class="px-2 py-1.5 text-[0.7rem] leading-snug text-muted-foreground">
              Gilt für alle Chats des Projekts.
              <template v-if="provider === 'codex'">Codex übernimmt es mit dem nächsten Prompt.</template>
            </p>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
