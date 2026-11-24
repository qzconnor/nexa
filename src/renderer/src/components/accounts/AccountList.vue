<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import AccountRow from './AccountRow.vue'

/**
 * The accounts of one CLI in the user's order: dragged by their handle, or moved with the arrow keys
 * on it. The order is the one lists show and the one a chat goes through at a limit.
 */
const props = defineProps<{ provider: ProviderId }>()
const emit = defineEmits<{ remove: [account: Account] }>()
const accounts = useAccountsStore()

const list = computed(() => accounts.ofProvider(props.provider))
const dragging = ref<string | null>(null)
/** Where the dragged one would land: before this account, `null` at the end, `undefined` nowhere. */
const before = ref<string | null | undefined>(undefined)

function save(ids: string[]): void {
  void attempt(() => accounts.reorder(ids), 'Reihenfolge ließ sich nicht speichern')
}

function start(event: DragEvent, account: Account): void {
  if (!event.dataTransfer) return
  dragging.value = account.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-nexa-account', account.id)
  // The whole card goes with the pointer, not just the handle.
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-account-row]')
  if (row) event.dataTransfer.setDragImage(row, 20, 20)
}

/** Over a card: before it in its upper half, else after it. A place that changes nothing shows no line. */
function over(event: DragEvent, index: number): void {
  const id = dragging.value
  if (!id) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const target = event.clientY < rect.top + rect.height / 2 ? list.value[index]!.id : (list.value[index + 1]?.id ?? null)
  const from = list.value.findIndex((a) => a.id === id)
  const to = target === null ? list.value.length : list.value.findIndex((a) => a.id === target)
  before.value = to === from || to === from + 1 ? undefined : target
}

function drop(event: DragEvent): void {
  const id = dragging.value
  const at = before.value
  end()
  if (!id || at === undefined) return
  event.preventDefault()
  const ids = list.value.map((a) => a.id).filter((other) => other !== id)
  ids.splice(at === null ? ids.length : ids.indexOf(at), 0, id)
  save(ids)
}

function end(): void {
  dragging.value = null
  before.value = undefined
}

/** The arrow keys on the handle move the account one place. */
function step(account: Account, by: -1 | 1): void {
  const ids = list.value.map((a) => a.id)
  const from = ids.indexOf(account.id)
  const to = from + by
  if (from < 0 || to < 0 || to >= ids.length) return
  ids.splice(from, 1)
  ids.splice(to, 0, account.id)
  save(ids)
}
</script>

<template>
  <!-- The gap between two cards takes the drop too: the line stays where it was. -->
  <div class="flex flex-col gap-5" @dragover="dragging && $event.preventDefault()" @drop="drop">
    <div
      v-for="(account, index) in list"
      :key="account.id"
      :class="cn('relative', dragging === account.id && 'opacity-50')"
      @dragover="over($event, index)"
    >
      <div v-if="before === account.id" class="pointer-events-none absolute inset-x-1 -top-[11px] h-0.5 rounded-full bg-primary" />
      <div v-if="before === null && index === list.length - 1" class="pointer-events-none absolute inset-x-1 -bottom-[11px] h-0.5 rounded-full bg-primary" />
      <AccountRow
        :account="account"
        :sortable="list.length > 1"
        @remove="emit('remove', account)"
        @drag-start="start($event, account)"
        @drag-end="end"
        @step="step(account, $event)"
      />
    </div>
  </div>
</template>
