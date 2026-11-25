<script setup lang="ts">
import { LockIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { PermissionField, PermissionValue } from '@shared/cli-config'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Badge } from '@/components/ui/badge'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { attempt } from '@/lib/errors'
import { useCliConfigStore } from '@/stores/cli-config'
import CliConfigList from './CliConfigList.vue'

/** The permission settings of the scope shown, drawn by their kind; each change is saved at once. */
const store = useCliConfigStore()

const permissions = computed(() => store.snapshot!.permissions)
const readOnly = computed(() => !!store.snapshot?.readOnly)
const busy = ref<string | null>(null)

/** A select item can't carry an empty value: this one stands for „not set“ (the CLI's default). */
const UNSET = '__unset__'
type Toggle = 'unset' | 'on' | 'off'
const TOGGLE_OPTIONS: { value: Toggle; label: string }[] = [
  { value: 'unset', label: 'Standard' },
  { value: 'on', label: 'An' },
  { value: 'off', label: 'Aus' },
]

const disabled = (field: PermissionField) => readOnly.value || !!field.locked || busy.value === field.key

async function save(field: PermissionField, value: PermissionValue): Promise<void> {
  busy.value = field.key
  await attempt(() => store.savePermissions({ [field.key]: value }), 'Speichern fehlgeschlagen')
  busy.value = null
}

const toggleValue = (value: boolean | null): Toggle => (value === null ? 'unset' : value ? 'on' : 'off')
const fromToggle = (value: Toggle): boolean | null => (value === 'unset' ? null : value === 'on')
</script>

<template>
  <div class="flex flex-col gap-5">
    <template v-for="(field, i) in permissions.fields" :key="field.key">
      <h4 v-if="field.group && field.group !== permissions.fields[i - 1]?.group" class="-mb-2 border-t pt-4 text-sm font-medium">{{ field.group }}</h4>
      <Field :orientation="field.kind === 'list' ? 'vertical' : 'horizontal'" class="gap-x-6 gap-y-2">
        <FieldContent>
          <FieldLabel>
            <span>{{ field.label }}</span>
            <Badge v-if="field.locked" variant="outline" v-tooltip="field.locked"><LockIcon data-icon="inline-start" /> Nur ansehen</Badge>
          </FieldLabel>
          <FieldDescription v-if="field.description">{{ field.description }}</FieldDescription>
        </FieldContent>

        <Select
          v-if="field.kind === 'select'"
          :model-value="field.value ?? UNSET"
          :disabled="disabled(field)"
          @update:model-value="(v) => save(field, v === UNSET ? null : String(v))"
        >
          <SelectTrigger class="min-w-48 bg-background/60" :aria-label="field.label"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="UNSET">{{ field.unsetLabel }}</SelectItem>
            <SelectItem v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</SelectItem>
          </SelectContent>
        </Select>

        <SegmentedControl
          v-else-if="field.kind === 'toggle'"
          :model-value="toggleValue(field.value)"
          :options="TOGGLE_OPTIONS"
          :disabled="disabled(field)"
          :aria-label="field.label"
          @update:model-value="(v: Toggle) => save(field, fromToggle(v))"
        />

        <CliConfigList
          v-else
          :items="field.value"
          :label="field.label"
          :placeholder="field.placeholder"
          :disabled="disabled(field)"
          @change="(items) => save(field, items)"
        />
      </Field>
    </template>
    <p v-if="permissions.note" class="text-xs text-muted-foreground">{{ permissions.note }}</p>
  </div>
</template>
