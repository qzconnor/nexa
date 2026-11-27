<script setup lang="ts">
import { AppWindowIcon, BellIcon, BellOffIcon, PowerIcon, SquarePenIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { TrayLimit, TrayMenuAction, TrayMenuApi, TrayMenuState } from '@shared/tray-menu'
import AccountDot from '@/components/accounts/AccountDot.vue'
import AppLogo from '@/components/common/AppLogo.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import UsageRing from '@/components/common/UsageRing.vue'
import { Spinner } from '@/components/ui/spinner'
import { formatAhead } from '@/lib/format'
import { clampPercent, shortWindowLabels, usageTextClass, windowsOfModel } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { applyTheme } from '@/themes/apply'

/** The only bridge this page has (src/preload/tray.ts); `window.api` doesn't exist here. */
const bridge = (window as unknown as { trayMenu: TrayMenuApi }).trayMenu

const state = ref<TrayMenuState | null>(null)
const root = ref<HTMLElement | null>(null)

const more = computed(() => (state.value ? state.value.waiting + state.value.working - state.value.chats.length : 0))

const summary = computed(() => {
  const s = state.value
  if (!s || (!s.waiting && !s.working)) return 'Kein Chat arbeitet'
  const parts: string[] = []
  if (s.waiting) parts.push(s.waiting === 1 ? '1 wartet auf dich' : `${s.waiting} warten auf dich`)
  if (s.working) parts.push(s.waiting ? `${s.working} ${s.working === 1 ? 'arbeitet' : 'arbeiten'}` : s.working === 1 ? '1 Chat arbeitet' : `${s.working} Chats arbeiten`)
  return parts.join(' · ')
})

/**
 * An account's windows as the title bar shows them: the two that limit the model new chats start with.
 * Without a model, a CLI with groups of models (Antigravity) has windows of each: those of the group
 * nearest its limit, so one group's stand side by side.
 */
function limitWindows(limit: TrayLimit): { key: string; label: string; percent: number }[] {
  let windows = windowsOfModel(limit.windows, limit.model ? { id: limit.model } : null)
  if (windows.some((w) => w.models?.length)) {
    const fullest = windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a))
    const group = fullest.label.split(' · ')[0]
    windows = windows.filter((w) => !w.models?.length || w.label.startsWith(`${group} · `))
  }
  windows = windows.slice(0, 2)
  const labels = shortWindowLabels(windows)
  return windows.map((w, i) => ({ key: w.key, label: labels[i]!, percent: clampPercent(w.usedPercent) }))
}

/** When an account at its limit is free again: „bis 14:20“, further away with the weekday. */
function freeText(limit: TrayLimit): string {
  return `Limit bis ${limit.estimated ? 'ca. ' : ''}${formatAhead(limit.freeAt!)}`
}

async function show(next: TrayMenuState): Promise<void> {
  applyTheme(next.theme, next.appearance, next.translucent)
  // The theme's menu colour; over acrylic tinted strongly like the system's menus, since the window's
  // lighter tint turned a light theme grey over dark windows.
  document.body.style.background = next.translucent ? 'color-mix(in oklab, var(--popover) 88%, transparent)' : 'var(--popover)'
  state.value = next
  await nextTick()
  const height = Math.ceil(root.value?.getBoundingClientRect().height ?? 0)
  if (height > 0) await bridge.ready(next.seq, height).catch(() => undefined)
}

function act(action: TrayMenuAction): void {
  void bridge.act(action).catch(() => undefined)
}

function items(): HTMLElement[] {
  return [...(root.value?.querySelectorAll<HTMLElement>('[data-item]') ?? [])]
}

/** Arrows, Home and End move between the entries as in the system's menus; Esc closes. */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void bridge.close().catch(() => undefined)
    return
  }
  const list = items()
  if (!list.length) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length
  else if (event.key === 'ArrowUp') next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = list.length - 1
  if (next === null) return
  event.preventDefault()
  list[next]!.focus()
}

/** A hidden menu forgets where the keyboard was: the next one opens without a marked entry. */
function onVisibility(): void {
  if (document.visibilityState === 'hidden') (document.activeElement as HTMLElement | null)?.blur()
}

let offState: (() => void) | null = null

onMounted(async () => {
  offState = bridge.onState((next) => void show(next))
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  // The state main sends on opening may come first; the newer one wins.
  const first = await bridge.state().catch(() => null)
  if (first && (!state.value || first.seq > state.value.seq)) await show(first)
})

onUnmounted(() => {
  offState?.()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
})

const item =
  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent'
const icon = 'size-4 shrink-0 text-muted-foreground'
</script>

<template>
  <div v-if="state" ref="root" role="menu" aria-label="Nexa" class="flex flex-col p-1.5 text-sm text-foreground">
    <div class="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2">
      <AppLogo class="size-7" />
      <div class="min-w-0">
        <div class="leading-tight font-medium">Nexa</div>
        <div :class="cn('truncate text-xs', state.waiting ? 'text-warning' : 'text-muted-foreground')">{{ summary }}</div>
      </div>
    </div>

    <template v-if="state.chats.length">
      <div class="mx-1 my-1 h-px bg-border" role="separator" />
      <button
        v-for="chat in state.chats"
        :key="chat.id"
        type="button"
        role="menuitem"
        data-item
        :class="item"
        @click="act({ kind: 'chat', sessionId: chat.id })"
      >
        <ProviderIcon :provider="chat.provider" class="size-3.5 shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ chat.title }}</span>
          <span v-if="chat.project" class="block truncate text-xs text-muted-foreground">{{ chat.project }}</span>
        </span>
        <span v-if="chat.status === 'waiting'" class="flex shrink-0 items-center gap-1.5 text-xs text-warning">
          <span class="pulse-ring size-2 rounded-full bg-warning" />
          Wartet
        </span>
        <Spinner v-else class="size-3 shrink-0 text-primary" aria-label="Arbeitet" />
      </button>
      <button v-if="more > 0" type="button" role="menuitem" data-item :class="cn(item, 'text-muted-foreground')" @click="act({ kind: 'open' })">
        <span class="w-3.5 shrink-0" />
        {{ more === 1 ? '1 weiterer in Nexa' : `${more} weitere in Nexa` }}
      </button>
    </template>

    <template v-if="state.limits.length">
      <div class="mx-1 my-1 h-px bg-border" role="separator" />
      <div role="group" aria-label="Limits" class="flex flex-col px-2.5 py-0.5">
        <div v-for="limit in state.limits" :key="limit.accountId" class="flex min-w-0 items-center gap-2 py-1 text-xs">
          <span class="relative shrink-0">
            <ProviderIcon :provider="limit.provider" class="size-3.5" />
            <AccountDot v-if="limit.color" :color="limit.color" class="absolute -right-1 -bottom-1 size-1.5 ring-1" />
          </span>
          <span class="min-w-16 flex-1 truncate">{{ limit.name }}</span>
          <span v-if="limit.freeAt" :class="cn('shrink-0 font-medium tabular-nums', usageTextClass.high)">{{ freeText(limit) }}</span>
          <!-- Long names of groups of models: the second window goes below rather than squeezing the name. -->
          <span v-else class="flex min-w-0 flex-wrap justify-end gap-x-2.5 gap-y-0.5">
            <span v-for="w in limitWindows(limit)" :key="w.key" class="flex shrink-0 items-center gap-1">
              <UsageRing :percent="w.percent" :size="12" />
              <span class="text-muted-foreground">{{ w.label }}</span>
              <span :class="cn('font-medium tabular-nums', w.percent >= 85 ? usageTextClass.high : 'text-foreground')">{{ w.percent }}&nbsp;%</span>
            </span>
          </span>
        </div>
      </div>
    </template>

    <div class="mx-1 my-1 h-px bg-border" role="separator" />
    <button type="button" role="menuitem" data-item :class="item" @click="act({ kind: 'new' })">
      <SquarePenIcon :class="icon" />
      Neuer Chat
    </button>
    <button
      type="button"
      role="menuitemcheckbox"
      :aria-checked="state.notifications"
      data-item
      :class="item"
      @click="act({ kind: 'notifications', enabled: !state.notifications })"
    >
      <BellIcon v-if="state.notifications" :class="icon" />
      <BellOffIcon v-else :class="icon" />
      <span class="flex-1">Benachrichtigungen</span>
      <span :class="cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', state.notifications ? 'bg-primary' : 'bg-input')">
        <span
          :class="
            cn(
              'absolute top-0.5 left-0.5 size-3 rounded-full transition-transform',
              state.notifications ? 'translate-x-3 bg-primary-foreground' : 'bg-muted-foreground',
            )
          "
        />
      </span>
    </button>

    <div class="mx-1 my-1 h-px bg-border" role="separator" />
    <button type="button" role="menuitem" data-item :class="item" @click="act({ kind: 'open' })">
      <AppWindowIcon :class="icon" />
      Nexa öffnen
    </button>
    <button type="button" role="menuitem" data-item :class="item" @click="act({ kind: 'quit' })">
      <PowerIcon :class="icon" />
      Beenden
    </button>
  </div>
</template>
