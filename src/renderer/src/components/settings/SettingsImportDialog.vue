<script setup lang="ts">
import { ArrowRightIcon, PaletteIcon, ShieldAlertIcon } from '@lucide/vue'
import { computed, ref, toRaw, watch } from 'vue'
import { toast } from 'vue-sonner'
import { consistentChanges, settingsPatch, type SettingChange } from '@shared/settings-transfer'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { attempt, toastError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import {
  groupChanges,
  importSelection,
  isCommandSetting,
  settingValueText,
  skippedNames,
  themeKey,
  withAddedThemes,
  type ValueNames,
} from '@/lib/setting-changes'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useUiStore } from '@/stores/ui'

/**
 * What a settings file would change, setting by setting with the value now and the one from the file,
 * and the file's own themes this computer lacks. Everything is chosen at first except what decides
 * what runs or what the agents may do without asking.
 */
const ui = useUiStore()
const settings = useSettingsStore()
const themes = useThemesStore()
const accounts = useAccountsStore()

const preview = computed(() => ui.settingsImport)
const open = computed({
  get: () => !!preview.value,
  set: (value: boolean) => {
    if (!value) ui.settingsImport = null
  },
})
const platform = window.api.platform

const changes = computed(() => preview.value?.changes ?? [])
const fileThemes = computed(() => preview.value?.themes ?? [])
const groups = computed(() => groupChanges(changes.value, platform))
const keys = computed(() => [...changes.value.map((change) => change.path), ...fileThemes.value.map((theme) => themeKey(theme.id))])
const sensitiveCount = computed(() => changes.value.filter((change) => change.sensitive).length)

const selected = ref(new Set<string>())
const applying = ref(false)
const chosenCount = computed(() => keys.value.filter((key) => selected.value.has(key)).length)
const allChosen = computed(() => chosenCount.value === keys.value.length)

watch(
  preview,
  (next) => {
    if (!next) return
    selected.value = new Set([...next.changes.filter((change) => !change.sensitive).map((change) => change.path), ...next.themes.map((theme) => themeKey(theme.id))])
  },
  { immediate: true },
)

const source = computed(() => {
  const p = preview.value
  if (!p) return ''
  const when = p.exportedAt ? `, exportiert am ${formatDateTime(Date.parse(p.exportedAt))}` : ''
  const version = p.exportedAt && p.appVersion ? ` mit Nexa ${p.appVersion}` : ''
  return `„${p.fileName}“${when}${version}.`
})

/** A theme of the file (shown with „neu“), else one of this computer. */
const names: ValueNames = {
  theme: (id) => {
    const added = fileThemes.value.find((theme) => theme.id === id)
    if (added) return `${added.theme.name} (neu)`
    return themes.exists(id) ? themes.find(id).name : null
  },
  account: (id) => accounts.accounts.find((account) => account.id === id)?.name ?? null,
}
const text = (path: string, value: unknown) => settingValueText(path, value, names)
/** Long values (a font, a model) are cut, the tooltip has all of it. */
const full = (value: string) => (value.length > 32 ? value : null)
/** What runs, and what the agents may do, is shown whole: nothing of it may hide behind a tooltip. */
const whole = (change: SettingChange) => change.sensitive || isCommandSetting(change.path)

const skipped = computed(() => skippedNames(preview.value?.skipped ?? [], platform))

function toggle(key: string, checked: boolean): void {
  const next = new Set(selected.value)
  if (checked) next.add(key)
  else next.delete(key)
  selected.value = next
}

function toggleAll(): void {
  selected.value = allChosen.value ? new Set() : new Set(keys.value)
}

async function apply(): Promise<void> {
  const p = preview.value
  if (!p || chosenCount.value === 0 || applying.value) return
  const picked = importSelection(p, selected.value)
  // Plain objects: the patch goes over IPC.
  const fitting = consistentChanges(settings.settings, picked.changes.map((change) => toRaw(change)))
  if (!fitting) {
    toast.error('So geht es nicht', { description: 'Mindestens eine CLI muss eingeschaltet bleiben.' })
    return
  }
  applying.value = true
  const added = new Map<string, string>()
  try {
    for (const theme of picked.themes) added.set(theme.id, (await themes.create(toRaw(theme.theme))).id)
    const applied: SettingChange[] = withAddedThemes(fitting, added)
    if (applied.length) await settings.update(settingsPatch(applied))
    open.value = false
    toast.success(resultTitle(applied.length, added.size), {
      description: leftText(keys.value.length - chosenCount.value),
      action: { label: 'Rückgängig', onClick: () => void undo(applied, [...added.values()]) },
    })
  } catch (error) {
    toastError(error, 'Import fehlgeschlagen')
  } finally {
    applying.value = false
  }
}

/** The settings back as they were, and the themes added go to the recycle bin. */
async function undo(applied: SettingChange[], addedThemes: string[]): Promise<void> {
  await attempt(async () => {
    if (applied.length) await settings.update(settingsPatch(applied, 'from'))
    for (const id of addedThemes) await themes.remove(id)
  }, 'Rückgängig fehlgeschlagen')
}

function resultTitle(settingCount: number, themeCount: number): string {
  const parts = [
    settingCount === 1 ? 'Eine Einstellung' : settingCount ? `${settingCount} Einstellungen` : '',
    themeCount === 1 ? 'ein Theme' : themeCount ? `${themeCount} Themes` : '',
  ].filter(Boolean)
  return `${parts.join(' und ')} übernommen`.replace(/^./, (c) => c.toUpperCase())
}

function leftText(left: number): string | undefined {
  return left === 0 ? undefined : left === 1 ? 'Eine Änderung weggelassen' : `${left} Änderungen weggelassen`
}

const applyText = computed(() => (chosenCount.value === 1 ? '1 Änderung übernehmen' : `${chosenCount.value} Änderungen übernehmen`))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[min(85vh,48rem)] flex-col sm:max-w-3xl" data-testid="settings-import">
      <DialogHeader>
        <DialogTitle>Einstellungen importieren</DialogTitle>
        <DialogDescription>{{ source }} Übernommen wird, was ausgewählt ist, alles andere bleibt, wie es ist.</DialogDescription>
      </DialogHeader>

      <div v-if="sensitiveCount" class="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[0.85rem]">
        <ShieldAlertIcon class="mt-0.5 size-4 shrink-0 text-warning" />
        <p>
          {{ sensitiveCount === 1 ? 'Eine Änderung bestimmt' : `${sensitiveCount} Änderungen bestimmen` }}, welches Programm startet oder was die
          Agents ohne Nachfrage dürfen. {{ sensitiveCount === 1 ? 'Sie ist' : 'Sie sind' }} nicht ausgewählt: Übernimm sie nur aus
          einer Datei, der du vertraust.
        </p>
      </div>

      <div class="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">
        <section v-for="group in groups" :key="group.label" class="mb-3 last:mb-0">
          <h3 class="mb-1 px-2 text-xs font-medium text-muted-foreground">{{ group.label }}</h3>
          <ul class="flex flex-col gap-0.5">
            <li v-for="change in group.changes" :key="change.path">
              <label
                :class="
                  cn(
                    'grid cursor-pointer grid-cols-[auto_minmax(0,17rem)_minmax(0,1fr)] items-start gap-x-3 rounded-md px-2 py-1.5 text-[0.85rem] hover:bg-accent/50',
                    change.sensitive && 'bg-warning/10 hover:bg-warning/15',
                  )
                "
              >
                <Checkbox class="mt-0.5" :model-value="selected.has(change.path)" @update:model-value="toggle(change.path, $event === true)" />
                <span class="flex min-w-0 items-start gap-1.5">
                  <span class="min-w-0">{{ change.label }}</span>
                  <ShieldAlertIcon
                    v-if="change.sensitive"
                    class="mt-[3px] size-3.5 shrink-0 text-warning"
                    v-tooltip="'Bestimmt, welches Programm startet oder was die Agents ohne Nachfrage dürfen'"
                  />
                </span>
                <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-5 [overflow-wrap:anywhere]">
                  <span
                    :class="cn('text-muted-foreground line-through', isCommandSetting(change.path) && 'font-mono', !whole(change) && 'max-w-full truncate')"
                    v-tooltip="whole(change) ? null : full(text(change.path, change.from))"
                  >
                    {{ text(change.path, change.from) }}
                  </span>
                  <ArrowRightIcon class="size-3 shrink-0 text-muted-foreground" aria-label="wird zu" />
                  <span
                    :class="cn('font-medium', isCommandSetting(change.path) && 'font-mono', whole(change) ? 'whitespace-pre-wrap' : 'max-w-full truncate')"
                    v-tooltip="whole(change) ? null : full(text(change.path, change.to))"
                  >
                    {{ text(change.path, change.to) }}
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </section>

        <section v-if="fileThemes.length" class="mb-3 last:mb-0">
          <h3 class="mb-1 px-2 text-xs font-medium text-muted-foreground">Eigene Themes</h3>
          <ul class="flex flex-col gap-0.5">
            <li v-for="theme in fileThemes" :key="theme.id">
              <label class="grid cursor-pointer grid-cols-[auto_minmax(0,17rem)_minmax(0,1fr)] items-start gap-x-3 rounded-md px-2 py-1.5 text-[0.85rem] hover:bg-accent/50">
                <Checkbox
                  class="mt-0.5"
                  :model-value="selected.has(themeKey(theme.id))"
                  @update:model-value="toggle(themeKey(theme.id), $event === true)"
                />
                <span class="flex min-w-0 items-center gap-1.5">
                  <PaletteIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="min-w-0 truncate">{{ theme.theme.name }}</span>
                </span>
                <span class="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
                  <span class="flex shrink-0 overflow-hidden rounded-sm border" aria-hidden="true">
                    <span class="size-3.5" :style="{ background: theme.theme.colors.background }" />
                    <span class="size-3.5" :style="{ background: theme.theme.colors.primary }" />
                    <span class="size-3.5" :style="{ background: theme.theme.colors.foreground }" />
                  </span>
                  {{ theme.theme.mode === 'dark' ? 'Dunkel' : 'Hell' }}, kommt neu dazu
                </span>
              </label>
            </li>
          </ul>
        </section>

        <p v-if="skipped.missing.length" class="mt-3 px-2 text-xs text-muted-foreground">
          Nicht übernommen, weil es das auf diesem Computer nicht gibt: {{ skipped.missing.join(', ') }}
        </p>
        <p v-if="skipped.invalid.length" class="mt-1.5 px-2 text-xs text-muted-foreground">
          Nicht übernommen, weil der Wert ungültig ist: {{ skipped.invalid.join(', ') }}
        </p>
      </div>

      <DialogFooter class="items-center sm:justify-between">
        <Button variant="ghost" @click="toggleAll">{{ allChosen ? 'Keine auswählen' : 'Alle auswählen' }}</Button>
        <div class="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" @click="open = false">Abbrechen</Button>
          <Button :disabled="chosenCount === 0 || applying" @click="apply">{{ applyText }}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
