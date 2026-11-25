<script setup lang="ts">
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  EllipsisIcon,
  GlobeIcon,
  GlobeLockIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { computed, onMounted, ref, type Component } from 'vue'
import {
  GLOBAL_MCP_TRANSPORTS,
  MCP_TRANSPORT_LABELS,
  type McpCellState,
  type McpOverviewCell,
  type McpOverviewRow,
  type McpServerConfig,
} from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCliConfigStore } from '@/stores/cli-config'
import { useUiStore } from '@/stores/ui'
import McpServerDialog from './McpServerDialog.vue'

/**
 * „Alle CLIs“: every MCP server of the CLIs' user scopes, a row each, with a mark per account where it
 * is the same, differs or is missing. Global servers come first; any other can become one.
 */
const store = useCliConfigStore()
const ui = useUiStore()

onMounted(() => {
  if (!store.overview && !store.overviewLoading) void store.loadOverview()
})

const overview = computed(() => store.overview)
const columns = computed(() => overview.value?.columns ?? [])
const globalRows = computed(() => overview.value?.rows.filter((r) => r.global) ?? [])
const otherRows = computed(() => overview.value?.rows.filter((r) => !r.global) ?? [])
const unreadable = computed(() => columns.value.filter((c) => c.error))

/** A column per CLI, with the indexes of its accounts. */
const groups = computed(() => {
  const order = store.providers.length ? store.providers : [...new Set(columns.value.map((c) => c.provider))]
  return order
    .map((provider: ProviderId) => ({ provider, indexes: columns.value.flatMap((c, i) => (c.provider === provider ? [i] : [])) }))
    .filter((g) => g.indexes.length)
})

const STATES: Record<McpCellState, { icon: Component; tone: string }> = {
  same: { icon: CircleCheckIcon, tone: 'text-muted-foreground' },
  different: { icon: CircleAlertIcon, tone: 'text-warning' },
  missing: { icon: CircleDashedIcon, tone: 'text-muted-foreground/50' },
  unsupported: { icon: CircleSlashIcon, tone: 'text-muted-foreground/50' },
  error: { icon: CircleXIcon, tone: 'text-destructive' },
}

function cellTone(row: McpOverviewRow, cell: McpOverviewCell): string {
  if (cell.state === 'same' && row.global) return 'text-success'
  return STATES[cell.state].tone
}

function cellText(row: McpOverviewRow, cell: McpOverviewCell, index: number): string {
  const column = columns.value[index]!
  const what: Record<McpCellState, string> = {
    same: row.global ? 'wie global' : row.sources.length > 1 ? 'häufigste Fassung' : 'eingetragen',
    different: row.global ? 'weicht ab' : 'andere Fassung',
    missing: 'fehlt',
    unsupported: `kennt ${row.server.transport === 'sse' ? 'SSE' : 'diese Art von Server'} nicht`,
    error: column.error ?? 'nicht lesbar',
  }
  return `${store.columnLabel(column)}: ${what[cell.state]}${cell.enabled === false ? ', ausgeschaltet' : ''}`
}

/** What the server runs or where it connects, in a line. */
function target(server: McpServerConfig): string {
  if (server.transport === 'stdio') return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
  return server.url ?? ''
}

/** Accounts where a global server is missing or differs: „Angleichen“ writes it there. */
const drift = (row: McpOverviewRow) => row.cells.filter((c) => c.state === 'different' || c.state === 'missing').length

const busy = ref<string | null>(null)
async function run(row: McpOverviewRow, action: () => Promise<void>, title: string): Promise<void> {
  busy.value = row.name
  await attempt(action, title)
  busy.value = null
}

async function makeGlobal(row: McpOverviewRow, index: number): Promise<void> {
  // Other versions give way to the one chosen.
  if (row.sources.length > 1) {
    const ok = await ui.confirm({
      title: `„${row.name}“ global machen?`,
      description: `Die Fassung von ${store.columnLabel(columns.value[index]!)} ersetzt die anderen in allen CLIs und Accounts.`,
      confirmText: 'Global machen',
    })
    if (!ok) return
  }
  await run(row, () => store.makeGlobal(row.name, columns.value[index]!), 'Nicht global geworden')
}

const sync = (row: McpOverviewRow) => run(row, () => store.syncGlobal(row.name), 'Angleichen fehlgeschlagen')
const unglobal = (row: McpOverviewRow) => run(row, () => store.unglobal(row.name), 'Fehlgeschlagen')

async function removeGlobal(row: McpOverviewRow): Promise<void> {
  const ok = await ui.confirm({
    title: `„${row.name}“ überall entfernen?`,
    description: 'Nexa entfernt ihn aus allen CLIs und Accounts. Laufende Chats behalten ihn bis zum nächsten Start.',
    code: target(row.server),
    confirmText: 'Überall entfernen',
    destructive: true,
  })
  if (ok) await run(row, () => store.removeGlobal(row.name), 'Entfernen fehlgeschlagen')
}

const dialogOpen = ref(false)
const editing = ref<McpServerConfig | null>(null)
function add(): void {
  editing.value = null
  dialogOpen.value = true
}
function edit(row: McpOverviewRow): void {
  editing.value = row.server
  dialogOpen.value = true
}
const saveGlobal = (server: McpServerConfig, previousName: string | null) => (previousName ? store.saveGlobal(server, previousName) : store.addGlobal(server))
</script>

<template>
  <div class="flex flex-col gap-3">
    <Alert v-if="store.overviewError" variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Nicht lesbar</AlertTitle>
      <AlertDescription>{{ store.overviewError }}</AlertDescription>
    </Alert>
    <Alert v-if="unreadable.length">
      <TriangleAlertIcon />
      <AlertTitle>Nicht alle Accounts lesbar</AlertTitle>
      <AlertDescription>
        <p v-for="c in unreadable" :key="`${c.provider}:${c.accountId}`">{{ store.columnLabel(c) }}: {{ c.error }}</p>
      </AlertDescription>
    </Alert>

    <Spinner v-if="!overview && store.overviewLoading" class="mx-auto text-muted-foreground" />
    <p v-else-if="overview && !columns.length" class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      Keine CLI ist installiert.
    </p>
    <p v-else-if="overview && !overview.rows.length" class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      In keiner CLI sind MCP-Server eingetragen. Ein globaler steht danach in allen.
    </p>

    <div v-else-if="overview" class="rounded-lg border bg-background/40">
      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="h-8 pl-3 text-xs text-muted-foreground">Server</TableHead>
            <TableHead v-for="g in groups" :key="g.provider" class="h-8 w-24 text-center text-xs text-muted-foreground">
              <span class="inline-flex items-center gap-1.5">
                <ProviderIcon :provider="g.provider" class="size-3.5" />
                {{ PROVIDERS[g.provider].short }}
              </span>
            </TableHead>
            <TableHead class="h-8 w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="(list, part) in [globalRows, otherRows]" :key="part">
            <TableRow v-if="part === 1 && list.length && globalRows.length" class="bg-muted/30 hover:bg-muted/30">
              <TableCell :colspan="groups.length + 2" class="py-1.5 pl-3 text-xs font-medium text-muted-foreground">Nur in einzelnen CLIs</TableCell>
            </TableRow>
            <TableRow v-for="row in list" :key="row.name">
              <TableCell class="max-w-0 pl-3">
                <div class="flex min-w-0 items-center gap-2">
                  <component :is="row.global ? GlobeIcon : ServerIcon" class="size-4 shrink-0" :class="row.global ? 'text-primary' : 'text-muted-foreground'" />
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <div class="flex min-w-0 items-center gap-1.5">
                      <span class="truncate font-medium">{{ row.name }}</span>
                      <Badge v-if="!row.server.locked" variant="secondary">{{ MCP_TRANSPORT_LABELS[row.server.transport] }}</Badge>
                      <Badge v-if="row.global && drift(row)" variant="outline" class="text-warning">
                        {{ drift(row) === 1 ? 'Weicht in einem Account ab' : `Weicht in ${drift(row)} Accounts ab` }}
                      </Badge>
                      <Badge v-else-if="!row.global && row.sources.length > 1" variant="outline" class="text-warning">{{ row.sources.length }} Fassungen</Badge>
                    </div>
                    <span class="truncate font-mono text-xs text-muted-foreground" v-tooltip="target(row.server)">{{ target(row.server) || '–' }}</span>
                  </div>
                </div>
              </TableCell>

              <TableCell v-for="g in groups" :key="g.provider" class="text-center">
                <span class="inline-flex items-center gap-1">
                  <span
                    v-for="i in g.indexes"
                    :key="i"
                    class="inline-flex"
                    :class="row.cells[i]!.enabled === false && 'opacity-50'"
                    v-tooltip="cellText(row, row.cells[i]!, i)"
                  >
                    <component :is="STATES[row.cells[i]!.state].icon" :class="cn('size-4', cellTone(row, row.cells[i]!))" :aria-label="cellText(row, row.cells[i]!, i)" />
                  </span>
                </span>
              </TableCell>

              <TableCell class="pr-2">
                <div class="flex items-center justify-end gap-1">
                  <template v-if="row.global">
                    <Button
                      v-if="drift(row)"
                      variant="outline"
                      size="sm"
                      :disabled="busy !== null"
                      v-tooltip="'Schreibt die globale Fassung dorthin, wo sie fehlt oder abweicht.'"
                      @click="sync(row)"
                    >
                      <Spinner v-if="busy === row.name" data-icon="inline-start" />
                      <RefreshCwIcon v-else data-icon="inline-start" />
                      Angleichen
                    </Button>
                    <Button variant="ghost" size="icon-sm" :disabled="busy !== null" :aria-label="`${row.name} bearbeiten`" @click="edit(row)">
                      <PencilIcon />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger as-child>
                        <Button variant="ghost" size="icon-sm" :disabled="busy !== null" :aria-label="`Aktionen für ${row.name}`"><EllipsisIcon /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-60">
                        <DropdownMenuItem @select="unglobal(row)"><GlobeLockIcon /> Nicht mehr global</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" @select="removeGlobal(row)"><Trash2Icon /> Überall entfernen</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </template>

                  <template v-else>
                    <span v-if="row.notGlobal" v-tooltip="row.notGlobal" class="inline-flex">
                      <Button variant="outline" size="sm" disabled><GlobeIcon data-icon="inline-start" /> Global machen</Button>
                    </span>
                    <Button
                      v-else-if="row.sources.length === 1"
                      variant="outline"
                      size="sm"
                      :disabled="busy !== null"
                      v-tooltip="'Nexa trägt ihn in jede CLI und jeden Account ein und hält ihn dort gleich.'"
                      @click="makeGlobal(row, row.sources[0]!)"
                    >
                      <Spinner v-if="busy === row.name" data-icon="inline-start" />
                      <GlobeIcon v-else data-icon="inline-start" />
                      Global machen
                    </Button>
                    <DropdownMenu v-else>
                      <DropdownMenuTrigger as-child>
                        <Button variant="outline" size="sm" :disabled="busy !== null">
                          <Spinner v-if="busy === row.name" data-icon="inline-start" />
                          <GlobeIcon v-else data-icon="inline-start" />
                          Global machen
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-72">
                        <DropdownMenuLabel class="text-xs text-muted-foreground">Welche Fassung gilt?</DropdownMenuLabel>
                        <DropdownMenuItem v-for="i in row.sources" :key="i" @select="makeGlobal(row, i)">
                          <ProviderIcon :provider="columns[i]!.provider" class="size-3.5" />
                          Die von {{ store.columnLabel(columns[i]!) }}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </template>
                </div>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <div v-if="overview && columns.length" class="flex flex-wrap items-center gap-2 pt-1">
      <Button variant="outline" size="sm" @click="add">
        <PlusIcon data-icon="inline-start" />
        Globalen Server hinzufügen
      </Button>
    </div>

    <McpServerDialog v-model:open="dialogOpen" global :server="editing" :transports="[...GLOBAL_MCP_TRANSPORTS]" :bearer-token-env-var="false" :save="saveGlobal" />
  </div>
</template>
