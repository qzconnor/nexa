<script setup lang="ts">
import { AppWindowIcon, BellIcon, BellOffIcon, PowerIcon, SquarePenIcon } from '@lucide/vue'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { TrayMenuAction, TrayMenuApi, TrayMenuState } from '@shared/tray-menu'
import AppLogo from '@/components/common/AppLogo.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Spinner } from '@/components/ui/spinner'
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
