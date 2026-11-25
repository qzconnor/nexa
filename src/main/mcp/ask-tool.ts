import type { FormField, FormRequest, InteractionResponse } from '@shared/chat'
import { isPlainObject } from '@shared/utils'
import type { McpTool, McpToolResult } from './mcp-protocol'

/**
 * The tool `ask_user`: a form in the chat the agent waits on, the same in every CLI. Antigravity CLI
 * has no tool for questions of its own, and Claude Code's AskUserQuestion knows only options and free
 * text. It only asks, so it comes with Nexa's MCP server whenever that is there, without asking first.
 */

const FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'path'] as const
const MAX_FIELDS = 20

export const ASK_TOOL_DEF: McpTool = {
  name: 'ask_user',
  title: 'Rückfrage',
  description:
    'Shows the user a form in the chat and waits until they fill it in or decline. Returns the values as JSON, or that the user declined. ' +
    'Use it when you need decisions or values from the user before you can go on (choices, names, numbers, paths, switches), instead of ending your turn with a question in prose. ' +
    'Ask for everything you need in one form. Field types: text, textarea, number, boolean, select and multiselect (with options), path (a file or folder the user picks).',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'What the form is about, as a short heading.' },
      description: { type: 'string', description: 'Why you ask and what the answers change; Markdown.' },
      fields: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FIELDS,
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The name of the value in the answer.' },
            label: { type: 'string' },
            type: { type: 'string', enum: [...FIELD_TYPES] },
            description: { type: 'string' },
            options: { type: 'array', items: { type: 'string' }, description: 'For select and multiselect.' },
            default: { description: 'Prefilled value: a string, number, boolean, or a list of options for multiselect.' },
            required: { type: 'boolean' },
          },
          required: ['key', 'label', 'type'],
        },
      },
      submitLabel: { type: 'string', description: 'The label of the send button, e.g. "Start".' },
    },
    required: ['title', 'fields'],
  },
  annotations: { title: 'Rückfrage', readOnlyHint: true, openWorldHint: false },
}

export const ASK_INSTRUCTIONS =
  'ask_user shows the user a form in the chat and waits for their answer; use it when you need decisions or values from the user before you can go on, rather than ending your turn with a question.'

export function isAskTool(name: string): boolean {
  return name === ASK_TOOL_DEF.name
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The form a call asks for, checked; an Error the agent reads when the arguments don't make one. */
export function formRequest(args: Record<string, unknown>): FormRequest {
  const title = text(args.title)
  if (!title) throw new Error('ask_user needs a title.')
  if (!Array.isArray(args.fields) || !args.fields.length) throw new Error('ask_user needs at least one field.')
  if (args.fields.length > MAX_FIELDS) throw new Error(`ask_user takes at most ${MAX_FIELDS} fields; split the questions.`)
  const keys = new Set<string>()
  const fields = args.fields.map((raw, n): FormField => {
    if (!isPlainObject(raw)) throw new Error(`Field ${n + 1} is not an object.`)
    const key = text(raw.key)
    if (!key) throw new Error(`Field ${n + 1} has no key.`)
    if (keys.has(key)) throw new Error(`The key "${key}" is used twice.`)
    keys.add(key)
    const type = FIELD_TYPES.find((t) => t === raw.type)
    if (!type) throw new Error(`Field "${key}" has the type ${JSON.stringify(raw.type)}; use one of ${FIELD_TYPES.join(', ')}.`)
    const options = Array.isArray(raw.options) ? [...new Set(raw.options.filter((o): o is string => typeof o === 'string' && !!o.trim()))] : []
    if ((type === 'select' || type === 'multiselect') && !options.length) throw new Error(`Field "${key}" (${type}) needs options.`)
    return {
      key,
      label: text(raw.label) ?? key,
      type,
      ...(text(raw.description) ? { description: text(raw.description) } : {}),
      ...(type === 'select' || type === 'multiselect' ? { options } : {}),
      ...defaultOf(type, raw.default, options),
      ...(raw.required === true ? { required: true } : {}),
    }
  })
  return {
    type: 'form',
    title,
    ...(text(args.description) ? { description: text(args.description) } : {}),
    fields,
    ...(text(args.submitLabel) ? { submitLabel: text(args.submitLabel) } : {}),
  }
}

/** A default that fits its field; others are dropped rather than refused. */
function defaultOf(type: FormField['type'], value: unknown, options: string[]): Pick<FormField, 'default'> {
  if (value === undefined || value === null) return {}
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean' ? { default: value } : {}
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      return Number.isFinite(n) ? { default: n } : {}
    }
    case 'select':
      return typeof value === 'string' && options.includes(value) ? { default: value } : {}
    case 'multiselect': {
      const list = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && options.includes(v))
      return list.length ? { default: list } : {}
    }
    default:
      return typeof value === 'string' || typeof value === 'number' ? { default: String(value) } : {}
  }
}

/** What the agent gets back: the values as JSON, or that the user declined or didn't answer. */
export function askResult(response: InteractionResponse | null): McpToolResult {
  if (response?.type === 'form' && response.action === 'submit') {
    return { content: [{ type: 'text', text: JSON.stringify(response.values ?? {}, null, 2) }] }
  }
  if (response?.type === 'form') return { content: [{ type: 'text', text: 'The user declined to fill in the form. Do not ask the same again; go on without it or ask in words what is missing.' }] }
  return { content: [{ type: 'text', text: 'The form was not answered: the user stopped the turn or the chat ended.' }], isError: true }
}

/** Where the form goes (Nexa's sessions, a fake in tests). */
export interface AskSource {
  /** Shows the form in chat `sessionId`; the user's answer, null when it went unanswered. */
  ask(sessionId: string, request: FormRequest, signal?: AbortSignal): Promise<InteractionResponse | null>
}

export class AskTool {
  constructor(private readonly source: AskSource) {}

  async call(caller: string | null, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolResult> {
    if (caller === null) return { content: [{ type: 'text', text: 'This connection belongs to no chat of Nexa, so there is no user to ask.' }], isError: true }
    let request: FormRequest
    try {
      request = formRequest(args)
    } catch (error) {
      return { content: [{ type: 'text', text: (error as Error).message }], isError: true }
    }
    return askResult(await this.source.ask(caller, request, signal))
  }
}
