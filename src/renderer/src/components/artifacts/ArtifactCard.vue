<script setup lang="ts">
import {
  Building2Icon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
  PanelRightIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  UsersIcon,
} from '@lucide/vue'
import { useIntersectionObserver } from '@vueuse/core'
import { computed, ref, watchEffect } from 'vue'
import type { Artifact } from '@shared/artifacts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useArtifactsStore } from '@/stores/artifacts'

/**
 * An artifact as claude.ai shows it: the top of the page in a window, below its title, owner, time
 * and views, and the chat it came from. A click shows it beside that chat (without one in the default
 * browser), the menu has the rest: pinning on claude.ai, renaming and deleting, as far as the login
 * may. The thumbnail is fetched once the card comes into view.
 */
const props = defineProps<{
  artifact: Artifact
  accountId: string
  dark: boolean
  /** claude.ai offers pinning to this login. */
  pinsEnabled: boolean
  /** The title of the chat it came from; null without one. */
  chat: string | null
  now: number
}>()
const emit = defineEmits<{ open: []; panel: []; external: []; chat: []; copy: []; pin: [pinned: boolean]; rename: []; remove: [] }>()

const store = useArtifactsStore()
const root = ref<HTMLElement | null>(null)
const seen = ref(false)
const { stop } = useIntersectionObserver(root, ([entry]) => {
  if (!entry?.isIntersecting) return
  seen.value = true
  stop()
})

const thumbnail = computed(() => store.thumbnailOf(props.accountId, props.artifact.id, props.dark))
// Again after a theme of the other brightness and after the list was fetched anew.
watchEffect(() => {
  if (seen.value && thumbnail.value === undefined) store.requestThumbnail(props.accountId, props.artifact.id, props.dark)
})

const owner = computed(() => {
  if (props.artifact.mine) return null
  return props.artifact.external ? 'Aus anderer Organisation' : 'Geteilt'
})
/** When it was last looked at, otherwise published or made. */
const when = computed(() => {
  const { lastViewedAt, updatedAt, createdAt } = props.artifact
  const [label, iso] = lastViewedAt ? ['Zuletzt angesehen', lastViewedAt] : updatedAt ? ['Veröffentlicht', updatedAt] : ['Erstellt', createdAt]
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isNaN(ms) ? null : { short: formatRelative(ms, props.now), exact: `${label}: ${formatDateTime(ms)}` }
})
const views = computed(() => {
  const count = props.artifact.views
  return count === null ? null : { short: count.toLocaleString('de'), exact: count === 1 ? '1 Aufruf' : `${count.toLocaleString('de')} Aufrufe` }
})
const AUDIENCES = {
  owner: { icon: LockIcon, label: 'Privat, nur für den Besitzer' },
  users: { icon: UsersIcon, label: 'Mit einzelnen Personen geteilt' },
  org: { icon: Building2Icon, label: 'Für die Organisation freigegeben' },
  public: { icon: GlobeIcon, label: 'Öffentlich, für alle mit dem Link' },
}
const audience = computed(() => (props.artifact.audience ? AUDIENCES[props.artifact.audience] : null))
</script>

<template>
  <article
    ref="root"
    class="group/card relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground transition-colors hover:border-foreground/20 has-[[data-open]:focus-visible]:ring-[3px] has-[[data-open]:focus-visible]:ring-ring/50"
  >
    <!-- The top of the page in a window, like on claude.ai; without a thumbnail tiles stand in. -->
    <div class="relative aspect-[2/1] overflow-hidden bg-muted px-[12%] pt-[9%]">
      <div
        class="size-full overflow-hidden rounded-t-lg border border-b-0 border-foreground/10 bg-background shadow-md transition-transform duration-300 group-hover/card:-translate-y-1"
      >
        <img v-if="thumbnail" :src="thumbnail" alt="" draggable="false" class="block w-full" />
        <div v-else class="grid grid-cols-3 gap-[6%] p-[7%]" aria-hidden="true">
          <div v-for="i in 6" :key="i" class="aspect-square rounded-md bg-muted" />
        </div>
      </div>
      <div v-if="artifact.kind === 'document' || artifact.pinned" class="absolute top-2 left-2 flex items-center gap-1">
        <span
          v-if="artifact.pinned"
          class="flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[0.7rem] font-medium backdrop-blur"
          v-tooltip="'Auf claude.ai angepinnt'"
        >
          <PinIcon class="size-3" />
          Angepinnt
        </span>
        <span v-if="artifact.kind === 'document'" class="flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[0.7rem] font-medium backdrop-blur">
          <FileTextIcon class="size-3" />
          Dokument
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Aktionen"
            class="absolute top-2 right-2 z-10 bg-background/85 text-muted-foreground opacity-0 backdrop-blur group-focus-within/card:opacity-100 group-hover/card:opacity-100 hover:bg-background data-[state=open]:opacity-100"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-60">
          <template v-if="chat">
            <DropdownMenuItem @select="emit('panel')"><PanelRightIcon /> Neben dem Chat zeigen</DropdownMenuItem>
            <DropdownMenuItem @select="emit('chat')"><MessageSquareIcon /> Zum Chat</DropdownMenuItem>
            <DropdownMenuSeparator />
          </template>
          <DropdownMenuItem @select="emit('external')"><ExternalLinkIcon /> Im Standardbrowser öffnen</DropdownMenuItem>
          <DropdownMenuItem @select="emit('copy')"><LinkIcon /> Link kopieren</DropdownMenuItem>
          <template v-if="pinsEnabled || artifact.renamable">
            <DropdownMenuSeparator />
            <DropdownMenuItem v-if="pinsEnabled" @select="emit('pin', !artifact.pinned)">
              <component :is="artifact.pinned ? PinOffIcon : PinIcon" />
              {{ artifact.pinned ? 'Nicht mehr anpinnen' : 'Auf claude.ai anpinnen' }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="artifact.renamable" @select="emit('rename')"><PencilIcon /> Umbenennen …</DropdownMenuItem>
          </template>
          <template v-if="artifact.mine">
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" @select="emit('remove')"><Trash2Icon /> Löschen …</DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="flex min-w-0 items-center gap-2 px-3.5 py-3">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 class="truncate text-sm leading-5 font-medium" :title="artifact.description ?? artifact.title">
          <!-- Covers the whole card: a click anywhere opens it, the buttons lie above it. -->
          <button type="button" data-open class="cursor-pointer text-left outline-none after:absolute after:inset-0 after:content-['']" @click="emit('open')">
            {{ artifact.title }}
          </button>
        </h3>
        <div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <template v-if="owner">
            <span class="truncate">{{ owner }}</span>
            <span v-if="when || views" aria-hidden="true">·</span>
          </template>
          <span v-if="when" v-tooltip="when.exact" class="relative z-10 shrink-0">{{ when.short }}</span>
          <template v-if="views">
            <span v-if="when" aria-hidden="true">·</span>
            <span v-tooltip="views.exact" class="relative z-10 flex shrink-0 items-center gap-1 tabular-nums">
              <EyeIcon class="size-3.5" />
              {{ views.short }}
            </span>
          </template>
        </div>
        <!-- The chat it came from: a way back there of its own. -->
        <button
          v-if="chat"
          type="button"
          class="relative z-10 flex max-w-full min-w-0 items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          v-tooltip="'Zum Chat, aus dem es kam'"
          @click="emit('chat')"
        >
          <MessageSquareIcon class="size-3 shrink-0" />
          <span class="truncate">{{ chat }}</span>
        </button>
      </div>
      <span v-if="audience" v-tooltip="audience.label" class="relative z-10 flex size-6 shrink-0 items-center justify-center self-start text-muted-foreground">
        <component :is="audience.icon" class="size-4" :aria-label="audience.label" />
      </span>
    </div>
  </article>
</template>
