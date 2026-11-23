import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatItem } from '@shared/chat'

/**
 * The chat of every session as JSON lines (`sessions/<id>.jsonl`): each line a state of an item, the
 * last line of an id wins and the first one fixes its place. Streaming text is written when its
 * item is finished. Rewritten without the older states when a file has many more lines than items.
 */
export class TranscriptStore {
  private readonly dir: string
  private readonly queues = new Map<string, Promise<void>>()

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'sessions')
  }

  private file(sessionId: string): string {
    return join(this.dir, `${sessionId}.jsonl`)
  }

  /** `compact`: a file with many old states is rewritten without them; only for the one that owns the chat. */
  async load(sessionId: string, { compact = true } = {}): Promise<ChatItem[]> {
    let text: string
    try {
      text = await readFile(this.file(sessionId), 'utf8')
    } catch {
      return []
    }
    const items = new Map<string, ChatItem>()
    let lines = 0
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      lines++
      try {
        const item = JSON.parse(line) as ChatItem
        if (item && typeof item.id === 'string') items.set(item.id, item)
      } catch {
        // A line cut off by a crash.
      }
    }
    const result = [...items.values()].map((item) => settle(item))
    if (compact && lines > result.length * 3 + 20) void this.rewrite(sessionId, result)
    return result
  }

  append(sessionId: string, item: ChatItem): void {
    this.enqueue(sessionId, async () => {
      await mkdir(this.dir, { recursive: true })
      await appendFile(this.file(sessionId), `${JSON.stringify(item)}\n`, 'utf8')
    })
  }

  rewrite(sessionId: string, items: ChatItem[]): Promise<void> {
    return this.enqueue(sessionId, async () => {
      await mkdir(this.dir, { recursive: true })
      await writeFile(this.file(sessionId), items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8')
    })
  }

  remove(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, () => rm(this.file(sessionId), { force: true }))
  }

  private enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(task)
    this.queues.set(sessionId, next)
    void next.catch((error) => console.error('[transcript] write failed', error)).finally(() => {
      if (this.queues.get(sessionId) === next) this.queues.delete(sessionId)
    })
    return next
  }
}

/** An item saved while it ran, after the app ended in between: shown as stopped. */
function settle(item: ChatItem): ChatItem {
  switch (item.kind) {
    case 'assistant':
    case 'thinking':
      return item.streaming ? { ...item, streaming: false } : item
    case 'tool': {
      const settled = item.status === 'running' || item.status === 'pending' ? { ...item, status: 'denied' as const } : item
      // Its shell ended with the CLI's process.
      return settled.shell?.status === 'running' ? { ...settled, shell: { ...settled.shell, status: 'stopped' } } : settled
    }
    case 'agent':
      return item.status === 'running' ? { ...item, status: 'stopped' } : item
    case 'interaction':
      return item.state === 'pending' ? { ...item, state: 'cancelled' } : item
    default:
      return item
  }
}
