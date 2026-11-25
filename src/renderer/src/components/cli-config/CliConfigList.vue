<script setup lang="ts">
import { PlusIcon, XIcon } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'

/**
 * A list of rules or folders: a row each, a field to add one. Every change goes out as the whole list
 * at once, which the page saves.
 */
const props = defineProps<{ items: string[]; placeholder?: string; disabled?: boolean; label: string }>()
const emit = defineEmits<{ change: [items: string[]] }>()

const draft = ref('')

function add(): void {
  const value = draft.value.trim()
  if (!value) return
  draft.value = ''
  if (!props.items.includes(value)) emit('change', [...props.items, value])
}
function remove(index: number): void {
  emit('change', props.items.filter((_, i) => i !== index))
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div v-for="(item, index) in items" :key="item" class="group/item flex min-w-0 items-center gap-2 rounded-md border bg-background/40 py-0.5 pr-0.5 pl-2.5">
      <span class="min-w-0 flex-1 truncate font-mono text-xs" v-tooltip="item">{{ item }}</span>
      <Button variant="ghost" size="icon-xs" :disabled="disabled" :aria-label="`„${item}“ entfernen`" @click="remove(index)"><XIcon /></Button>
    </div>
    <InputGroup class="h-8 bg-background/40">
      <InputGroupInput
        v-model="draft"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="`${label}: hinzufügen`"
        spellcheck="false"
        autocomplete="off"
        class="font-mono text-xs"
        @keydown.enter.prevent="add"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" :disabled="disabled || !draft.trim()" aria-label="Hinzufügen" @click="add"><PlusIcon /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
