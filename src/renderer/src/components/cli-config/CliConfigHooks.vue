<script setup lang="ts">
import { PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { HookEventConfig, HookGroup, HookHandler, HookTrustStatus } from '@shared/cli-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { addHook, removeHook, updateHook, type HookAt, type HookDraft } from '@/lib/cli-hooks'
import { attempt } from '@/lib/errors'
import { useCliConfigStore } from '@/stores/cli-config'
import { useUiStore } from '@/stores/ui'
import HookDialog from './HookDialog.vue'

/** The hooks of the scope shown, by event; a row per hook with its matcher and command. */
const store = useCliConfigStore()
const ui = useUiStore()

const hooks = computed(() => store.snapshot!.hooks)
const readOnly = computed(() => !!store.snapshot?.readOnly)
const busy = ref(false)

const TRUST: Record<HookTrustStatus, { label: string; hint: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  trusted: { label: 'Vertraut', hint: 'Codex führt ihn aus.', variant: 'secondary' },
  untrusted: { label: 'Nicht vertraut', hint: 'Codex führt ihn erst aus, wenn du ihm vertraust.', variant: 'destructive' },
  modified: { label: 'Geändert', hint: 'Seit du ihm vertraut hast, hat er sich geändert; Codex führt ihn so nicht aus.', variant: 'destructive' },
  managed: { label: 'Verwaltet', hint: 'Von deiner Organisation vorgegeben.', variant: 'outline' },
}

const description = (event: string) => hooks.value.events.find((e) => e.name === event)?.description
/** Whether the event's hooks can have a matcher; one the CLI doesn't know may. */
const hasMatcher = (event: string) => hooks.value.events.find((e) => e.name === event)?.matcher ?? true
const groupsOf = (event: string): HookGroup[] => hooks.value.configs.find((c) => c.event === event)?.groups ?? []

/** Every hook of an event with where it is, in the file's order. */
function rows(config: HookEventConfig): { at: HookAt; matcher: string | null; handler: HookHandler }[] {
  return config.groups.flatMap((group, g) => group.hooks.map((handler, index) => ({ at: { group: g, index }, matcher: group.matcher, handler })))
}

async function saveGroups(event: string, groups: HookGroup[]): Promise<void> {
  await store.saveHooks({ event, groups, version: hooks.value.version })
}

const dialogOpen = ref(false)
const draft = ref<HookDraft | null>(null)
/** Where the hook edited is; null for a new one. */
let editingAt: HookAt | null = null

function add(): void {
  draft.value = null
  editingAt = null
  dialogOpen.value = true
}
function edit(event: string, at: HookAt, matcher: string | null, handler: HookHandler): void {
  draft.value = { event, matcher, handler }
  editingAt = at
  dialogOpen.value = true
}

async function saveDraft(event: string, matcher: string | null, handler: HookHandler): Promise<void> {
  const groups = groupsOf(event)
  await saveGroups(event, editingAt ? updateHook(groups, editingAt, matcher, handler) : addHook(groups, matcher, handler))
}

async function remove(event: string, at: HookAt, handler: HookHandler): Promise<void> {
  const ok = await ui.confirm({
    title: `Hook für „${event}“ entfernen?`,
    code: handler.command ?? handler.summary ?? handler.type,
    confirmText: 'Entfernen',
    destructive: true,
  })
  if (!ok) return
  busy.value = true
  await attempt(() => saveGroups(event, removeHook(groupsOf(event), at)), 'Entfernen fehlgeschlagen')
  busy.value = false
}

async function trust(handler: HookHandler): Promise<void> {
  if (!handler.trust) return
  const { key, hash } = handler.trust
  busy.value = true
  await attempt(() => store.trustHook(key, hash), 'Vertrauen fehlgeschlagen')
  busy.value = false
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="!hooks.configs.length" class="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      Auf dieser Ebene sind keine Hooks eingetragen.
    </p>

    <section v-for="config in hooks.configs" :key="config.event" class="flex flex-col gap-1.5" :aria-label="config.event">
      <div class="flex items-baseline gap-2">
        <h4 class="font-mono text-sm font-medium">{{ config.event }}</h4>
        <span v-if="description(config.event)" class="truncate text-xs text-muted-foreground">{{ description(config.event) }}</span>
      </div>
      <div
        v-for="row in rows(config)"
        :key="`${row.at.group}:${row.at.index}`"
        class="flex items-center gap-3 rounded-lg border bg-background/40 px-3 py-1.5"
      >
        <Badge
          v-if="row.matcher || hasMatcher(config.event)"
          variant="outline"
          class="max-w-40 font-mono"
          v-tooltip="row.matcher ? `Matcher: ${row.matcher}` : 'Ohne Matcher: gilt für alles'"
        >
          <span class="truncate">{{ row.matcher ?? 'alle' }}</span>
        </Badge>
        <div class="flex min-w-0 flex-1 items-center gap-2">
          <Badge v-if="row.handler.type !== 'command'" variant="secondary">{{ row.handler.type }}</Badge>
          <span class="min-w-0 flex-1 truncate font-mono text-xs" v-tooltip="row.handler.command ?? row.handler.summary">
            {{ row.handler.command ?? row.handler.summary ?? '–' }}
          </span>
          <span v-if="row.handler.timeout" class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ row.handler.timeout }} s</span>
        </div>
        <template v-if="row.handler.trust">
          <Badge :variant="TRUST[row.handler.trust.status].variant" v-tooltip="TRUST[row.handler.trust.status].hint">
            {{ TRUST[row.handler.trust.status].label }}
          </Badge>
          <Button
            v-if="row.handler.trust.status === 'untrusted' || row.handler.trust.status === 'modified'"
            variant="outline"
            size="xs"
            :disabled="busy"
            @click="trust(row.handler)"
          >
            <ShieldCheckIcon data-icon="inline-start" />
            Vertrauen
          </Button>
        </template>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="readOnly || busy || row.handler.type !== 'command'"
            aria-label="Hook bearbeiten"
            v-tooltip="row.handler.type !== 'command' ? 'Diese Art von Hook bearbeitet Nexa nicht.' : undefined"
            @click="edit(config.event, row.at, row.matcher, row.handler)"
          >
            <PencilIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" :disabled="readOnly || busy" aria-label="Hook entfernen" @click="remove(config.event, row.at, row.handler)">
            <Trash2Icon />
          </Button>
        </div>
      </div>
    </section>

    <div class="flex items-center gap-2">
      <Button variant="outline" size="sm" :disabled="readOnly" @click="add">
        <PlusIcon data-icon="inline-start" />
        Hook hinzufügen
      </Button>
    </div>
    <p v-if="hooks.note" class="text-xs text-muted-foreground">{{ hooks.note }}</p>

    <HookDialog v-model:open="dialogOpen" :draft="draft" :events="hooks.events" :save="saveDraft" />
  </div>
</template>
