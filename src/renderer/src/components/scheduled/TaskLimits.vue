<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { Account } from '@shared/accounts'
import { USAGE_WINDOW_KINDS, USAGE_WINDOW_LABELS, checkUsage, describeRange, usageByKind, type UsageWindowKind } from '@shared/scheduled-tasks'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useClock } from '@/composables/useClock'
import { guardOfDraft, type LimitsDraft } from '@/lib/scheduled'
import { usageLevel } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useProvidersStore } from '@/stores/providers'

/**
 * The limits of a scheduled task in its dialog: per kind of window a range of usage the account must
 * be in for a run (below a threshold, above a point, or between), with where the account stands now,
 * and what a run does when it doesn't fit.
 */
const props = defineProps<{
  /** The account the runs would use now (the task's own or the CLI's default). */
  account: Account | undefined
  /** The task runs only by hand: the limits don't apply to „Jetzt ausführen“. */
  manual: boolean
  disabled?: boolean
}>()
const draft = defineModel<LimitsDraft>({ required: true })

const providers = useProvidersStore()
const now = useClock(30_000)

const OTHERWISE = [
  { value: 'skip' as const, label: 'Lauf auslassen' },
  { value: 'wait' as const, label: 'Warten, bis es passt' },
]

const apiKey = computed(() => props.account?.kind === 'apiKey')
const usage = computed(() => (props.account ? providers.usageOf(props.account.id) : undefined))
/** Where the account stands now, per kind of window; empty without numbers. */
const current = computed(() => (usage.value ? usageByKind(usage.value, now.value) : {}))

const guard = computed(() => guardOfDraft(draft.value))

/** Whether a run would go now, in words, with an icon and a tone. */
const status = computed(() => {
  if (apiKey.value) return { tone: 'muted', icon: CircleHelpIcon, text: 'Ein API-Key hat keine Planlimits: Die Aufgabe läuft immer.' }
  if (!guard.value) return { tone: 'muted', icon: CircleHelpIcon, text: 'Alle Bereiche reichen von 0 bis 100 %: Die Aufgabe läuft immer.' }
  const check = checkUsage(guard.value, usage.value, now.value)
  if (check.fits) return { tone: 'ok', icon: CircleCheckIcon, text: 'Gerade passt es, ein Lauf würde starten.' }
  if (check.fits === null) {
    return draft.value.runWithoutNumbers
      ? { tone: 'muted', icon: CircleHelpIcon, text: 'Für diesen Account kennt Nexa noch keine Zahlen; ein Lauf würde trotzdem starten.' }
      : { tone: 'warn', icon: CircleAlertIcon, text: 'Für diesen Account kennt Nexa noch keine Zahlen; ein Lauf würde nicht starten.' }
  }
  return { tone: 'warn', icon: CircleAlertIcon, text: `Gerade nicht: ${check.reason}.` }
})

function rangeLabel(kind: UsageWindowKind): string {
  const [min, max] = draft.value.ranges[kind]
  return min === 0 && max === 100 ? 'beliebig' : describeRange({ min, max })
}

/** Whether the account's usage of a kind lies in its range now. */
function inRange(kind: UsageWindowKind): boolean {
  const percent = current.value[kind]
  const [min, max] = draft.value.ranges[kind]
  return percent === undefined || (percent >= min && percent <= max)
}

function setRange(kind: UsageWindowKind, value: number[] | undefined): void {
  if (value && value.length === 2) draft.value.ranges[kind] = [value[0]!, value[1]!]
}

/** A number typed into a field: whole, within 0–100 and not past the other end. */
function setEnd(kind: UsageWindowKind, end: 0 | 1, raw: string | number): void {
  const value = Math.round(Number(raw))
  if (!Number.isFinite(value)) return
  const [min, max] = draft.value.ranges[kind]
  draft.value.ranges[kind] = end === 0 ? [Math.max(0, Math.min(value, max)), max] : [min, Math.min(100, Math.max(value, min))]
}

/**
 * Where a value sits over the track, as reka-ui places its thumbs: kept inside the track by up to half
 * a thumb (12 px) at the ends, so the mark of the current usage lines up with a thumb at the same value.
 */
function markLeft(percent: number): string {
  return `calc(${percent}% + ${6 - percent * 0.12}px)`
}

const markClass = { low: 'bg-usage-low', medium: 'bg-usage-medium', high: 'bg-usage-high' } as const
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2.5">
    <label class="flex items-center gap-2.5 text-muted-foreground">
      <Switch v-model="draft.on" :disabled="disabled" />
      {{ draft.on ? 'Nur bei passendem Verbrauch des Accounts' : 'Läuft unabhängig vom Verbrauch' }}
    </label>

    <template v-if="draft.on">
      <div class="flex flex-col divide-y rounded-xl border">
        <div v-for="kind in USAGE_WINDOW_KINDS" :key="kind" class="flex flex-col gap-2 px-4 py-3">
          <div class="flex items-baseline gap-3">
            <span class="font-medium">{{ USAGE_WINDOW_LABELS[kind] }}</span>
            <span class="flex-1 text-xs text-muted-foreground">{{ rangeLabel(kind) }}</span>
            <span
              v-if="current[kind] !== undefined"
              :class="cn('text-xs tabular-nums', inRange(kind) ? 'text-muted-foreground' : 'text-warning')"
              v-tooltip="'Der Verbrauch des Accounts gerade; es zählt das vollste Fenster dieser Art.'"
            >
              jetzt {{ current[kind] }} %
            </span>
          </div>
          <div class="flex items-center gap-3">
            <Input
              :model-value="draft.ranges[kind][0]"
              type="number"
              min="0"
              :max="draft.ranges[kind][1]"
              class="h-7 w-16 text-right tabular-nums"
              :aria-label="`${USAGE_WINDOW_LABELS[kind]}: läuft ab Prozent`"
              :disabled="disabled"
              @change="(e: Event) => setEnd(kind, 0, (e.target as HTMLInputElement).value)"
            />
            <div class="relative flex-1">
              <Slider
                :model-value="draft.ranges[kind]"
                :min="0"
                :max="100"
                :step="1"
                :min-steps-between-thumbs="0"
                :disabled="disabled"
                :thumb-attrs="{ 'aria-label': `${USAGE_WINDOW_LABELS[kind]}, Bereich in Prozent` }"
                @update:model-value="(v) => setRange(kind, v)"
              />
              <span
                v-if="current[kind] !== undefined"
                aria-hidden="true"
                :class="cn('pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full', markClass[usageLevel(current[kind]!)])"
                :style="{ left: markLeft(current[kind]!) }"
              />
            </div>
            <Input
              :model-value="draft.ranges[kind][1]"
              type="number"
              :min="draft.ranges[kind][0]"
              max="100"
              class="h-7 w-16 text-right tabular-nums"
              :aria-label="`${USAGE_WINDOW_LABELS[kind]}: läuft bis Prozent`"
              :disabled="disabled"
              @change="(e: Event) => setEnd(kind, 1, (e.target as HTMLInputElement).value)"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="font-medium">Passt es nicht</span>
            <span class="text-xs text-muted-foreground">
              {{
                draft.otherwise === 'wait'
                  ? 'Der Lauf startet, sobald es passt; passt es bis zum nächsten Lauf nicht, fällt er aus.'
                  : 'Der Lauf fällt aus und steht als übersprungen in der Liste.'
              }}
            </span>
          </div>
          <SegmentedControl v-model="draft.otherwise" :options="OTHERWISE" size="sm" :disabled="disabled" />
        </div>

        <label class="flex cursor-pointer items-center gap-4 px-4 py-3">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="font-medium">Ohne Zahlen trotzdem starten</span>
            <span class="text-xs text-muted-foreground">Wenn Nexa die Limits des Accounts nicht kennt, etwa bei einem Token-Login.</span>
          </div>
          <Switch v-model="draft.runWithoutNumbers" :disabled="disabled" />
        </label>
      </div>

      <p
        :class="
          cn(
            'flex items-start gap-1.5 text-xs',
            status.tone === 'ok' ? 'text-usage-low' : status.tone === 'warn' ? 'text-warning' : 'text-muted-foreground',
          )
        "
      >
        <component :is="status.icon" class="mt-px size-3.5 shrink-0" />
        <span>
          {{ status.text }}
          <span class="text-muted-foreground">{{ manual ? 'Die Limits gelten für Läufe nach Zeitplan, „Jetzt ausführen“ startet immer.' : '„Jetzt ausführen“ startet immer.' }}</span>
        </span>
      </p>
    </template>
  </div>
</template>
