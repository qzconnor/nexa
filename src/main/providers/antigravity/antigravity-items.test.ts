import { describe, expect, it } from 'vitest'
import { errorText } from '../acp/acp-connection'
import {
  appendsSystemPrompt,
  changesOf,
  commandOutput,
  commandsOf,
  isQuotaError,
  mcpToolOf,
  modelsOf,
  pathOf,
  permissionChoices,
  planOf,
  resumesSession,
  stepsOf,
  tierOf,
  toolView,
  usageOfQuota,
} from './antigravity-items'

/** `session/new` of Antigravity CLI 1.5.16, as recorded (its model list shortened). */
const CONFIG_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'gemini-4-hydrogen',
    options: [
      { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      { value: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
    ],
  },
  {
    id: 'thought_level',
    name: 'Thinking Level',
    category: 'thought_level',
    type: 'select',
    currentValue: 'high',
    options: [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' },
      { value: 'xhigh', name: 'Extra' },
    ],
  },
]
const MODELS = {
  availableModels: [
    { modelId: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)' },
    { modelId: 'gemini-4-hydrogen-xhigh', name: 'Gemini 4 Hydrogen (XHigh)' },
    { modelId: 'gemini-4-hydrogen-medium', name: 'Gemini 4 Hydrogen (Medium)' },
    { modelId: 'gemini-4-hydrogen-low', name: 'Gemini 4 Hydrogen (Low)' },
    { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
    { modelId: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    { modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  ],
  currentModelId: 'gemini-4-hydrogen-high',
}

describe('modelsOf', () => {
  it('names each model once, its levels of thought as efforts, the current level as its default', () => {
    expect(modelsOf(CONFIG_OPTIONS, MODELS)).toEqual([
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', isDefault: false, efforts: ['low', 'medium', 'high'] },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)', isDefault: false },
    ])
  })

  it('has none without config options', () => {
    expect(modelsOf(undefined, MODELS)).toEqual([])
  })
})

describe('initialize and session/new', () => {
  it('reads what the agent can do and the plan of the login', () => {
    const capabilities = {
      loadSession: true,
      sessionCapabilities: { resume: {}, close: {}, load: {}, list: {}, additionalDirectories: {} },
      _meta: { antigravity: { tier: true, systemPrompt: { append: true } } },
    }
    expect(appendsSystemPrompt(capabilities)).toBe(true)
    expect(resumesSession(capabilities)).toBe(true)
    expect(appendsSystemPrompt({ loadSession: true })).toBe(false)
    expect(resumesSession({ loadSession: true })).toBe(false)
    expect(tierOf({ antigravity: { tier: { name: 'Antigravity Starter Quota', id: 'free-tier' } } })).toBe('Antigravity Starter Quota')
    expect(tierOf(undefined)).toBeUndefined()
  })
})

describe('tools', () => {
  it('shows a file tool with its path, a command with its command line', () => {
    expect(toolView('read_file', { Path: 'F:\\p\\notiz.txt' }, 'read', 'File notiz.txt', [{ path: 'F:\\p\\notiz.txt' }])).toEqual({ tool: 'read', title: 'Datei lesen', detail: 'F:\\p\\notiz.txt' })
    expect(toolView('run_command', { CommandLine: 'echo fertig', WaitMsBeforeAsync: 5000 }, 'execute', 'echo fertig', undefined)).toEqual({ tool: 'bash', title: 'Befehl ausführen', detail: 'echo fertig' })
    expect(toolView('browser_open', {}, 'fetch', 'Open page', [{ path: '/F:/p/x.html' }])).toEqual({ tool: 'web', title: 'Open page', detail: 'F:/p/x.html' })
  })

  it('takes paths as Antigravity writes them on Windows', () => {
    expect(pathOf('/F:/scratch/proj/hallo.txt')).toBe('F:/scratch/proj/hallo.txt')
    expect(pathOf('file:///F:/scratch/proj/a%20b.txt')).toBe('F:/scratch/proj/a b.txt')
    expect(pathOf('/home/me/x')).toBe('/home/me/x')
  })

  it('reads the changes of an edit and of a new file', () => {
    expect(changesOf([{ type: 'diff', path: '/F:/p/notiz.txt', newText: 'neu\r\n', oldText: 'alt\r\n' }])).toEqual([{ path: 'F:/p/notiz.txt', type: 'update', oldText: 'alt\r\n', newText: 'neu\r\n' }])
    expect(changesOf([{ type: 'diff', path: 'F:\\p\\hallo.txt', newText: 'hi' }])).toEqual([{ path: 'F:\\p\\hallo.txt', type: 'add', oldText: '', newText: 'hi' }])
  })

  it('takes the output of a command without what Antigravity puts before it', () => {
    const text = 'Created At: 2026-11-25T02:13:49+01:00\nCompleted At: 2026-11-25T02:13:49+01:00\nCommand exited with code 0.\n\nCommand output:\nfertig\r\n'
    expect(commandOutput(text)).toEqual({ output: 'fertig', exitCode: 0 })
    expect(commandOutput('just text')).toEqual({ output: 'just text', exitCode: undefined })
  })

  it('makes update_steps a todo list', () => {
    expect(
      stepsOf({
        steps: [
          { status: 'done', title: 'Lesen' },
          { status: 'in_progress', title: 'Ändern' },
          { status: 'pending', title: 'Prüfen' },
        ],
      }),
    ).toEqual([
      { text: 'Lesen', status: 'completed' },
      { text: 'Ändern', status: 'in_progress' },
      { text: 'Prüfen', status: 'pending' },
    ])
    expect(stepsOf({})).toBeNull()
  })

  it('finds the plan among the artifacts it asks feedback for', () => {
    const args = { Content: '# Plan\n\n1. Tun', Overwrite: true, Path: 'C:\\Users\\me\\.gemini\\antigravity-cli\\brain\\x\\implementation_plan.md', ArtifactMetadata: { RequestFeedback: true, Summary: 'Plan', UserFacing: true } }
    expect(planOf('write_file', args)).toBe('# Plan\n\n1. Tun')
    expect(planOf('write_file', { ...args, ArtifactMetadata: { RequestFeedback: false } })).toBeNull()
    expect(planOf('write_file', { Content: 'hi', Path: 'F:\\p\\hallo.txt' })).toBeNull()
  })
})

describe('mcpToolOf', () => {
  it("splits server and tool, with Nexa's own server known by name", () => {
    expect(mcpToolOf('mcp_nexa_browser_navigate')).toEqual({ server: 'nexa', tool: 'browser_navigate' })
    expect(mcpToolOf('nexa_render_callout')).toEqual({ server: 'nexa', tool: 'render_callout' })
    expect(mcpToolOf('mcp__nexa__render_chart')).toEqual({ server: 'nexa', tool: 'render_chart' })
    expect(mcpToolOf('mcp_github_create_issue')).toEqual({ server: 'github', tool: 'create_issue' })
    expect(mcpToolOf('read_file')).toBeNull()
  })
})

describe('permissionChoices', () => {
  it('takes the options Antigravity offers: allow once or deny', () => {
    expect(
      permissionChoices([
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ]),
    ).toEqual({ allow: 'allow', session: null, deny: 'deny' })
  })
})

describe('commandsOf', () => {
  it('reads the commands of available_commands_update', () => {
    expect(commandsOf([{ name: 'goal', description: 'Set a goal' }, { name: ' ' }, { nope: 1 }])).toEqual([{ name: 'goal', description: 'Set a goal' }])
  })
})

describe('errorText', () => {
  it('takes the innermost message of an error wrapped in JSON', () => {
    expect(errorText('{"error":{"message":"{\\"error\\":{\\"message\\":\\"quota\\"}}"}}')).toBe('quota')
    expect(errorText('plain')).toBe('plain')
  })
})

/** `agy -p "/usage" --output-format json` of Antigravity CLI 1.5.17, as recorded (descriptions shortened). */
const USAGE = {
  conversation_id: '',
  status: 'SUCCESS',
  response: 'Gemini Models\tWeekly Limit Remaining\t90%\t2026-12-02T01:12:40Z\n…',
  command: {
    name: 'usage',
    data: {
      description: 'Within each group, models share a weekly limit and a 5-hour limit. …',
      groups: [
        {
          name: 'Gemini Models',
          description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash',
          buckets: [
            {
              id: 'gemini-weekly',
              name: 'Weekly Limit Remaining',
              description: 'You have used some of your weekly limit, it will fully refresh in 6 days, 17 hours.',
              window: 'weekly',
              remaining_fraction: 0.9034007787704468,
              reset_time: '2026-12-02T01:12:40Z',
            },
          ],
        },
        {
          name: 'Claude and GPT models',
          description: 'Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B',
          buckets: [
            { id: '3p-weekly', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: 1, reset_time: '1970-01-01T00:00:00Z' },
            { id: '3p-5h', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 1, reset_time: '1970-01-01T00:00:00Z' },
          ],
        },
      ],
    },
  },
}

describe('usageOfQuota', () => {
  it('makes a window of each bucket, named by its group, the shorter one of a group first', () => {
    const gemini = ['Gemini 4 Hydrogen', 'Gemini 3.8 Flash']
    const thirdParty = ['Claude Sonnet 4.6', 'Claude Opus 4.6', 'GPT-OSS 120B']
    expect(usageOfQuota(USAGE)).toEqual({
      limited: false,
      windows: [
        { key: 'gemini-weekly', label: 'Gemini · Woche', usedPercent: 9.7, resetsAt: Date.parse('2026-12-02T01:12:40Z'), windowMinutes: 10080, models: gemini },
        // A bucket nobody used yet resets at the epoch: no reset to tell.
        { key: '3p-5h', label: 'Claude/GPT · 5 Stunden', usedPercent: 0, resetsAt: undefined, windowMinutes: 300, models: thirdParty },
        { key: '3p-weekly', label: 'Claude/GPT · Woche', usedPercent: 0, resetsAt: undefined, windowMinutes: 10080, models: thirdParty },
      ],
    })
  })

  it('is at the limit when a bucket is used up, and skips disabled ones', () => {
    const groups = [{ name: 'Gemini Models', buckets: [{ id: 'g', window: 'weekly', remaining_fraction: 0, reset_time: '2026-12-02T01:12:40Z' }, { id: 'off', disabled: true, remaining_fraction: 0 }] }]
    const usage = usageOfQuota({ command: { name: 'usage', data: { groups } } })
    expect(usage?.limited).toBe(true)
    expect(usage?.windows.map((w) => w.key)).toEqual(['g'])
  })

  it('is null without buckets (an API key, an error)', () => {
    expect(usageOfQuota({ status: 'ERROR' })).toBeNull()
    expect(usageOfQuota(null)).toBeNull()
  })
})

describe('isQuotaError', () => {
  it('knows the quota of the login and its credits, not the capacity of a model', () => {
    expect(isQuotaError('You have exhausted your quota on this model.')).toBe(true)
    expect(isQuotaError('Error 429, Status: RESOURCE_EXHAUSTED')).toBe(true)
    expect(isQuotaError('Your AI credits balance is too low to continue.')).toBe(true)
    expect(isQuotaError('MODEL_CAPACITY_EXHAUSTED: no capacity available for this model')).toBe(false)
    expect(isQuotaError('Error 400, Message: API key not valid.')).toBe(false)
  })
})
