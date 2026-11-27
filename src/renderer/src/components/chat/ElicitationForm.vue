<script setup lang="ts">
import { ExternalLinkIcon } from '@lucide/vue'
import { computed, reactive } from 'vue'
import type { InteractionRequest } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

type Elicitation = Extract<InteractionRequest, { type: 'elicitation' }>
interface Field {
  key: string
  title: string
  description?: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  options?: string[]
  required: boolean
}

/** What an MCP server asks for: the fields of its JSON schema, or a page to open. */
const props = defineProps<{ request: Elicitation; busy?: boolean }>()
const emit = defineEmits<{ answer: [action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>] }>()

const fields = computed<Field[]>(() => {
  const schema = props.request.schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] } | undefined
  const required = new Set(schema?.required ?? [])
  return Object.entries(schema?.properties ?? {}).map(([key, p]) => {
    const options = Array.isArray(p.enum) ? (p.enum as unknown[]).map(String) : undefined
    const type = options ? 'enum' : p.type === 'boolean' ? 'boolean' : p.type === 'number' || p.type === 'integer' ? 'number' : 'string'
    return { key, title: String(p.title ?? key), description: p.description ? String(p.description) : undefined, type, options, required: required.has(key) }
  })
})

const values = reactive<Record<string, string | boolean>>({})

function submit(): void {
  const content: Record<string, unknown> = {}
  for (const field of fields.value) {
    const value = values[field.key]
    if (value === undefined || value === '') continue
    content[field.key] = field.type === 'number' ? Number(value) : value
  }
  emit('answer', 'accept', content)
}

function openPage(): void {
  if (props.request.url) void window.api.app.openExternal(props.request.url)
  emit('answer', 'accept')
}

const complete = computed(() => fields.value.every((f) => !f.required || (values[f.key] !== undefined && values[f.key] !== '')))
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-[0.88rem] whitespace-pre-wrap">{{ request.message }}</p>
    <template v-if="request.url">
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" @click="openPage">
          <ExternalLinkIcon />
          Öffnen und fortfahren
        </Button>
        <Button variant="outline" size="sm" @click="emit('answer', 'decline')">Ablehnen</Button>
        <!-- What the card adds to the answers (InteractionStop). -->
        <slot name="actions" />
      </div>
    </template>
    <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
      <label v-for="field in fields" :key="field.key" class="flex flex-col gap-1">
        <span class="text-[0.82rem] font-medium">{{ field.title }}<span v-if="field.required" class="text-destructive"> *</span></span>
        <span v-if="field.description" class="text-[0.75rem] text-muted-foreground">{{ field.description }}</span>
        <Switch v-if="field.type === 'boolean'" :model-value="!!values[field.key]" @update:model-value="(v: boolean) => (values[field.key] = v)" />
        <Select v-else-if="field.type === 'enum'" v-model="values[field.key] as string">
          <SelectTrigger class="w-full bg-background/60" :aria-label="field.title"><SelectValue placeholder="Auswählen" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in field.options" :key="option" :value="option">{{ option }}</SelectItem>
          </SelectContent>
        </Select>
        <Input v-else v-model="values[field.key] as string" :type="field.type === 'number' ? 'number' : 'text'" class="h-8 text-sm" />
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" :disabled="busy || !complete">Senden</Button>
        <Button type="button" variant="outline" size="sm" :disabled="busy" @click="emit('answer', 'decline')">Ablehnen</Button>
        <slot name="actions" />
      </div>
    </form>
  </div>
</template>
