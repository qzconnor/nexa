import { describe, expect, it } from 'vitest'
import {
  changesOf,
  commandsOf,
  contentText,
  errorText,
  mcpToolOf,
  modelsOf,
  modeUpdateOf,
  parseModelList,
  permissionChoices,
  permissionMcp,
  planPathOf,
  retryNote,
  toolNameOf,
  toolView,
} from './gemini-items'

describe('toolNameOf', () => {
  it("takes the tool's name from the id of its call", () => {
    expect(toolNameOf('write_file__abc')).toBe('write_file')
    expect(toolNameOf('mcp_nexa_render_chart__1764031234-2')).toBe('mcp_nexa_render_chart')
    expect(toolNameOf('exit_plan_mode-1764031234567-0')).toBe('exit_plan_mode')
    expect(toolNameOf('odd')).toBe('odd')
  })
})

describe('mcpToolOf', () => {
  it("splits server and tool, with Nexa's own server known by name", () => {
    expect(mcpToolOf('mcp_nexa_browser_navigate')).toEqual({ server: 'nexa', tool: 'browser_navigate' })
    expect(mcpToolOf('mcp_github_create_issue')).toEqual({ server: 'github', tool: 'create_issue' })
    expect(mcpToolOf('read_file')).toBeNull()
  })
})

describe('toolView', () => {
  it("shows a file tool with its path, other tools with Gemini CLI's title", () => {
    expect(toolView('write_file', 'edit', 'WriteFile', [{ path: 'F:\\app\\hello.txt' }])).toEqual({ tool: 'write', title: 'Datei schreiben', detail: 'F:\\app\\hello.txt' })
    expect(toolView('run_shell_command', 'execute', 'npm test [in F:\\app]', [])).toEqual({ tool: 'bash', title: 'Befehl ausführen', detail: 'npm test [in F:\\app]' })
    expect(toolView('write_todos', 'other', 'Set 3 todo(s)', [])).toMatchObject({ detail: '3 Aufgaben' })
  })

  it("gives tools it doesn't know their ACP kind", () => {
    expect(toolView('codebase_investigator', 'search', 'Untersuche den Code', [])).toEqual({ tool: 'search', title: 'Untersuche den Code', detail: undefined })
    expect(toolView('my_tool', undefined, undefined, [])).toEqual({ tool: 'other', title: 'my tool', detail: undefined })
  })
})

describe('changesOf', () => {
  it('reads new, changed and deleted files from the diffs', () => {
    // As recorded from Gemini CLI 0.71.1.
    expect(changesOf([{ type: 'diff', path: 'hello.txt', oldText: '', newText: 'hi' }])).toEqual([{ path: 'hello.txt', type: 'add', oldText: '', newText: 'hi' }])
    expect(changesOf([{ type: 'diff', path: 'a.ts', oldText: 'a', newText: 'b', _meta: { kind: 'modify' } }])[0]?.type).toBe('update')
    expect(changesOf([{ type: 'diff', path: 'a.ts', oldText: 'a', newText: '', _meta: { kind: 'delete' } }])[0]?.type).toBe('delete')
    expect(changesOf([{ type: 'content', content: { type: 'text', text: 'x' } }])).toEqual([])
  })
})

describe('contentText', () => {
  it("joins the text blocks of a call's content", () => {
    expect(contentText([{ type: 'content', content: { type: 'text', text: 'a' } }, { type: 'diff', path: 'x' }, { type: 'content', content: { type: 'text', text: 'b' } }])).toBe('a\nb')
    expect(contentText([])).toBeUndefined()
  })
})

describe('errorText', () => {
  it('unwraps the JSON Gemini CLI wraps around the API error', () => {
    // The answer to a prompt with an invalid API key, as recorded.
    const message =
      '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"API key not valid. Please pass a valid API key.\\",\\n    \\"status\\": \\"INVALID_ARGUMENT\\"\\n  }\\n}\\n","code":400,"status":"Bad Request"}}'
    expect(errorText(message)).toBe('API key not valid. Please pass a valid API key.')
    expect(errorText('Session not found: x')).toBe('Session not found: x')
  })
})

describe('notes in the text', () => {
  it('knows the plan file of a plan approval', () => {
    expect(planPathOf('Requesting plan approval for: C:\\Users\\me\\.gemini\\tmp\\app\\plans\\plan.md')).toBe('C:\\Users\\me\\.gemini\\tmp\\app\\plans\\plan.md')
    expect(planPathOf('Shell')).toBeNull()
  })

  it('turns retries into a note', () => {
    expect(retryNote('[Retry 2/10] Quota exceeded for model. Retrying in 5s...')).toBe('Versuch 2 von 10: Quota exceeded for model')
    expect(retryNote('_[Stream interrupted. Retrying response...]_')).toBe('Antwort abgebrochen, neuer Versuch')
    expect(retryNote('**Planung**\nIch lese zuerst die Datei.')).toBeNull()
  })

  it('knows a change of mode reported as text', () => {
    expect(modeUpdateOf('[MODE_UPDATE] autoEdit')).toBe('autoEdit')
    expect(modeUpdateOf('Ich habe [MODE_UPDATE] plan gelesen')).toBeNull()
  })
})

describe('permissionChoices', () => {
  it('allows an MCP tool for the session, not its whole server, and never saves it for good', () => {
    const options = [
      { optionId: 'proceed_always_and_save', name: 'Allow for all future sessions', kind: 'allow_always' },
      { optionId: 'proceed_always_server', name: 'Allow all server tools for this session', kind: 'allow_always' },
      { optionId: 'proceed_always_tool', name: 'Allow tool for this session', kind: 'allow_always' },
      { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
    ]
    expect(permissionChoices(options)).toEqual({ allow: 'proceed_once', session: 'proceed_always_tool', deny: 'cancel' })
    expect(permissionChoices([{ optionId: 'proceed_once', kind: 'allow_once' }, { optionId: 'cancel', kind: 'reject_once' }])).toEqual({ allow: 'proceed_once', session: null, deny: 'cancel' })
  })

  it("reads the MCP server from Gemini CLI's meta data", () => {
    expect(permissionMcp({ _meta: { 'gemini-cli': { mcp: { server_name: 'nexa', tool_name: 'browser_click' } } } })).toEqual({ server: 'nexa', tool: 'browser_click' })
    expect(permissionMcp({})).toBeNull()
  })
})

describe('lists', () => {
  it('reads commands and models of a session', () => {
    expect(commandsOf([{ name: 'memory show', description: 'Shows the current memory contents.' }, { name: ' ' }])).toEqual([{ name: 'memory show', description: 'Shows the current memory contents.' }])
    expect(modelsOf({ availableModels: [{ modelId: 'auto', name: 'Auto', description: 'Let Gemini CLI decide' }, { modelId: 'gemini-2.5-pro', name: 'gemini-2.5-pro' }], currentModelId: 'auto' })).toEqual([
      { id: 'auto', label: 'Auto', description: 'Let Gemini CLI decide' },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', description: undefined },
    ])
  })

  it('reads the output of gemini --list-models', () => {
    const output = 'auto (Auto (Gemini 3))\n  Description: Let Gemini CLI decide\ngemini-2.5-pro (Gemini 2.5 Pro)\n'
    expect(parseModelList(output)).toEqual([
      { id: 'auto', label: 'Auto', description: 'Let Gemini CLI decide' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ])
  })
})
