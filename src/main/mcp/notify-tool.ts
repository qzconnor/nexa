import {
  DEFAULT_NOTIFY_WAIT_MINUTES,
  MAX_NOTIFY_ACTION,
  MAX_NOTIFY_ACTIONS,
  MAX_NOTIFY_MESSAGE,
  MAX_NOTIFY_TITLE,
  MAX_NOTIFY_WAIT_MINUTES,
  type NotifyOutcome,
  type NotifyRequest,
} from '@shared/notify'
import type { McpTool, McpToolResult } from './mcp-protocol'

/**
 * The tool `notify`: a notification through Nexa that leads to the agent's chat, optionally with
 * buttons the agent waits on. Meant for when nobody watches (scheduled tasks, long work). It only
 * tells the user something, so it comes with Nexa's MCP server, without asking first; the user can
 * switch it off under Einstellungen › Benachrichtigungen.
 */

export const NOTIFY_TOOL_DEF: McpTool = {
  name: 'notify',
  title: 'Benachrichtigung',
  description:
    'Sends the user a notification through Nexa: a system notification while Nexa is in the background, else a toast in the app. A click on it opens this chat. ' +
    'Use it when the user is likely not watching and should hear of something: long work is done, a scheduled task found something, a decision is needed. Do not use it for every step or for things you say in the chat anyway. ' +
    `With actions (up to ${MAX_NOTIFY_ACTIONS} short button labels) the call waits until the user picks one, dismisses the notification or the wait runs out, and returns what happened; without actions it returns at once.`,
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: `What it is about, short (at most ${MAX_NOTIFY_TITLE} characters).` },
      message: { type: 'string', description: `One or two sentences; plain text, no Markdown (at most ${MAX_NOTIFY_MESSAGE} characters).` },
      actions: {
        type: 'array',
        maxItems: MAX_NOTIFY_ACTIONS,
        items: { type: 'string' },
        description: 'Button labels, e.g. ["Freigeben", "Später"]. The call returns the label the user picked.',
      },
      waitMinutes: {
        type: 'number',
        description: `With actions: how long to wait for a choice, ${DEFAULT_NOTIFY_WAIT_MINUTES} minutes by default, at most ${MAX_NOTIFY_WAIT_MINUTES}.`,
      },
    },
    required: ['title'],
  },
  annotations: { title: 'Benachrichtigung', readOnlyHint: true, openWorldHint: false },
}

export const NOTIFY_INSTRUCTIONS =
  'notify sends the user a notification that opens this chat when clicked, optionally with buttons whose choice it returns; use it when the user is likely not watching and something needs them.'

export function isNotifyTool(name: string): boolean {
  return name === NOTIFY_TOOL_DEF.name
}

/** Text of a field, on one line where it has to be, cut to fit. */
function text(value: unknown, max: number, oneLine = true): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = (oneLine ? value.replace(/\s+/g, ' ') : value.replace(/[ \t]+/g, ' ')).trim()
  if (!trimmed) return undefined
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed
}

/** The notification a call asks for, checked; an Error the agent reads when the arguments don't make one. */
export function notifyRequest(args: Record<string, unknown>): NotifyRequest {
  const title = text(args.title, MAX_NOTIFY_TITLE)
  if (!title) throw new Error('notify needs a title.')
  const message = text(args.message, MAX_NOTIFY_MESSAGE, false)
  if (args.actions !== undefined && !Array.isArray(args.actions)) throw new Error('actions is a list of button labels.')
  const actions = [...new Set((Array.isArray(args.actions) ? args.actions : []).map((a) => text(a, MAX_NOTIFY_ACTION)).filter((a): a is string => !!a))]
  if (actions.length > MAX_NOTIFY_ACTIONS) throw new Error(`notify takes at most ${MAX_NOTIFY_ACTIONS} actions.`)
  const minutes = typeof args.waitMinutes === 'number' && Number.isFinite(args.waitMinutes) ? args.waitMinutes : DEFAULT_NOTIFY_WAIT_MINUTES
  const waitMs = Math.round(Math.min(Math.max(minutes, 0.5), MAX_NOTIFY_WAIT_MINUTES) * 60_000)
  return { title, ...(message ? { message } : {}), actions, waitMs }
}

/** What the agent learns of it. */
export function notifyResult(outcome: NotifyOutcome): McpToolResult {
  const say = (line: string, isError = false): McpToolResult => ({ content: [{ type: 'text', text: line }], ...(isError ? { isError: true } : {}) })
  switch (outcome.kind) {
    case 'shown':
      return say('The notification was shown. A click on it opens this chat.')
    case 'action':
      return say(`The user picked "${outcome.action}".`)
    case 'dismissed':
      return say('The user dismissed the notification without picking an action.')
    case 'timeout':
      return say(`Nobody picked an action within ${outcome.minutes} minutes; the notification is gone. Go on without the choice or ask again later.`)
    case 'replaced':
      return say('A newer notification of this chat took its place before the user answered.')
    case 'cancelled':
      return say('The notification was taken back: the turn was stopped or the chat ended.', true)
    case 'off':
      return say('The user switched notifications from agents off in Nexa; nothing was shown. Say it in the chat instead.')
  }
}

/** Where the notification goes (NotificationService, a fake in tests). */
export interface NotifySource {
  notify(sessionId: string, request: NotifyRequest, signal?: AbortSignal): Promise<NotifyOutcome>
}

export class NotifyTool {
  constructor(private readonly source: NotifySource) {}

  async call(caller: string | null, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    if (caller === null) return { content: [{ type: 'text', text: 'This connection belongs to no chat of Nexa, so a notification would lead nowhere.' }], isError: true }
    let request: NotifyRequest
    try {
      request = notifyRequest(args)
    } catch (error) {
      return { content: [{ type: 'text', text: (error as Error).message }], isError: true }
    }
    return notifyResult(await this.source.notify(caller, request, signal))
  }
}
