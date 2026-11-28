<script setup lang="ts">
import { ChevronRightIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { NEXA_TOOL_CATEGORIES, withToolsSwitched, type NexaToolCategory, type NexaToolCategoryId, type NexaToolGroup } from '@shared/nexa-tools'
import type { AppSettings, DeepPartial } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { useChatActions } from '@/composables/useChatActions'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import type { SettingsAnchor } from '@/lib/settings-index'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

/**
 * Nexa's MCP server, tool by tool: a card per category with the switch for all of it in its head,
 * below each tool on its own; the browser's many tools in groups that fold. Off is off for the
 * agents: the server doesn't list them, and a CLI that listed them before gets told so.
 */
const store = useSettingsStore()
const ui = useUiStore()
const filter = useSettingsFilter()
const tools = computed(() => store.settings.tools)

const chatActions = useChatActions()
/** Nexa's tools reach a CLI only at its start: the open chat's gets the offer to start anew. */
async function updateTools(patch: DeepPartial<AppSettings['tools']>): Promise<void> {
  const saved = await attempt(() => store.update({ tools: patch }).then(() => true), 'Speichern fehlgeschlagen')
  if (saved) chatActions.offerRestart()
}

/**
 * The list of switched off tools while a change of it is on its way: a second switch right after the
 * first builds on it, not on the list before both.
 */
const pending = ref<string[] | null>(null)
const disabled = computed(() => pending.value ?? tools.value.disabled)

function setTools(names: readonly string[], on: boolean): void {
  const next = withToolsSwitched(disabled.value, names, on)
  pending.value = next
  void updateTools({ disabled: next }).finally(() => {
    if (pending.value === next) pending.value = null
  })
}

const toolOn = (name: string) => !disabled.value.includes(name)
const onCount = (group: NexaToolGroup) => group.tools.filter((tool) => toolOn(tool.name)).length
const toolAnchor = (name: string) => `tools.tool.${name}` as SettingsAnchor

/** Whether the switch of the whole category is off; the app's tools have none. */
const categoryOff = (category: NexaToolCategory) => category.setting !== null && !tools.value[category.setting]

function setCategory(category: NexaToolCategory, on: boolean): void {
  if (category.setting) void updateTools({ [category.setting]: on } as Partial<Record<NonNullable<NexaToolCategory['setting']>, boolean>>)
}

/** The cards, one per category, in the catalog's order. */
const CARDS: Record<NexaToolCategoryId, { anchor: SettingsAnchor; title: string; description: string }> = {
  render: {
    anchor: 'tools.render',
    title: 'Diagramme, Charts und Tabellen',
    description: 'Die Agents zeichnen direkt in den Chat, wenn ein Bild mehr sagt als Text.',
  },
  browser: {
    anchor: 'tools.browser',
    title: 'Browser neben dem Chat',
    description:
      'Die Agents öffnen und testen Seiten im Browser rechts vom Chat, du siehst zu. Was „fragt nach“ trägt, reicht über die Seite hinaus: Davor fragt dich die CLI, je nach Freigaben des Chats.',
  },
  chat: {
    anchor: 'tools.chat',
    title: 'Nachrichten zwischen Chats',
    description:
      'Die Agents schreiben deinen anderen Chats, auch von Claude zu Codex und zurück, lesen deren Antworten, durchsuchen frühere Chats und legen neue an. Jeder Chat behält seine eigenen Freigaben. Auch die Chats gekoppelter Geräte, soweit deren Einstellung und Fernsteuerung es zulassen; Agents anderer Geräte erreichen die Chats hier nur, wenn das hier an ist.',
  },
  app: {
    anchor: 'tools.app',
    title: 'Rückfragen, Benachrichtigungen und Limits',
    description:
      'Werkzeuge der App selbst. Sie kommen mit Nexas MCP-Server, solange oben mindestens ein Werkzeug an ist. Benachrichtigungen der Agents lassen sich auch unter Benachrichtigungen › Von den Agents abschalten.',
  },
}

/** The browser's groups that are open; during a search every group with a hit is. */
const opened = ref(new Set<string>())
const groupOpen = (group: NexaToolGroup) => filter.terms.value.length > 0 || opened.value.has(group.id)
function setGroupOpen(group: NexaToolGroup, open: boolean): void {
  const next = new Set(opened.value)
  if (open) next.add(group.id)
  else next.delete(group.id)
  opened.value = next
}
/** A group shows while one of its tools matches the search. */
const groupShown = (group: NexaToolGroup) => group.tools.some((tool) => filter.shows(toolAnchor(tool.name)))

async function clearBrowserData(): Promise<void> {
  const confirmed = await ui.confirm({
    title: 'Browserdaten löschen?',
    description: 'Der Browser neben dem Chat wird überall abgemeldet: Cookies, gespeicherte Daten der Seiten und Cache gehen verloren.',
    confirmText: 'Löschen',
    destructive: true,
  })
  if (confirmed) void attempt(() => window.api.browser.clearData(), 'Browserdaten nicht gelöscht')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      anchor="tools.server"
      title="Nexas MCP-Server"
      description="Über ihn zeichnen die Agents im Chat, bedienen den Browser neben ihm und erreichen deine anderen Chats. Schalte ganze Gruppen oder einzelne Werkzeuge aus: Was aus ist, sehen die Agents nicht. Gilt für neue Chats und nach „Chat neu starten“."
    >
      <p class="text-xs text-muted-foreground">
        Eigene MCP-Server richtest du wie gewohnt in der jeweiligen CLI ein (<code class="font-mono">claude mcp add</code> bzw.
        <code class="font-mono">~/.codex/config.toml</code>) oder unter CLI-Konfiguration. Nexa startet die CLIs mit ihrer Konfiguration.
      </p>
    </SettingsSection>

    <SettingsSection
      v-for="category in NEXA_TOOL_CATEGORIES"
      :key="category.id"
      :anchor="CARDS[category.id].anchor"
      :title="CARDS[category.id].title"
      :description="CARDS[category.id].description"
    >
      <template v-if="category.setting" #actions>
        <Switch
          :model-value="tools[category.setting]"
          :aria-label="`${CARDS[category.id].title}: alle Werkzeuge`"
          @update:model-value="(on: boolean) => setCategory(category, on)"
        />
      </template>

      <template v-if="category.id === 'browser'">
        <SettingField
          anchor="tools.noClaudeInChrome"
          label="Ohne „Claude in Chrome“"
          description="Claude Code startet ohne seine Chrome-Erweiterung, damit Claude den Browser von Nexa nimmt."
        >
          <Switch
            :model-value="tools.noClaudeInChrome"
            :disabled="categoryOff(category)"
            @update:model-value="(on: boolean) => updateTools({ noClaudeInChrome: on })"
          />
        </SettingField>
        <SettingField anchor="tools.browserData" label="Browserdaten" description="Meldet den Browser überall ab: Cookies, gespeicherte Daten der Seiten und Cache.">
          <Button variant="outline" size="sm" @click="clearBrowserData">Löschen …</Button>
        </SettingField>
      </template>

      <!-- One group: its tools right in the card, whose switch is the group's. -->
      <div v-if="category.groups.length === 1" :class="cn('flex flex-col gap-3', categoryOff(category) && 'opacity-60')">
        <SettingField
          v-for="tool in category.groups[0].tools"
          :key="tool.name"
          :anchor="`tools.tool.${tool.name}`"
          :label="tool.label"
          :description="tool.description"
        >
          <Badge v-if="tool.asks" variant="outline" title="Davor fragt dich die CLI, je nach Freigaben des Chats.">fragt nach</Badge>
          <code class="font-mono text-xs text-muted-foreground">{{ tool.name }}</code>
          <Switch
            :model-value="toolOn(tool.name)"
            :disabled="categoryOff(category)"
            :aria-label="tool.label"
            @update:model-value="(on: boolean) => setTools([tool.name], on)"
          />
        </SettingField>
      </div>

      <!-- Many: a group each, folded, with a switch for all of its tools. -->
      <template v-else>
        <Collapsible
          v-for="group in category.groups"
          v-show="groupShown(group)"
          :key="group.id"
          :open="groupOpen(group)"
          :class="cn('flex flex-col rounded-lg border bg-background/40 px-3 py-2', categoryOff(category) && 'opacity-60')"
          @update:open="(open: boolean) => setGroupOpen(group, open)"
        >
          <div class="flex items-center gap-3 py-1">
            <CollapsibleTrigger as-child>
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" :aria-label="`${group.label}: Werkzeuge zeigen`">
                <ChevronRightIcon :class="cn('size-4 shrink-0 text-muted-foreground transition-transform', groupOpen(group) && 'rotate-90')" />
                <span class="flex min-w-0 flex-col">
                  <span class="text-[0.95rem] font-semibold">{{ group.label }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ group.tools.map((tool) => tool.label).join(', ') }}
                    <template v-if="onCount(group) < group.tools.length"> · {{ onCount(group) }} von {{ group.tools.length }} an</template>
                  </span>
                </span>
              </button>
            </CollapsibleTrigger>
            <!-- On while every tool of the group is: switching it sets them all. -->
            <Switch
              :model-value="onCount(group) === group.tools.length"
              :disabled="categoryOff(category)"
              :aria-label="`${group.label}: alle Werkzeuge`"
              @update:model-value="(on: boolean) => setTools(group.tools.map((tool) => tool.name), on)"
            />
          </div>
          <CollapsibleContent>
            <div class="mt-1 flex flex-col gap-3 border-t pt-3 pb-1 pl-6">
              <SettingField v-for="tool in group.tools" :key="tool.name" :anchor="`tools.tool.${tool.name}`" :label="tool.label" :description="tool.description">
                <Badge v-if="tool.asks" variant="outline" title="Davor fragt dich die CLI, je nach Freigaben des Chats.">fragt nach</Badge>
                <code class="font-mono text-xs text-muted-foreground">{{ tool.name }}</code>
                <Switch
                  :model-value="toolOn(tool.name)"
                  :disabled="categoryOff(category)"
                  :aria-label="tool.label"
                  @update:model-value="(on: boolean) => setTools([tool.name], on)"
                />
              </SettingField>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>
    </SettingsSection>
  </div>
</template>
