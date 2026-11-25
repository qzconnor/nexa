import { BellRingIcon } from '@lucide/vue'
import { markRaw } from 'vue'
import { toast } from 'vue-sonner'
import type { AgentNotificationAnswer } from '@shared/notify'
import AgentNotificationBody from '@/components/notifications/AgentNotificationBody.vue'
import { useChatActions } from '@/composables/useChatActions'

/** Without buttons a notification only informs; it goes away after a while like the other toasts. */
const INFO_DURATION_MS = 10_000

/**
 * The agents' notifications (`notify`) that main shows in this window as toasts: a click on the chat
 * opens it, a button answers the agent that waits, closing tells it the user dismissed it. Once an
 * answer came from anywhere (another window, the system notification) main takes the toast away.
 */
export function useAgentNotifications(): void {
  const chat = useChatActions()
  // Each is answered once: closing it after a button, or main taking it away, says nothing more.
  const answered = new Set<string>()

  function answer(id: string, value: AgentNotificationAnswer): void {
    if (answered.has(id)) return
    answered.add(id)
    void window.api.notifications.answer(id, value).catch(() => undefined)
  }

  window.api.notifications.onAgent((note) => {
    if (answered.has(note.id)) return
    const waits = note.actions.length > 0
    toast(note.title, {
      id: note.id,
      icon: markRaw(BellRingIcon),
      description: markRaw(AgentNotificationBody),
      componentProps: {
        note,
        onAction: (action: string) => {
          answer(note.id, { kind: 'action', action })
          toast.dismiss(note.id)
        },
        onOpen: () => {
          void chat.open(note.sessionId)
          // An agent that waits keeps its buttons until the user picks one.
          if (!waits) toast.dismiss(note.id)
        },
      },
      duration: waits ? Number.POSITIVE_INFINITY : INFO_DURATION_MS,
      // Swiping it away keeps the agent waiting no longer; for one without buttons main forgets it.
      onDismiss: () => answer(note.id, { kind: 'dismissed' }),
      onAutoClose: () => answer(note.id, { kind: 'dismissed' }),
    })
  })

  window.api.notifications.onAgentDone((id) => {
    answered.add(id)
    toast.dismiss(id)
  })
}
