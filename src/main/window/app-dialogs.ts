import type { AppDialogOptions, AppDialogRequest } from '@shared/types'

/** The main window as the dialogs need it: brought to the front, it shows a request. */
export interface DialogWindow {
  show(request: AppDialogRequest): void
  /** `cb` once the window can no longer answer (closed, its page gone); returns how to stop listening. */
  onGone(cb: () => void): () => void
}

interface OpenQuestion {
  request: AppDialogRequest
  resolve: (ok: boolean) => void
  off: () => void
}

/**
 * Questions and messages of the main process (quitting while chats work, `nx` failing) in the main
 * window's own dialog, never in a native box: the window comes to the front, also from the notification
 * area, and answers over `app:dialog-answer`.
 */
export class AppDialogs {
  private next = 1
  private readonly open = new Map<number, OpenQuestion>()

  /** `window`: the main window brought to the front, a new one if there is none. */
  constructor(private readonly window: () => DialogWindow) {}

  /**
   * True for the dialog's button, false when cancelled. `unanswered`: what counts when the window goes
   * before it answers; quitting goes on then, so a window that can't answer never holds the app.
   */
  ask(options: AppDialogOptions, unanswered = false): Promise<boolean> {
    const request: AppDialogRequest = { ...options, id: this.next++ }
    const win = this.window()
    return new Promise((resolve) => {
      const off = win.onGone(() => this.settle(request.id, unanswered))
      this.open.set(request.id, { request, resolve, off })
      win.show(request)
    })
  }

  /** A message with one button; nothing waits for it. */
  tell(options: Omit<AppDialogOptions, 'kind' | 'cancelText'>): void {
    void this.ask({ ...options, kind: 'alert' })
  }

  answer(id: number, ok: boolean): void {
    this.settle(id, ok)
  }

  /**
   * What is asked and not answered yet, for a page that starts listening only now (a window still
   * loading when asked, one that reloaded): it would wait for an answer nobody can give.
   */
  pending(): AppDialogRequest[] {
    return [...this.open.values()].map((question) => question.request)
  }

  private settle(id: number, ok: boolean): void {
    const question = this.open.get(id)
    if (!question) return
    this.open.delete(id)
    question.off()
    question.resolve(ok)
  }
}
