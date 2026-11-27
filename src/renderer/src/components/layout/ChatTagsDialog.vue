<script setup lang="ts">
import { PlusIcon, XIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { allTags, cleanTag, cleanTags, hasTag, MAX_CHAT_TAGS, MAX_TAG_LENGTH, tagKey } from '@shared/session-tags'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toastError } from '@/lib/errors'
import { useDevicesStore } from '@/stores/devices'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/**
 * A chat's tags, e.g. „Bug“ or „Release“ (as the Claude Manager's): the sidebar marks the chat, filters
 * by one, the quick open finds the chat by them. Tags other chats have are offered to take with a click.
 * Another device's chat keeps them there, as its name.
 */
const ui = useUiStore()
const devices = useDevicesStore()

const open = computed({
  get: () => ui.tagsRequest !== null,
  set: (value) => {
    if (!value) ui.tagsRequest = null
  },
})
/** Kept while the dialog closes, so its text doesn't change during the animation. */
const target = ref<{ device: string | null; id: string } | null>(null)
const title = ref('')
const tags = ref<string[]>([])
const initial = ref<string[]>([])
const draft = ref('')
const saving = ref(false)

watch(
  () => ui.tagsRequest,
  (request) => {
    if (!request) return
    const meta = useSessionsStore(request.device).get(request.id)
    target.value = { device: request.device, id: request.id }
    title.value = meta?.title ?? ''
    tags.value = [...(meta?.tags ?? [])]
    initial.value = [...tags.value]
    draft.value = ''
    saving.value = false
  },
  { immediate: true },
)

const full = computed(() => tags.value.length >= MAX_CHAT_TAGS)
/** The tags of every chat loaded here, of every device, in the spelling they have there. */
const known = computed(() =>
  allTags([null, ...devices.devices.filter((d) => d.state === 'ready').map((d) => d.id)].flatMap((device) => useSessionsStore(device).metas)),
)
/** Tags of the other chats this one hasn't got, with the text typed; those that start with it first. */
const suggestions = computed(() => {
  const typed = tagKey(cleanTag(draft.value))
  const others = known.value.filter((tag) => !hasTag(tags.value, tag) && tagKey(tag).includes(typed))
  return [...others.filter((tag) => tagKey(tag).startsWith(typed)), ...others.filter((tag) => !tagKey(tag).startsWith(typed))].slice(0, 12)
})
const changed = computed(() => tags.value.join('\n') !== initial.value.join('\n'))

/** Takes the tags in `text` (separated by commas), each in the spelling another chat has it in, unless this one has it already. */
function add(text: string): void {
  for (const part of text.split(',')) {
    const tag = cleanTag(part)
    if (!tag || full.value || hasTag(tags.value, tag)) continue
    tags.value = cleanTags([...tags.value, known.value.find((t) => tagKey(t) === tagKey(tag)) ?? tag])
  }
}

function remove(tag: string): void {
  tags.value = tags.value.filter((t) => t !== tag)
}

// A comma (typed or pasted) ends a tag: what comes before it is taken.
watch(draft, (text) => {
  const end = text.lastIndexOf(',')
  if (end === -1) return
  add(text.slice(0, end))
  draft.value = text.slice(end + 1).trimStart()
})

/** Enter takes what was typed, in an empty field it saves; Backspace in it takes the last tag away. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && draft.value.trim()) {
    event.preventDefault()
    add(draft.value)
    draft.value = ''
  } else if (event.key === 'Backspace' && !draft.value && tags.value.length) {
    event.preventDefault()
    tags.value = tags.value.slice(0, -1)
  }
}

async function save(): Promise<void> {
  const chat = target.value
  if (saving.value || !chat) return
  // Typed but not yet taken: it counts too.
  add(draft.value)
  draft.value = ''
  if (!changed.value) {
    open.value = false
    return
  }
  saving.value = true
  try {
    await useSessionsStore(chat.device).update(chat.id, { tags: [...tags.value] })
    open.value = false
  } catch (error) {
    toastError(error, 'Schlagwörter nicht gespeichert')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Schlagwörter</DialogTitle>
        <DialogDescription class="break-words">
          Für „{{ title }}“. Die Seitenleiste filtert nach ihnen, die Schnellsuche findet den Chat über sie.
        </DialogDescription>
      </DialogHeader>

      <form id="chat-tags-form" class="flex flex-col gap-4" @submit.prevent="save">
        <Field>
          <FieldLabel for="chat-tag">Schlagwörter</FieldLabel>
          <div class="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 dark:bg-input/30">
            <Badge v-for="tag in tags" :key="tag" variant="secondary" class="h-6 gap-0.5 pr-0.5 pl-2">
              {{ tag }}
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                :aria-label="`„${tag}“ entfernen`"
                @click="remove(tag)"
              >
                <XIcon class="size-3" />
              </button>
            </Badge>
            <Input
              id="chat-tag"
              v-model="draft"
              :maxlength="MAX_TAG_LENGTH + 2"
              spellcheck="false"
              autocomplete="off"
              :placeholder="full ? '' : tags.length ? 'Weiteres …' : 'z. B. Bug, Release …'"
              :disabled="saving || full"
              class="h-6 min-w-28 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
              @keydown="onKeydown"
            />
          </div>
          <FieldDescription>
            Enter oder Komma übernimmt es, die Rücktaste im leeren Feld nimmt das letzte weg. Höchstens {{ MAX_CHAT_TAGS }}.
          </FieldDescription>
        </Field>

        <div v-if="suggestions.length && !full" class="flex flex-col gap-2">
          <span class="text-xs text-muted-foreground">Von anderen Chats</span>
          <div class="flex flex-wrap gap-1.5">
            <Button v-for="tag in suggestions" :key="tag" type="button" variant="outline" size="xs" class="h-6 rounded-full font-normal" @click="add(tag)">
              <PlusIcon data-icon="inline-start" />
              {{ tag }}
            </Button>
          </div>
        </div>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="chat-tags-form" :disabled="saving">
          <Spinner v-if="saving" data-icon="inline-start" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
