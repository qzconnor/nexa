<script setup lang="ts">
import { CloudOffIcon, ExternalLinkIcon, RefreshCwIcon, ScrollTextIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { compareVersions } from '@shared/version'
import ReleaseDetails from '@/components/updates/ReleaseDetails.vue'
import UpdateStatus from '@/components/updates/UpdateStatus.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useUpdatesStore } from '@/stores/updates'

const updates = useUpdatesStore()
const filter = useSettingsFilter()

/** Versions shown at first and added with each scroll to the end (as many as GitHub sends per page). */
const PAGE = 10

// Opening the page asks GitHub nothing: the notes come with the checks for updates.
onMounted(() => updates.markSeen())

const notes = computed(() => updates.releases)
const shown = ref(PAGE)
const visibleNotes = computed(() => notes.value.notes.slice(0, shown.value))
const hasMore = computed(() => shown.value < notes.value.notes.length || !notes.value.complete)

/** At the end of the list: shows the next versions loaded already, or asks GitHub for older ones. */
const end = ref<HTMLElement | null>(null)
let stepping = false
const observer = new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) void step()
})

async function step(): Promise<void> {
  if (stepping) return
  stepping = true
  let advanced = false
  try {
    const before = notes.value.notes.length
    if (shown.value >= before && !notes.value.complete && !notes.value.loadingMore) {
      await updates.moreReleases()
      // A page of versions shown already (newer ones pushed it back) is a step too, as long as there are older ones.
      advanced = !notes.value.moreError && (notes.value.notes.length > before || !notes.value.complete)
    }
    if (shown.value < notes.value.notes.length) {
      shown.value += PAGE
      advanced = true
    }
  } finally {
    await nextTick()
    stepping = false
  }
  // Observed anew: if the end is still in view (short notes), the next step follows right away.
  if (advanced && end.value) {
    observer.unobserve(end.value)
    observer.observe(end.value)
  }
}

watch(end, (element, previous) => {
  if (previous) observer.unobserve(previous)
  if (element) observer.observe(element)
})
onBeforeUnmount(() => observer.disconnect())

const dateFormat = new Intl.DateTimeFormat('de', { day: 'numeric', month: 'long', year: 'numeric' })
const formatDate = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? dateFormat.format(new Date(iso)) : '')

const isInstalled = (version: string) => version === updates.state.current
const isNewer = (version: string) => !!updates.state.current && compareVersions(version, updates.state.current) > 0

const canCheck = computed(() => !['unsupported', 'checking', 'downloading', 'downloaded'].includes(updates.state.status))

function openLink(url: string) {
  void attempt(() => window.api.app.openExternal(url), 'Link konnte nicht geöffnet werden')
}

/** Links in the notes open in the browser; anchors within the notes are ignored. */
function onNotesClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  event.preventDefault()
  if (/^https?:/i.test(link.href)) openLink(link.href)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div v-if="filter.shows('updates.status')" class="flex flex-col gap-4" data-setting="updates.status">
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p class="min-w-64 flex-1 text-sm text-muted-foreground">
          Neue Versionen von Nexa und was sich darin geändert hat. Gesucht wird beim Start und alle 4 Stunden.
        </p>
        <div class="flex items-center gap-2">
          <Badge v-if="updates.state.current" variant="secondary" class="tabular-nums">Version {{ updates.state.current }}</Badge>
          <Button variant="outline" :disabled="!canCheck" @click="updates.check()">
            <RefreshCwIcon data-icon="inline-start" :class="updates.state.status === 'checking' && 'animate-spin'" />
            Jetzt suchen
          </Button>
        </div>
      </div>
      <UpdateStatus />
    </div>

    <section v-if="filter.shows('updates.notes')" class="flex flex-col gap-4" aria-labelledby="release-notes-heading" data-setting="updates.notes">
      <h3 id="release-notes-heading" class="text-sm font-semibold">Versionshinweise</h3>

      <div v-if="notes.loading && !notes.notes.length" class="flex flex-col gap-4">
        <Skeleton v-for="n in 2" :key="n" class="h-36 w-full rounded-xl" />
      </div>

      <Empty v-else-if="notes.error && !notes.notes.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CloudOffIcon />
          </EmptyMedia>
          <EmptyTitle>Versionshinweise nicht erreichbar</EmptyTitle>
          <EmptyDescription class="selectable">{{ notes.error }}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" @click="updates.reloadReleases()">Erneut laden</Button>
        </EmptyContent>
      </Empty>

      <Empty v-else-if="notes.loadedAt === null" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollTextIcon />
          </EmptyMedia>
          <EmptyTitle>Noch nicht geladen</EmptyTitle>
          <EmptyDescription>Die Versionshinweise kommen mit der Suche nach Updates.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" @click="updates.reloadReleases()">Jetzt laden</Button>
        </EmptyContent>
      </Empty>

      <Empty v-else-if="!notes.notes.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollTextIcon />
          </EmptyMedia>
          <EmptyTitle>Noch keine Versionen</EmptyTitle>
          <EmptyDescription>Sobald eine Version veröffentlicht ist, steht sie hier.</EmptyDescription>
        </EmptyHeader>
        <!-- GitHub may answer with an empty list for a moment right after a release. -->
        <EmptyContent>
          <Button variant="outline" size="sm" :disabled="notes.loading" @click="updates.reloadReleases()">Erneut laden</Button>
        </EmptyContent>
      </Empty>

      <template v-else>
        <Card
          v-for="release in visibleNotes"
          :key="release.version"
          :class="cn((release.version === updates.justUpdated || isNewer(release.version)) && 'bg-primary/5 ring-2 ring-primary/50')"
        >
          <CardHeader>
            <CardTitle class="flex items-center gap-2">
              <span class="tabular-nums">{{ release.version }}</span>
              <Badge v-if="release.version === updates.justUpdated">Gerade aktualisiert</Badge>
              <Badge v-else-if="isInstalled(release.version)" variant="secondary">Installiert</Badge>
              <Badge v-else-if="isNewer(release.version)">Neu</Badge>
            </CardTitle>
            <CardDescription v-if="release.date">
              <time :datetime="release.date">{{ formatDate(release.date) }}</time>
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" @click="openLink(release.url)">
                Auf GitHub
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent class="flex flex-col gap-3">
            <!-- Rendered and sanitized by GitHub. -->
            <div class="release-notes selectable" @click="onNotesClick" v-html="release.html" />
            <ReleaseDetails v-if="release.references.length" :references="release.references" />
          </CardContent>
        </Card>

        <div v-if="hasMore" ref="end" class="flex min-h-9 items-center justify-center gap-2 text-[0.8rem] text-muted-foreground">
          <template v-if="notes.moreError && shown >= notes.notes.length">
            <span class="selectable">Ältere Versionen nicht erreichbar: {{ notes.moreError }}</span>
            <Button variant="outline" size="sm" @click="step()">Erneut versuchen</Button>
          </template>
          <template v-else-if="notes.loadingMore">
            <Spinner class="size-3.5" />
            Ältere Versionen werden geladen …
          </template>
        </div>
      </template>
    </section>
  </div>
</template>
