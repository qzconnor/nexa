/** How long a call waits to be picked up: the CLI reports it while (or right after) it runs. */
const KEEP_MS = 10 * 60_000
const MAX_CALLS = 50

interface Call {
  tool: string
  args: Record<string, unknown>
  at: number
}

/**
 * The arguments of the tool calls one caller sent to Nexa's MCP server, in order. An ACP agent tells
 * its client which tool it runs, but not always with what (ACP's `tool_call` needs no input): the chat takes
 * them from here to draw a chart or show where the browser went.
 */
export class McpCallLog {
  private calls: Call[] = []

  record(tool: string, args: Record<string, unknown>, now = Date.now()): void {
    this.calls = this.calls.filter((c) => now - c.at < KEEP_MS).slice(-(MAX_CALLS - 1))
    this.calls.push({ tool, args, at: now })
  }

  /** The oldest call of `tool` not taken yet; calls of one tool run one after another, so the order matches. */
  take(tool: string, now = Date.now()): Record<string, unknown> | undefined {
    const index = this.calls.findIndex((c) => c.tool === tool && now - c.at < KEEP_MS)
    if (index < 0) return undefined
    return this.calls.splice(index, 1)[0]!.args
  }
}
