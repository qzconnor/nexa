<script setup lang="ts">
import { ChevronDownIcon, ExternalLinkIcon, GitPullRequestDraftIcon, GitPullRequestIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, watch } from 'vue'
import type { PullRequestInfo } from '@shared/pull-requests'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePullRequests } from '@/composables/usePullRequests'
import { attempt } from '@/lib/errors'
import { pullRequestState, pullRequestToneClass } from '@/lib/pull-requests'
import { cn } from '@/lib/utils'

/**
 * The open pull requests of the chat's repository under the composer, as in Claude Code: the one of
 * the checked-out branch by its number, coloured by how it stands, else how many are open; the menu
 * lists them and opens one on GitHub. Nothing shows without open ones, outside GitHub or without the
 * GitHub CLI.
 */
const props = defineProps<{
  /** The chat's folder (on the start page the project's). */
  dir: string | null
  /** The agent works: when it is done, the list is read anew (it may have opened a pull request). */
  busy?: boolean
}>()

const { pullRequests, own, branch, webUrl, refresh } = usePullRequests(() => props.dir)

watch(
  () => props.busy,
  (busy, before) => {
    if (before && !busy) void refresh(true)
  },
)

const others = computed(() => pullRequests.value.length - (own.value ? 1 : 0))
const ownState = computed(() => (own.value ? pullRequestState(own.value) : null))

const tooltip = computed(() => {
  const count = pullRequests.value.length
  const all = count === 1 ? '1 offener Pull Request' : `${count} offene Pull Requests`
  if (!own.value || !ownState.value) return `${all} im Repository`
  const rest = others.value ? `\nDazu ${others.value === 1 ? '1 weiterer' : `${others.value} weitere`} offen` : ''
  return `Pull Request #${own.value.number} dieses Branches: ${ownState.value.label}\n${own.value.title}${rest}`
})

const iconOf = (pr: PullRequestInfo) => (pr.draft ? GitPullRequestDraftIcon : GitPullRequestIcon)

/** The state's word in its colour; an open or draft one stays grey like the rest of the line. */
function labelClass(pr: PullRequestInfo): string {
  const { tone } = pullRequestState(pr)
  return tone === 'open' || tone === 'draft' ? '' : pullRequestToneClass[tone]
}

function openUrl(url: string): void {
  void attempt(() => window.api.app.openExternal(url), 'GitHub ließ sich nicht öffnen')
}
</script>

<template>
  <DropdownMenu v-if="pullRequests.length">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="sm" class="min-w-0 gap-1.5 px-2 text-muted-foreground" :aria-label="tooltip" v-tooltip="tooltip">
        <template v-if="own && ownState">
          <component :is="iconOf(own)" :class="cn('size-3.5 shrink-0', pullRequestToneClass[ownState.tone])" />
          <span class="text-foreground tabular-nums">#{{ own.number }}</span>
          <span v-if="others" class="text-xs tabular-nums">+{{ others }}</span>
        </template>
        <template v-else>
          <GitPullRequestIcon class="size-3.5 shrink-0" />
          <span class="text-foreground tabular-nums">{{ pullRequests.length }}</span>
          <span class="truncate">offen</span>
        </template>
        <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="max-h-96 w-[26rem] overflow-y-auto">
      <DropdownMenuLabel>Offene Pull Requests</DropdownMenuLabel>
      <DropdownMenuItem v-for="pr in pullRequests" :key="pr.number" class="items-start gap-2.5" @select="openUrl(pr.url)">
        <component :is="iconOf(pr)" :class="cn('mt-0.5 size-4 shrink-0', pullRequestToneClass[pullRequestState(pr).tone])" />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="flex min-w-0 items-baseline gap-1.5">
            <span class="shrink-0 text-muted-foreground tabular-nums">#{{ pr.number }}</span>
            <span class="truncate">{{ pr.title }}</span>
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span :class="cn('shrink-0', labelClass(pr))">{{ pullRequestState(pr).label }}</span>
            <span aria-hidden="true">·</span>
            <span class="truncate">{{ pr.branch }} → {{ pr.base }}</span>
            <template v-if="pr.author">
              <span aria-hidden="true">·</span>
              <span class="shrink-0">{{ pr.author }}</span>
            </template>
          </span>
        </span>
        <span v-if="pr.branch === branch" class="mt-0.5 shrink-0 rounded-sm bg-muted px-1.5 py-px text-[0.7rem] text-muted-foreground">Dieser Branch</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem v-if="webUrl" @select="openUrl(`${webUrl}/pulls`)"><ExternalLinkIcon /> Alle auf GitHub</DropdownMenuItem>
      <DropdownMenuItem @select="refresh(true)"><RefreshCwIcon /> Aktualisieren</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
