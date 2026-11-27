<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, MicIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { PermissionMode, ProviderId } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { ModelDefaults } from '@shared/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useProvidersStore } from '@/stores/providers'
import { useUiStore } from '@/stores/ui'
import EffortSlider from './EffortSlider.vue'

/**
 * What opens under the composer's gear: model, thinking effort, Claude's Ultracode and the permission
 * mode, and a way to the voice input's settings.
 */
const props = defineProps<{
  provider: ProviderId
  model: string
  effort: string
  mode: PermissionMode
  /** The chat's choice; missing: as the CLI's settings say (`defaults`). */
  ultracode?: boolean
  defaults: ModelDefaults | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:model': [string]
  'update:effort': [string]
  'update:mode': [PermissionMode]
  'update:ultracode': [boolean]
}>()
const providers = useProvidersStore()
const ui = useUiStore()

const models = computed(() => providers.models[props.provider] ?? [])
const current = computed(() => models.value.find((m) => m.id === props.model) ?? models.value.find((m) => m.isDefault))
const modelLabel = computed(() => (props.model ? (models.value.find((m) => m.id === props.model)?.label ?? props.model) : (current.value?.label ?? 'Standard')))
const efforts = computed(() => current.value?.efforts ?? [])
/** The CLI's own answer first: Claude Code's default depends on the model and the account's settings. */
const defaultEffort = computed(() => props.defaults?.effort || current.value?.defaultEffort)
const modes = computed(() => PROVIDERS[props.provider].permissionModes)
const ultracodeShown = computed(() => props.provider === 'claude' && !!props.defaults?.ultracode?.available)
const ultracodeOn = computed(() => props.ultracode ?? props.defaults?.ultracode?.on ?? false)

function openModels(open: boolean): void {
  if (open && !models.value.length) void providers.loadModels(props.provider)
}

function pickModel(id: string): void {
  emit('update:model', id)
  // An effort the new model doesn't know goes back to its default.
  const model = models.value.find((m) => m.id === id)
  if (props.effort && model?.efforts && !model.efforts.includes(props.effort)) emit('update:effort', '')
}
</script>

<template>
  <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-3 px-4 pt-1 pb-3.5 text-[0.82rem]">
    <span class="text-muted-foreground">Modell</span>
    <div class="flex min-w-0 items-center gap-2">
      <DropdownMenu @update:open="openModels">
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="max-w-full min-w-0 gap-1.5 bg-transparent px-2.5 font-normal" :disabled="disabled">
            <span class="truncate">{{ modelLabel }}</span>
            <ChevronDownIcon class="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="max-h-96 w-72 overflow-y-auto">
          <DropdownMenuLabel>Modell</DropdownMenuLabel>
          <div v-if="!models.length" role="status" aria-label="Modelle werden geladen" class="flex flex-col gap-3 px-2 py-1.5">
            <div v-for="i in 3" :key="i" class="flex flex-col gap-1.5">
              <Skeleton :class="cn('h-3.5', i === 2 ? 'w-1/3' : 'w-2/5')" />
              <Skeleton class="h-3 w-4/5" />
            </div>
          </div>
          <DropdownMenuItem v-for="m in models" :key="m.id || 'default'" class="items-start gap-2" @select="pickModel(m.id)">
            <span class="flex min-w-0 flex-col">
              <span>{{ m.label }}</span>
              <span v-if="m.description" class="line-clamp-2 text-xs text-muted-foreground">{{ m.description }}</span>
            </span>
            <CheckIcon v-if="m.id === model || (!model && m.isDefault && !models.some((x) => x.id === ''))" class="mt-0.5 ml-auto shrink-0" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <!-- The microphone sits by the send button; what it does is set in the settings, not per chat. -->
      <Button
        variant="ghost"
        size="sm"
        class="ml-auto shrink-0 gap-1.5 px-2 font-normal text-muted-foreground"
        v-tooltip="'Mikrofon, Sprache, automatisch beenden und abschicken'"
        @click="ui.openSettings('chat', 'chat.voice')"
      >
        <MicIcon class="size-3.5" />
        Spracheingabe …
      </Button>
    </div>

    <template v-if="efforts.length">
      <span class="self-start pt-0.5 text-muted-foreground">Denkaufwand</span>
      <EffortSlider
        class="max-w-md"
        :efforts="efforts"
        :value="effort"
        :default-effort="defaultEffort"
        :disabled="disabled"
        @update:value="emit('update:effort', $event)"
      />
    </template>

    <template v-if="ultracodeShown">
      <span class="text-muted-foreground">Ultracode</span>
      <label class="flex min-w-0 cursor-pointer items-center gap-2.5">
        <Switch :model-value="ultracodeOn" :disabled="disabled" @update:model-value="emit('update:ultracode', $event)" />
        <span class="truncate text-muted-foreground">Dynamische Workflows bei jeder Aufgabe</span>
      </label>
    </template>

    <span class="self-start pt-1.5 text-muted-foreground">Freigaben</span>
    <div class="flex min-w-0 flex-col gap-1">
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              :class="cn('gap-1.5 bg-transparent px-2.5 font-normal', mode === 'full' && 'text-destructive', mode === 'plan' && 'text-primary')"
            >
              {{ PERMISSION_MODES[mode].label }}
              <ChevronDownIcon class="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-72">
            <DropdownMenuLabel>Freigaben</DropdownMenuLabel>
            <DropdownMenuItem v-for="m in modes" :key="m" class="items-start" @select="emit('update:mode', m)">
              <span class="flex flex-col">
                <span :class="m === 'full' && 'text-destructive'">{{ PERMISSION_MODES[m].label }}</span>
                <span class="text-xs text-muted-foreground">{{ PERMISSION_MODES[m].description }}</span>
              </span>
              <CheckIcon v-if="m === mode" class="mt-0.5 ml-auto shrink-0" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <span class="text-[0.75rem] text-muted-foreground">{{ PERMISSION_MODES[mode].description }}</span>
    </div>
  </div>
</template>
