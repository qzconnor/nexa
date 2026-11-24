<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, SearchIcon } from '@lucide/vue'
import { ComboboxInput } from 'reka-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxViewport,
} from '@/components/ui/combobox'
import { fontStack, listInstalledFonts } from '@/lib/fonts'

/**
 * Picks a font from the installed ones, or takes a typed name (from the Claude Manager's terminal
 * settings). `''` is Nexa's own font, `standard` by name; `fallbacks` stand behind each font as in the app.
 */
const props = defineProps<{ id?: string; standard: string; recommended: readonly string[]; fallbacks: readonly string[] }>()
const model = defineModel<string>({ required: true })

const installed = ref<string[]>([])
const open = ref(false)
const search = ref('')

onMounted(async () => {
  installed.value = await listInstalledFonts()
})

watch(open, (isOpen) => {
  if (isOpen) search.value = ''
})

/** The item of Nexa's own font: reka's items need a value that isn't empty. */
const STANDARD = '__standard__'
const standardLabel = computed(() => `${props.standard} (Standard)`)

const installedSet = computed(() => new Set(installed.value.map((f) => f.toLowerCase())))
/**
 * Shown in each font next to its name; the app itself shows the chosen one in full.
 * Short, so long names stay whole ("JetBrainsMonoNL Nerd Font Mono" next to "… Nerd Font").
 */
const SAMPLE = 'Abc'

const recommended = computed(() => props.recommended.filter((f) => installedSet.value.has(f.toLowerCase())))
const others = computed(() => {
  const rec = new Set(recommended.value.map((f) => f.toLowerCase()))
  return installed.value.filter((f) => !rec.has(f.toLowerCase()))
})
const custom = computed(() => {
  const value = search.value.trim()
  if (!value) return null
  return installedSet.value.has(value.toLowerCase()) ? null : value
})
const groups = computed(() => [
  { heading: 'Empfohlen', fonts: recommended.value },
  { heading: 'Installiert', fonts: others.value },
])

function select(value: unknown) {
  if (value === STANDARD) model.value = ''
  else if (typeof value === 'string' && value.trim()) model.value = value.trim()
}
</script>

<template>
  <Combobox v-model:open="open" :model-value="model || STANDARD" @update:model-value="select">
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <Button :id="id" variant="outline" class="w-64 justify-between gap-2 bg-background/60 pr-2 pl-2.5 font-normal">
          <span class="truncate">{{ model || standardLabel }}</span>
          <ChevronDownIcon class="text-muted-foreground" />
        </Button>
      </ComboboxTrigger>
    </ComboboxAnchor>
    <!-- As wide as the button; taller than a usual list, there are hundreds of fonts. -->
    <ComboboxList class="max-h-96">
      <!-- reka lays the list out as a flex column: without shrink-0 the long list squeezes the search. -->
      <div class="flex h-9 shrink-0 items-center gap-2 border-b px-2.5">
        <SearchIcon class="size-4 shrink-0 text-muted-foreground" />
        <!-- Starts empty instead of with the chosen font's name. -->
        <ComboboxInput
          v-model="search"
          :display-value="() => ''"
          placeholder="Schrift suchen oder eingeben…"
          class="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ComboboxViewport class="max-h-[min(calc(--spacing(96)---spacing(9)),calc(var(--available-height)---spacing(9)))]">
        <ComboboxEmpty>Keine passende Schrift installiert.</ComboboxEmpty>
        <ComboboxGroup>
          <ComboboxItem :value="STANDARD" :text-value="standardLabel">
            <span class="min-w-0 flex-1 truncate">{{ standardLabel }}</span>
            <span class="shrink-0 text-xs text-muted-foreground" :style="{ fontFamily: fontStack('', fallbacks) }">{{ SAMPLE }}</span>
            <ComboboxItemIndicator><CheckIcon /></ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxGroup>
        <template v-for="group in groups" :key="group.heading">
          <template v-if="group.fonts.length">
            <!-- Not while searching: a group without matches would leave its line alone. -->
            <ComboboxSeparator v-if="!search" />
            <ComboboxGroup :heading="group.heading">
              <!-- Off screen the items aren't drawn, so their fonts load only when scrolled to. -->
              <ComboboxItem
                v-for="font in group.fonts"
                :key="font"
                :value="font"
                :text-value="font"
                class="[contain-intrinsic-size:auto_1.75rem] [content-visibility:auto]"
              >
                <span class="min-w-0 flex-1 truncate">{{ font }}</span>
                <span class="shrink-0 text-xs text-muted-foreground" :style="{ fontFamily: fontStack(font, fallbacks) }">{{ SAMPLE }}</span>
                <ComboboxItemIndicator><CheckIcon /></ComboboxItemIndicator>
              </ComboboxItem>
            </ComboboxGroup>
          </template>
        </template>
        <!-- Last, so Enter takes the first font found and not the typed text. -->
        <ComboboxGroup v-if="custom" heading="Eigene Eingabe">
          <ComboboxItem :value="custom">
            <span class="truncate">„{{ custom }}“ verwenden</span>
          </ComboboxItem>
        </ComboboxGroup>
      </ComboboxViewport>
    </ComboboxList>
  </Combobox>
</template>
