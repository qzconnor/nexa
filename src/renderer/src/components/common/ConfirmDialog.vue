<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/ui'

/**
 * Renders the confirmation requested through `useUiStore().confirm()`.
 * Plain buttons instead of AlertDialogAction/Cancel: those close the dialog before our
 * click handler runs, which would settle the promise with `false` first.
 */
const ui = useUiStore()
const state = computed(() => ui.confirmState)

function onOpenChange(open: boolean) {
  if (!open) ui.settleConfirm(false)
}
</script>

<template>
  <AlertDialog :open="state?.open ?? false" @update:open="onOpenChange">
    <AlertDialogContent v-if="state">
      <AlertDialogHeader>
        <AlertDialogMedia v-if="state.warning" class="bg-warning/15 text-warning">
          <TriangleAlertIcon />
        </AlertDialogMedia>
        <AlertDialogTitle>{{ state.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="state.description" class="selectable whitespace-pre-line [overflow-wrap:anywhere]">
          {{ state.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <p v-if="state.code" class="selectable rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{{ state.code }}</p>
      <AlertDialogFooter>
        <Button v-if="state.kind !== 'alert'" variant="outline" @click="ui.settleConfirm(false)">
          {{ state.cancelText ?? 'Abbrechen' }}
        </Button>
        <Button :variant="state.destructive ? 'destructive' : 'default'" @click="ui.settleConfirm(true)">
          {{ state.confirmText ?? 'OK' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
