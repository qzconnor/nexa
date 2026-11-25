<script setup lang="ts">
import { FileIcon, FolderIcon } from '@lucide/vue'
import { computed, reactive } from 'vue'
import type { FormField, FormRequest, FormValue } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import Markdown from './Markdown.vue'

/** A form of the agent (`ask_user`): its fields, prefilled with their defaults, sent as values or declined. */
const props = defineProps<{ request: FormRequest; busy?: boolean }>()
const emit = defineEmits<{ submit: [values: Record<string, FormValue>]; decline: [] }>()

function initial(field: FormField): FormValue {
  if (field.default !== undefined) return Array.isArray(field.default) ? [...field.default] : field.default
  if (field.type === 'boolean') return false
  if (field.type === 'multiselect') return []
  return ''
}

const values = reactive<Record<string, FormValue>>(Object.fromEntries(props.request.fields.map((f) => [f.key, initial(f)])))

function filled(field: FormField): boolean {
  const value = values[field.key]
  if (field.type === 'boolean') return true
  if (Array.isArray(value)) return value.length > 0
  return String(value ?? '').trim() !== ''
}

const complete = computed(() => props.request.fields.every((f) => !f.required || filled(f)))

function toggle(field: FormField, option: string, on: boolean): void {
  const list = (values[field.key] as string[]).filter((o) => o !== option)
  // In the order of the options, not of the clicks.
  values[field.key] = on ? (field.options ?? []).filter((o) => o === option || list.includes(o)) : list
}

async function pick(field: FormField, folder: boolean): Promise<void> {
  const current = String(values[field.key] ?? '') || undefined
  const path = folder ? await window.api.app.pickDirectory(current) : (await window.api.app.pickFiles(current))[0]
  if (path) values[field.key] = path
}

/** What the agent gets: numbers as numbers, empty fields left out. */
function submit(): void {
  if (!complete.value) return
  const out: Record<string, FormValue> = {}
  for (const field of props.request.fields) {
    const value = values[field.key]
    if (field.type === 'boolean') out[field.key] = !!value
    else if (field.type === 'multiselect') out[field.key] = value as string[]
    else if (filled(field)) {
      const text = String(value).trim()
      out[field.key] = field.type === 'number' && Number.isFinite(Number(text)) ? Number(text) : text
    }
  }
  emit('submit', out)
}
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <Markdown v-if="request.description" :text="request.description" class="text-[0.88rem]" />
    <div v-for="field in request.fields" :key="field.key" class="flex flex-col gap-1">
      <div v-if="field.type === 'boolean'" class="flex items-center justify-between gap-3">
        <label :for="`ask-${field.key}`" class="text-[0.82rem] font-medium">{{ field.label }}</label>
        <Switch :id="`ask-${field.key}`" :model-value="!!values[field.key]" @update:model-value="(v: boolean) => (values[field.key] = v)" />
      </div>
      <label v-else :for="`ask-${field.key}`" class="text-[0.82rem] font-medium">
        {{ field.label }}<span v-if="field.required" class="text-destructive"> *</span>
      </label>
      <span v-if="field.description" class="text-[0.75rem] text-muted-foreground">{{ field.description }}</span>
      <Textarea v-if="field.type === 'textarea'" :id="`ask-${field.key}`" v-model="values[field.key] as string" class="min-h-16 bg-background/60 text-sm" />
      <Select v-else-if="field.type === 'select'" v-model="values[field.key] as string">
        <SelectTrigger :id="`ask-${field.key}`" class="w-full bg-background/60"><SelectValue placeholder="Auswählen" /></SelectTrigger>
        <SelectContent>
          <SelectItem v-for="option in field.options" :key="option" :value="option">{{ option }}</SelectItem>
        </SelectContent>
      </Select>
      <div v-else-if="field.type === 'multiselect'" :id="`ask-${field.key}`" class="flex flex-col gap-1.5 pt-0.5">
        <label v-for="option in field.options" :key="option" class="flex items-center gap-2 text-[0.85rem]">
          <Checkbox
            :model-value="(values[field.key] as string[]).includes(option)"
            @update:model-value="(on) => toggle(field, option, on === true)"
          />
          {{ option }}
        </label>
      </div>
      <div v-else-if="field.type === 'path'" class="flex gap-1.5">
        <Input :id="`ask-${field.key}`" v-model="values[field.key] as string" class="h-8 bg-background/60 font-mono text-[0.8rem]" />
        <Button type="button" variant="outline" size="icon-sm" aria-label="Ordner wählen" v-tooltip="'Ordner wählen'" @click="pick(field, true)">
          <FolderIcon />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" aria-label="Datei wählen" v-tooltip="'Datei wählen'" @click="pick(field, false)">
          <FileIcon />
        </Button>
      </div>
      <Input
        v-else-if="field.type !== 'boolean'"
        :id="`ask-${field.key}`"
        v-model="values[field.key] as string"
        :type="field.type === 'number' ? 'number' : 'text'"
        class="h-8 bg-background/60 text-sm"
      />
    </div>
    <div class="flex gap-2">
      <Button type="submit" size="sm" :disabled="busy || !complete">{{ request.submitLabel || 'Senden' }}</Button>
      <Button type="button" variant="outline" size="sm" :disabled="busy" @click="emit('decline')">Ablehnen</Button>
    </div>
  </form>
</template>
