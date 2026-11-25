<script setup lang="ts">
import HighlightText from '@/components/common/HighlightText.vue'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldGroup } from '@/components/ui/field'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import type { SettingsAnchor } from '@/lib/settings-index'

/**
 * A card of the settings: title, what it is about, actions in its head, the settings below.
 * `anchor`: its entry in lib/settings-index.ts; during a search only cards with hits show.
 */
defineProps<{ anchor: SettingsAnchor; title: string; description?: string }>()
const filter = useSettingsFilter()
</script>

<template>
  <Card v-if="filter.shows(anchor)" :data-setting="anchor">
    <CardHeader>
      <CardTitle><HighlightText :text="title" :terms="filter.terms.value" /></CardTitle>
      <CardDescription v-if="description"><HighlightText :text="description" :terms="filter.terms.value" /></CardDescription>
      <CardAction v-if="$slots.actions" class="flex items-center gap-1">
        <slot name="actions" />
      </CardAction>
    </CardHeader>
    <!-- A card with only actions in its head (Einstellungen übertragen) has no rows below. -->
    <CardContent v-if="$slots.default">
      <FieldGroup>
        <slot />
      </FieldGroup>
    </CardContent>
  </Card>
</template>
