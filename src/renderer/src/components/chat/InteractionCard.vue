<script setup lang="ts">
import { CheckIcon, CircleHelpIcon, MapIcon, PlugIcon, ShieldQuestionIcon, XIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { InteractionItem, InteractionResponse, PermissionMode } from '@shared/chat'
import { PERMISSION_MODES } from '@shared/providers'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useProjectPath } from '@/composables/useProjectPath'
import { useSessionsStore } from '@/stores/sessions'
import DiffView from './DiffView.vue'
import ElicitationForm from './ElicitationForm.vue'
import Markdown from './Markdown.vue'
import QuestionForm from './QuestionForm.vue'

/**
 * A question of the agent, answered right here: a permission for a tool, questions with options,
 * a plan to approve, or a form of an MCP server. Once answered it shrinks to what was decided.
 */
const props = defineProps<{ item: InteractionItem; sessionId: string }>()
const sessions = useSessionsStore()
const { shorten } = useProjectPath()
const busy = ref(false)
const denyText = ref('')
const showDeny = ref(false)
const feedback = ref('')
const planMode = ref<PermissionMode>('edits')

const pending = computed(() => props.item.state === 'pending')
const request = computed(() => props.item.request)

async function answer(response: InteractionResponse): Promise<void> {
  busy.value = true
  await attempt(() => sessions.respond(props.sessionId, props.item.id, response), 'Antwort ging nicht durch')
  busy.value = false
}

const summary = computed(() => {
  const r = props.item.response
  if (props.item.state === 'cancelled') return 'Nicht mehr beantwortet'
  if (!r) return ''
  switch (r.type) {
    case 'permission':
      return r.decision === 'deny' ? `Abgelehnt${r.message ? `: ${r.message}` : ''}` : r.decision === 'allow-session' ? 'Für diese Session erlaubt' : 'Erlaubt'
    case 'question':
      return 'Beantwortet'
    case 'plan':
      return r.approve ? `Plan angenommen${r.mode ? ` · ${PERMISSION_MODES[r.mode].label}` : ''}` : 'Plan abgelehnt'
    case 'elicitation':
      return r.action === 'accept' ? 'Gesendet' : 'Abgelehnt'
  }
  return ''
})

/**
 * The answered questions one below the other, each with its answer in full: free answers run long,
 * and in one line after the heading they got cut off.
 */
const answered = computed(() => {
  const r = props.item.response
  if (request.value.type !== 'question' || r?.type !== 'question') return []
  return request.value.questions.map((q) => ({ q, answer: q.secret ? '••••' : (r.answers[q.id] ?? []).join(', ') }))
})

const icon = computed(() => ({ permission: ShieldQuestionIcon, question: CircleHelpIcon, plan: MapIcon, elicitation: PlugIcon })[request.value.type])
const heading = computed(() => {
  const r = request.value
  switch (r.type) {
    case 'permission':
      return r.title
    case 'question':
      return r.questions.length === 1 ? 'Rückfrage' : `${r.questions.length} Rückfragen`
    case 'plan':
      return 'Plan zur Freigabe'
    case 'elicitation':
      return `Anfrage von ${r.server}`
  }
  return ''
})
</script>

<template>
  <div
    :class="
      cn(
        'my-2 rounded-xl border',
        pending ? 'border-primary/50 bg-card shadow-lg shadow-primary/5' : 'bg-card/40',
      )
    "
  >
    <div :class="cn('flex items-center gap-2 px-4', pending ? 'pt-3 pb-2' : 'py-2')">
      <component :is="icon" :class="cn('size-4 shrink-0', pending ? 'text-primary' : 'text-muted-foreground')" />
      <span :class="cn('min-w-0 truncate text-[0.88rem] font-medium', !pending && 'text-muted-foreground')">{{ heading }}</span>
      <span v-if="!pending" class="ml-auto flex min-w-0 items-center gap-1.5 text-[0.8rem] text-muted-foreground">
        <CheckIcon v-if="item.state === 'answered'" class="size-3.5 shrink-0" />
        <XIcon v-else class="size-3.5 shrink-0" />
        <span class="truncate">{{ summary }}</span>
      </span>
    </div>
    <ol v-if="answered.length" class="flex flex-col gap-2.5 px-4 pt-0.5 pb-3">
      <li v-for="{ q, answer } in answered" :key="q.id" class="flex min-w-0 flex-col gap-0.5">
        <p class="flex min-w-0 items-baseline gap-2 text-[0.78rem] text-muted-foreground">
          <span v-if="q.header" class="shrink-0 rounded bg-muted px-1.5 py-px text-[0.68rem] font-medium">{{ q.header }}</span>
          <span class="line-clamp-2" :title="q.question">{{ q.question }}</span>
        </p>
        <p class="selectable text-[0.85rem] break-words whitespace-pre-wrap">{{ answer || '–' }}</p>
      </li>
    </ol>

    <div v-if="pending" class="flex flex-col gap-3 px-4 pb-4">
      <!-- Permission for a tool -->
      <template v-if="request.type === 'permission'">
        <p v-if="request.description" class="text-[0.85rem] text-muted-foreground">{{ shorten(request.description) }}</p>
        <pre
          v-if="request.detail && !request.changes?.length"
          class="selectable max-h-48 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.8rem] whitespace-pre-wrap text-(--code-fg)"
          >{{ shorten(request.detail) }}</pre
        >
        <DiffView v-for="change in request.changes ?? []" :key="change.path" :change="change" max-height="18rem" />
        <p v-if="request.reason" class="text-[0.8rem] text-muted-foreground">{{ request.reason }}</p>
        <div v-if="showDeny" class="flex flex-col gap-2">
          <Textarea v-model="denyText" placeholder="Was soll der Agent stattdessen tun? (optional)" class="min-h-16 text-sm" />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <template v-for="option in request.options" :key="option.id">
            <Button
              v-if="option.id !== 'deny'"
              :variant="option.id === 'allow' ? 'default' : 'outline'"
              size="sm"
              :disabled="busy"
              @click="answer({ type: 'permission', decision: option.id })"
            >
              {{ option.label }}
            </Button>
          </template>
          <Button
            variant="ghost"
            size="sm"
            class="text-destructive"
            :disabled="busy"
            @click="showDeny && denyText.trim() ? answer({ type: 'permission', decision: 'deny', message: denyText.trim() }) : showDeny ? answer({ type: 'permission', decision: 'deny' }) : (showDeny = true)"
          >
            {{ showDeny ? 'Ablehnen' : 'Ablehnen …' }}
          </Button>
        </div>
      </template>

      <!-- Questions with options -->
      <QuestionForm
        v-else-if="request.type === 'question'"
        :questions="request.questions"
        :busy="busy"
        @submit="(answers) => answer({ type: 'question', answers })"
      />

      <!-- A plan to approve -->
      <template v-else-if="request.type === 'plan'">
        <div class="max-h-[50vh] overflow-auto rounded-lg border bg-background/40 px-4 py-3 text-[0.9rem]">
          <Markdown :text="request.plan" />
        </div>
        <Textarea v-model="feedback" placeholder="Änderungswünsche am Plan (zum Überarbeiten)" class="min-h-14 text-sm" />
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" :disabled="busy" @click="answer({ type: 'plan', approve: true, mode: planMode })">Plan annehmen</Button>
          <Select v-model="planMode">
            <SelectTrigger size="sm" class="bg-background/60 text-[0.8rem]" aria-label="Danach arbeiten mit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="mode in (['edits', 'ask', 'auto', 'full'] as PermissionMode[])" :key="mode" :value="mode">
                danach: {{ PERMISSION_MODES[mode].label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            :disabled="busy"
            @click="answer({ type: 'plan', approve: false, feedback: feedback.trim() || undefined })"
          >
            {{ feedback.trim() ? 'Überarbeiten lassen' : 'Ablehnen' }}
          </Button>
        </div>
      </template>

      <!-- A form or link of an MCP server -->
      <ElicitationForm
        v-else-if="request.type === 'elicitation'"
        :request="request"
        :busy="busy"
        @answer="(action, content) => answer({ type: 'elicitation', action, content })"
      />
    </div>
  </div>
</template>
