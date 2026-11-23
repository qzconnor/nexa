import type { ChatItem, ToolItem } from '@shared/chat'
import { toolTouches } from '@shared/file-touches'
import type { TimedTouch } from '@shared/files'
import { shellActivity } from './file-activity'
import { existingFiles, type FileTreeService } from './file-tree-service'

/** Items whose start and end were seen are forgotten after this many, the oldest first. */
const MAX_TRACKED = 2000

/**
 * Feeds the file tree with what the agents of the sessions do to files, from their tool items: a tool
 * counts once when it starts (what it reads and writes, a shell command's start) and once when it
 * ends (what a search found, what a command wrote, a commit). The Claude Manager got the same from
 * Claude Code's hooks.
 */
export class FileActivityTracker {
  /** Phase seen of each tool item, by session and item id. */
  private readonly phases = new Map<string, 'start' | 'end'>()
  private readonly windows = process.platform === 'win32'

  constructor(private readonly tree: FileTreeService) {}

  tool(sessionId: string, item: ToolItem, cwd: string): void {
    const key = `${sessionId}\0${item.id}`
    const phase = this.phases.get(key)
    // Waiting for permission: nothing happens to the files yet.
    if (item.status === 'pending' || phase === 'end') return
    const ended = item.status !== 'running'
    if (!phase) this.report(sessionId, item, cwd, 'start')
    if (ended) this.report(sessionId, item, cwd, 'end', !!phase)
    this.phases.delete(key)
    this.phases.set(key, ended ? 'end' : 'start')
    if (this.phases.size > MAX_TRACKED) for (const old of [...this.phases.keys()].slice(0, this.phases.size - MAX_TRACKED)) this.phases.delete(old)
  }

  turnEnded(sessionId: string): void {
    this.tree.endShells(sessionId)
  }

  /**
   * What the tools of a chat did to files, the oldest first: the activity of a session from before it
   * was seen live. Searches and Codex' reads only count with files that are there.
   */
  async history(items: readonly ChatItem[], cwd: string): Promise<TimedTouch[]> {
    const sure: TimedTouch[] = []
    const maybe: TimedTouch[] = []
    for (const item of items) {
      if (item.kind !== 'tool' || item.status === 'pending' || item.status === 'denied' || item.status === 'running') continue
      if (item.status === 'error' && !item.changes?.length) continue
      const at = item.endedAt ?? item.startedAt
      const found = toolTouches(item, cwd, this.windows)
      for (const touch of found.touches) sure.push({ ...touch, at })
      for (const touch of found.maybe) maybe.push({ ...touch, at })
    }
    const existing = new Set((await existingFiles(maybe)).map((touch) => touch.path))
    return [...sure, ...maybe.filter((touch) => existing.has(touch.path))].sort((a, b) => a.at - b.at)
  }

  /** `again`: the start was reported before, so a finished write lights its file up once more. */
  private report(sessionId: string, item: ToolItem, cwd: string, phase: 'start' | 'end', again = false): void {
    const shell = shellActivity(item, cwd, phase)
    if (shell) {
      // A command that was refused or failed at once wrote nothing; its end still closes it.
      this.tree.activity(sessionId, shell)
      return
    }
    if (item.status === 'denied' || (phase === 'end' && item.status === 'error' && !item.changes?.length)) return
    const { touches, maybe } = toolTouches(item, cwd, this.windows)
    // Reads and writes count at the start (the file lights up while it changes), a finished write once
    // more at the end, so it stays lit after; searches only with their hits.
    const now = phase === 'start' ? touches : touches.filter((t) => t.kind === 'write' && item.status === 'done' && again)
    const hits = phase === 'end' ? maybe : maybe.filter((t) => t.kind !== 'search')
    if (now.length || hits.length) this.tree.activity(sessionId, { touches: now, maybe: hits })
  }
}
