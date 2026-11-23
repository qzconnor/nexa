<script setup lang="ts">
import { computed } from 'vue'
import type { SessionRuntime } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { SessionMeta } from '@shared/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { effortLabel } from '@/lib/effort'
import { formatTokens } from '@/lib/format'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'

/** `/status`: what the chat runs with, as the CLI's own status shows it in the terminal. */
const props = defineProps<{ meta: SessionMeta; runtime: SessionRuntime; cwd: string | null }>()
const open = defineModel<boolean>('open', { required: true })

const accounts = useAccountsStore()
const providers = useProvidersStore()

const rows = computed(() => {
  const { meta, runtime } = props
  const provider = PROVIDERS[meta.provider]
  const version = providers.status(meta.provider)?.version
  const account = accounts.get(accounts.sessionAccount(meta))
  const who = account ? [account.name, account.identity.email].filter((part, i, all) => part && all.indexOf(part) === i).join(' · ') : null
  const models = providers.models[meta.provider] ?? []
  const model = meta.model ? (models.find((m) => m.id === meta.model)?.label ?? meta.model) : `Standard${runtime.model ? ` (${runtime.model})` : ''}`
  const context = runtime.context?.window
    ? `${formatTokens(runtime.context.used)} von ${formatTokens(runtime.context.window)} (${Math.round((runtime.context.used / runtime.context.window) * 100)} %)`
    : null
  const list: { label: string; value: string; mono?: boolean }[] = [
    { label: 'CLI', value: version ? `${provider.name} ${version}` : provider.name },
    ...(who ? [{ label: 'Account', value: who }] : []),
    { label: 'Modell', value: model },
    { label: 'Denkaufwand', value: meta.effort ? effortLabel(meta.effort) : 'Standard' },
    { label: 'Freigaben', value: PERMISSION_MODES[meta.permissionMode].label },
    ...(props.cwd ? [{ label: 'Ordner', value: props.cwd, mono: true }] : []),
    ...(meta.dirs?.length ? [{ label: 'Weitere Ordner', value: meta.dirs.join('\n'), mono: true }] : []),
    ...(context ? [{ label: 'Kontext', value: context }] : []),
    { label: 'Prozess', value: runtime.connected ? 'läuft' : 'ruht, der nächste Prompt startet ihn' },
  ]
  for (const [id, link] of Object.entries(meta.cli)) {
    list.push({ label: `Unterhaltung ${PROVIDERS[id as keyof typeof PROVIDERS].short}`, value: link.sessionId, mono: true })
  }
  return list
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Status</DialogTitle>
        <DialogDescription>{{ meta.title }}</DialogDescription>
      </DialogHeader>
      <dl class="selectable grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-[0.85rem]">
        <template v-for="row in rows" :key="row.label">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd :class="row.mono ? 'font-mono text-[0.78rem] break-all whitespace-pre-line' : ''">{{ row.value }}</dd>
        </template>
      </dl>
    </DialogContent>
  </Dialog>
</template>
