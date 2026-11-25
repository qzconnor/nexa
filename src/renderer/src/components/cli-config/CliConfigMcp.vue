<script setup lang="ts">
import { ExternalLinkIcon, GlobeIcon, LockIcon, PencilIcon, PlusIcon, ServerIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { GLOBAL_MCP_TRANSPORTS, MCP_TRANSPORT_LABELS, type McpServerConfig } from '@shared/cli-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { useCliConfigStore } from '@/stores/cli-config'
import { useUiStore } from '@/stores/ui'
import McpServerDialog from './McpServerDialog.vue'

/** The MCP servers of the scope shown: a row each, with what it runs or where it connects. */
const store = useCliConfigStore()
const ui = useUiStore()

const mcp = computed(() => store.snapshot!.mcp)
const readOnly = computed(() => !!store.snapshot?.readOnly)
const busy = ref<string | null>(null)

const dialogOpen = ref(false)
const editing = ref<McpServerConfig | null>(null)

function add(): void {
  editing.value = null
  dialogOpen.value = true
}
function edit(server: McpServerConfig): void {
  editing.value = server
  dialogOpen.value = true
}
/** A global server stays one every CLI knows: no SSE, no token variable only Codex has. */
const editingGlobal = computed(() => !!editing.value?.global)
const transports = computed(() => (editingGlobal.value ? mcp.value.transports.filter((t) => GLOBAL_MCP_TRANSPORTS.includes(t)) : mcp.value.transports))

/** What the server runs or where it connects, in a line. */
function target(server: McpServerConfig): string {
  if (server.transport === 'stdio') return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
  return server.url ?? ''
}

/** How many variables or headers it has, and how many of them Nexa doesn't show. */
function entries(server: McpServerConfig): string | null {
  const list = server.transport === 'stdio' ? server.env : server.headers
  if (!list?.length) return null
  const noun = server.transport === 'stdio' ? (list.length === 1 ? 'Variable' : 'Variablen') : 'Header'
  const masked = list.filter((e) => e.masked).length
  return `${list.length} ${noun}${masked ? `, ${masked} verborgen` : ''}`
}

async function toggle(server: McpServerConfig, on: boolean): Promise<void> {
  busy.value = server.name
  await attempt(() => store.saveMcp({ ...server, enabled: on }, server.name), 'Speichern fehlgeschlagen')
  busy.value = null
}

async function remove(server: McpServerConfig): Promise<void> {
  const ok = await ui.confirm({
    title: server.global ? `Globalen MCP-Server „${server.name}“ entfernen?` : `MCP-Server „${server.name}“ entfernen?`,
    description: server.global
      ? 'Er ist global: Nexa entfernt ihn aus allen CLIs und Accounts. Soll er nur hier gehen, mach ihn vorher unter „Alle CLIs“ nicht mehr global.'
      : 'Die CLI startet ihn dann nicht mehr. Laufende Chats behalten ihn bis zum nächsten Start.',
    code: target(server),
    confirmText: 'Entfernen',
    destructive: true,
  })
  if (!ok) return
  busy.value = server.name
  await attempt(() => store.removeMcp(server.name), 'Entfernen fehlgeschlagen')
  busy.value = null
}

const openManage = () => mcp.value.manageUrl && void window.api.app.openExternal(mcp.value.manageUrl.url)
</script>

<template>
  <div class="flex flex-col gap-2">
    <p v-if="!mcp.servers.length" class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      Auf dieser Ebene sind keine MCP-Server eingetragen.
    </p>
    <div
      v-for="server in mcp.servers"
      :key="server.name"
      class="flex items-center gap-3 rounded-lg border bg-background/40 px-3 py-2"
      :class="server.enabled === false && 'opacity-60'"
    >
      <ServerIcon class="size-4 shrink-0 text-muted-foreground" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate text-sm font-medium">{{ server.name }}</span>
          <!-- A locked one is of a kind Nexa doesn't know; its reason names the kind. -->
          <Badge v-if="!server.locked" variant="secondary">{{ MCP_TRANSPORT_LABELS[server.transport] }}</Badge>
          <Badge v-if="server.global" variant="outline" v-tooltip="'Steht in jeder CLI und jedem Account. Was du hier änderst, gilt überall.'">
            <GlobeIcon data-icon="inline-start" /> Global
          </Badge>
          <Badge v-if="server.enabled === false" variant="outline">Aus</Badge>
          <Badge v-if="server.locked" variant="outline" v-tooltip="server.locked"><LockIcon data-icon="inline-start" /> Nur ansehen</Badge>
        </div>
        <span class="truncate font-mono text-xs text-muted-foreground" v-tooltip="target(server)">{{ target(server) || '–' }}</span>
        <span v-if="entries(server) || server.other" class="truncate text-xs text-muted-foreground">
          {{ [entries(server), server.other ? `weitere Angaben: ${server.other.join(', ')}` : null].filter(Boolean).join(' · ') }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Switch
          v-if="server.enabled !== undefined"
          :model-value="server.enabled"
          :disabled="readOnly || !!server.locked || busy === server.name"
          :aria-label="`${server.name} eingeschaltet`"
          v-tooltip="server.enabled ? 'Eingeschaltet' : 'Ausgeschaltet, bleibt eingetragen'"
          @update:model-value="(on: boolean) => toggle(server, on)"
        />
        <Button variant="ghost" size="icon-sm" :disabled="readOnly || !!server.locked" :aria-label="`${server.name} bearbeiten`" @click="edit(server)">
          <PencilIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" :disabled="readOnly || busy === server.name" :aria-label="`${server.name} entfernen`" @click="remove(server)">
          <Trash2Icon />
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 pt-1">
      <Button variant="outline" size="sm" :disabled="readOnly" @click="add">
        <PlusIcon data-icon="inline-start" />
        Server hinzufügen
      </Button>
      <Button v-if="mcp.manageUrl" variant="ghost" size="sm" @click="openManage">
        <ExternalLinkIcon data-icon="inline-start" />
        {{ mcp.manageUrl.label }}
      </Button>
    </div>
    <p v-if="mcp.note" class="text-xs text-muted-foreground">{{ mcp.note }}</p>

    <McpServerDialog v-model:open="dialogOpen" :server="editing" :transports="transports" :bearer-token-env-var="!!mcp.bearerTokenEnvVar && !editingGlobal" />
  </div>
</template>
