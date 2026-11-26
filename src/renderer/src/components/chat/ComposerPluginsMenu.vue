<script lang="ts">
import type { PluginInfo } from '@shared/types'

/** By chat and CLI, kept across openings: the menu mounts its submenus anew each time it opens. */
const cache = new Map<string, { list: PluginInfo[]; at: number }>()
</script>

<script setup lang="ts">
import { PuzzleIcon, SearchIcon } from '@lucide/vue'
import { computed, ref, shallowRef, watch } from 'vue'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { errorMessage, toastError } from '@/lib/errors'
import { containsTerms, searchText } from '@/lib/search'
import { cn } from '@/lib/utils'
import { useDeviceApi } from '@/stores/device'

/**
 * „Plugins ›“ in the composer's „+“: the plugins the chat's CLI has installed for its folder, each to
 * switch on and off in the CLI's own settings (so also outside Nexa).
 */
const props = defineProps<{ sessionId: string; provider: ProviderId; menuOpen: boolean }>()
const api = useDeviceApi()

const cacheKey = () => `${props.sessionId}\0${props.provider}`

const plugins = shallowRef<PluginInfo[] | null>(cache.get(cacheKey())?.list ?? null)
const loading = ref(false)
const failed = ref<string | null>(null)
const query = ref('')
/** Plugins whose switch the CLI is still writing. */
const busy = ref(new Set<string>())

async function load(force = false): Promise<void> {
  const key = cacheKey()
  const cached = cache.get(key)
  if (loading.value || (!force && cached && Date.now() - cached.at < 30_000)) return
  loading.value = true
  failed.value = null
  try {
    const list = await api.sessions.plugins(props.sessionId)
    cache.set(key, { list, at: Date.now() })
    if (key === cacheKey()) plugins.value = list
  } catch (error) {
    failed.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

watch(cacheKey, (key) => {
  plugins.value = cache.get(key)?.list ?? null
  query.value = ''
})

// Asked for as the „+“ opens, so the list is there when the submenu is. The menu mounts this only
// once it is open, hence at once as well.
watch(
  () => props.menuOpen,
  (open) => {
    if (open) void load()
    else query.value = ''
  },
  { immediate: true },
)

const shown = computed(() => {
  const list = plugins.value ?? []
  const terms = query.value.trim().split(/\s+/).filter(Boolean)
  return terms.length ? list.filter((p) => containsTerms(searchText(p.name, p.id, p.description ?? '', p.marketplace ?? ''), terms)) : list
})

const SCOPES: Record<string, string> = { user: 'Nutzer', project: 'Projekt', local: 'Lokal' }

function details(plugin: PluginInfo): string {
  const parts: string[] = []
  if (plugin.version) parts.push(`v${plugin.version.replace(/^v/, '')}`)
  if (plugin.marketplace) parts.push(plugin.marketplace)
  if (plugin.scope) parts.push(SCOPES[plugin.scope] ?? plugin.scope)
  if (plugin.locked) parts.push(plugin.locked)
  return parts.join(' · ')
}

function tooltip(plugin: PluginInfo): string {
  return [plugin.description, details(plugin), plugin.id].filter(Boolean).join('\n')
}

async function toggle(plugin: PluginInfo): Promise<void> {
  if (plugin.locked || busy.value.has(plugin.id)) return
  const id = props.sessionId
  const enabled = !plugin.enabled
  const set = (value: boolean) => {
    plugins.value = (plugins.value ?? []).map((p) => (p.id === plugin.id ? { ...p, enabled: value } : p))
    cache.set(cacheKey(), { list: plugins.value, at: cache.get(cacheKey())?.at ?? 0 })
  }
  set(enabled)
  busy.value = new Set(busy.value).add(plugin.id)
  try {
    await api.sessions.setPlugin(id, plugin.id, enabled)
    // The CLI decides in the end (settings of another scope may win): its list shows how it stands.
    await load(true)
  } catch (error) {
    toastError(error, enabled ? 'Plugin einschalten fehlgeschlagen' : 'Plugin ausschalten fehlgeschlagen')
    set(!enabled)
  } finally {
    const next = new Set(busy.value)
    next.delete(plugin.id)
    busy.value = next
  }
}

function onSearchKey(event: KeyboardEvent): void {
  // The menu would take the letters for its type-ahead and the arrows away from the field.
  if (event.key !== 'Escape' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') event.stopPropagation()
}
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger><PuzzleIcon /> Plugins</DropdownMenuSubTrigger>
    <DropdownMenuSubContent class="w-80 p-1">
      <div class="flex items-center gap-2 px-2 py-1.5">
        <SearchIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <input
          v-model="query"
          class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          placeholder="Plugins durchsuchen"
          aria-label="Plugins durchsuchen"
          @keydown="onSearchKey"
        />
      </div>
      <DropdownMenuSeparator />
      <div class="max-h-[min(24rem,60vh)] overflow-x-hidden overflow-y-auto">
        <p v-if="loading && !plugins" class="px-2 py-3 text-[0.8rem] text-muted-foreground">Wird geladen …</p>
        <p v-else-if="failed" class="px-2 py-3 text-[0.8rem] text-destructive">{{ failed }}</p>
        <p v-else-if="plugins && !plugins.length" class="px-2 py-3 text-[0.8rem] text-muted-foreground">
          {{ PROVIDERS[provider].name }} hat für diesen Ordner keine Plugins installiert.
        </p>
        <p v-else-if="!shown.length && plugins" class="px-2 py-3 text-[0.8rem] text-muted-foreground">Kein Treffer.</p>
        <DropdownMenuItem
          v-for="plugin in shown"
          :key="plugin.id"
          class="gap-2.5"
          :disabled="!!plugin.locked"
          :title="tooltip(plugin)"
          @select="(event: Event) => { event.preventDefault(); void toggle(plugin) }"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span :class="cn('truncate', !plugin.enabled && 'text-muted-foreground')">{{ plugin.name }}</span>
            <span class="truncate text-[0.7rem] text-muted-foreground">{{ plugin.description || details(plugin) }}</span>
          </span>
          <Switch
            :model-value="plugin.enabled"
            :disabled="!!plugin.locked || busy.has(plugin.id)"
            class="pointer-events-none"
            tabindex="-1"
            :aria-label="`${plugin.name} ${plugin.enabled ? 'an' : 'aus'}`"
          />
        </DropdownMenuItem>
      </div>
      <DropdownMenuSeparator />
      <p class="px-2 py-1.5 text-[0.7rem] leading-snug text-muted-foreground">
        Gilt für {{ PROVIDERS[provider].name }} mit diesem Account, auch außerhalb von Nexa.
        <template v-if="provider === 'codex'">Laufende Chats übernehmen es mit dem nächsten Prompt.</template>
      </p>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
