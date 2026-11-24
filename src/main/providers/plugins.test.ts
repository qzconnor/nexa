import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAuthStart, claudeManifest, claudePlugins, claudePluginToggleError, codexAuthStart, codexPlugins, pluginIdParts } from './plugins'

const project = resolve('/work/app')
const other = resolve('/work/other')

describe('claudePlugins', () => {
  it('takes the installations for the folder, the most specific one of each plugin', () => {
    const raw = [
      { id: 'windbg@mcp-windbg', version: '1.6.0', scope: 'user', enabled: true, installPath: '/cache/windbg/1.6.0' },
      { id: 'windbg@mcp-windbg', version: '1.6.0', scope: 'project', projectPath: other, enabled: true },
      { id: 'windbg@mcp-windbg', version: '1.7.0', scope: 'local', projectPath: project, enabled: false, installPath: '/cache/windbg/1.7.0' },
      { id: 'demo@skills-dir', version: '0.1.0', scope: 'user', enabled: true },
      { id: 'elsewhere@market', scope: 'project', projectPath: other, enabled: true },
      { version: '1' },
    ]
    expect(claudePlugins(raw, project)).toEqual([
      { id: 'windbg@mcp-windbg', name: 'windbg', marketplace: 'mcp-windbg', version: '1.7.0', scope: 'local', enabled: false, installPath: '/cache/windbg/1.7.0' },
      { id: 'demo@skills-dir', name: 'demo', marketplace: 'skills-dir', version: '0.1.0', scope: 'user', enabled: true, installPath: undefined },
    ])
  })

  it('is empty for anything but a list', () => {
    expect(claudePlugins(null, project)).toEqual([])
    expect(claudePlugins({ id: 'x@y' }, project)).toEqual([])
  })
})

describe('claudeManifest', () => {
  it('reads name, description and version', () => {
    expect(claudeManifest({ name: 'windbg', description: ' Debug dumps ', version: '1.0', author: {} })).toEqual({
      name: 'windbg',
      description: 'Debug dumps',
      version: '1.0',
    })
    expect(claudeManifest('nope')).toEqual({})
  })
})

describe('claudePluginToggleError', () => {
  it('is null for an ok and names what went wrong otherwise', () => {
    expect(claudePluginToggleError('{"command":"disable","outcome":"ok","message":"Successfully disabled plugin: demo"}\n')).toBeNull()
    expect(claudePluginToggleError('note\n{"command":"enable","outcome":"error","message":"Plugin not found"}')).toBe('Plugin not found')
    expect(claudePluginToggleError('')).toBe('Claude Code hat nicht geantwortet.')
  })
})

describe('pluginIdParts', () => {
  it('splits at the last @', () => {
    expect(pluginIdParts('a@b')).toEqual({ name: 'a', marketplace: 'b' })
    expect(pluginIdParts('@scope/pkg@market')).toEqual({ name: '@scope/pkg', marketplace: 'market' })
    expect(pluginIdParts('plain')).toEqual({ name: 'plain' })
  })
})

describe('codexPlugins', () => {
  it('lists the installed plugins of every marketplace', () => {
    const raw = {
      marketplaces: [
        {
          name: 'openai-curated-remote',
          interface: { displayName: 'OpenAI Curated Remote' },
          plugins: [
            {
              id: 'github@openai-curated-remote',
              name: 'github',
              version: '0.1.13',
              localVersion: null,
              installed: true,
              enabled: true,
              availability: 'AVAILABLE',
              interface: { displayName: 'GitHub', shortDescription: 'Triage PRs, issues, CI' },
            },
            { id: 'gmail@openai-curated-remote', name: 'gmail', installed: false, enabled: false },
            { id: 'locked@openai-curated-remote', name: 'locked', installed: true, enabled: true, availability: 'DISABLED_BY_ADMIN' },
          ],
        },
        {
          name: 'local-test',
          interface: null,
          plugins: [{ id: 'demo@local-test', name: 'demo', localVersion: '0.1.0', installed: true, enabled: false, interface: { displayName: null, longDescription: 'A probe' } }],
        },
      ],
    }
    expect(codexPlugins(raw)).toEqual([
      { id: 'github@openai-curated-remote', name: 'GitHub', description: 'Triage PRs, issues, CI', version: '0.1.13', marketplace: 'OpenAI Curated Remote', enabled: true, locked: undefined },
      {
        id: 'locked@openai-curated-remote',
        name: 'locked',
        description: undefined,
        version: undefined,
        marketplace: 'OpenAI Curated Remote',
        enabled: false,
        locked: 'Von der Organisation abgeschaltet',
      },
      { id: 'demo@local-test', name: 'demo', description: 'A probe', version: '0.1.0', marketplace: 'local-test', enabled: false, locked: undefined },
    ])
  })

  it('is empty without marketplaces', () => {
    expect(codexPlugins({})).toEqual([])
  })
})

describe('auth starts', () => {
  it('reads Claude Code’s answer to mcp_authenticate', () => {
    expect(claudeAuthStart({ authUrl: 'https://claude.ai/x', requiresUserAction: true, callbackExpected: false })).toEqual({ url: 'https://claude.ai/x', waits: false })
    expect(claudeAuthStart({ authUrl: 'https://idp/x', requiresUserAction: true, callbackExpected: true, callbackPort: 1234 })).toEqual({ url: 'https://idp/x', waits: true })
    expect(claudeAuthStart({ requiresUserAction: false, callbackExpected: false })).toBeNull()
  })

  it('reads Codex’s answer to mcpServer/oauth/login', () => {
    expect(codexAuthStart({ authorizationUrl: 'https://idp/y', loginId: '1' })).toEqual({ url: 'https://idp/y', waits: true })
    expect(codexAuthStart({})).toBeNull()
  })
})
