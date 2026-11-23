<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { Account } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { toastError } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useSessionsStore } from '@/stores/sessions'

const props = defineProps<{ account: Account | null }>()
const open = defineModel<boolean>('open', { required: true })

const accounts = useAccountsStore()
const sessions = useSessionsStore()
const deleteFolder = ref(false)
const removing = ref(false)

watch(open, (isOpen) => isOpen && (deleteFolder.value = false))

/** Chats that run with the account: they go on with the default account of the CLI. */
const chats = computed(() => {
  const account = props.account
  return account ? sessions.metas.filter((m) => m.accounts?.[account.provider] === account.id).length : 0
})

async function remove(): Promise<void> {
  const account = props.account
  if (!account) return
  removing.value = true
  try {
    await accounts.remove(account.id, deleteFolder.value && !account.customConfigDir)
    toast.success(`Account „${account.name}“ entfernt`)
    open.value = false
  } catch (error) {
    toastError(error, 'Entfernen fehlgeschlagen')
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent v-if="account">
      <AlertDialogHeader>
        <AlertDialogTitle>„{{ account.name }}“ entfernen?</AlertDialogTitle>
        <AlertDialogDescription>
          Der Account verschwindet aus Nexa, ein gespeicherter Token wird gelöscht.
          <template v-if="chats">
            {{ chats === 1 ? 'Ein Chat nutzt ihn und läuft' : `${chats} Chats nutzen ihn und laufen` }} mit dem Vorgabe-Account von
            {{ PROVIDERS[account.provider].name }} weiter.
          </template>
          <template v-if="account.customConfigDir"> Der Konfigurationsordner bleibt, wie er ist.</template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Field v-if="!account.customConfigDir" orientation="horizontal">
        <Checkbox id="remove-config-dir" v-model="deleteFolder" />
        <FieldContent class="min-w-0">
          <FieldLabel for="remove-config-dir">Profilordner endgültig löschen</FieldLabel>
          <FieldDescription>
            Mit Anmeldung, Einstellungen und den Unterhaltungen der CLI. Er wird sofort gelöscht, nicht in den Papierkorb verschoben.
          </FieldDescription>
          <span class="block font-mono text-xs break-all text-muted-foreground select-text">{{ account.configDir }}</span>
        </FieldContent>
      </Field>
      <AlertDialogFooter>
        <Button variant="outline" :disabled="removing" @click="open = false">Abbrechen</Button>
        <Button variant="destructive" :disabled="removing" @click="remove">
          <Spinner v-if="removing" data-icon="inline-start" />
          {{ deleteFolder && !account.customConfigDir ? 'Entfernen und Ordner löschen' : 'Entfernen' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
