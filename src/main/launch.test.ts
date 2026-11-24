import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Account } from '@shared/accounts'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import { findAccount, isLaunchRequest, parseLaunchArgs, readLaunchRequest, resolveLaunch, type LaunchContext } from './launch'

const encode = (cwd: string, ...args: string[]) => `--nx=${Buffer.from([cwd, ...args].join('\0'), 'utf8').toString('base64')}`

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const CLAUDE_SESSION = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('readLaunchRequest', () => {
  it('reads folder and arguments of `nx`', () => {
    expect(readLaunchRequest(['Nexa.exe', encode('C:\\work', '-c', 'Grüße')])).toEqual({ cwd: 'C:\\work', args: ['-c', 'Grüße'] })
  })

  it('ignores a start without it', () => {
    expect(readLaunchRequest(['Nexa.exe', '--inspect'])).toBeNull()
  })
})

describe('isLaunchRequest', () => {
  it('accepts only the right shape', () => {
    expect(isLaunchRequest({ cwd: 'C:\\', args: ['-c'] })).toBe(true)
    expect(isLaunchRequest({ cwd: 'C:\\', args: [1] })).toBe(false)
    expect(isLaunchRequest(null)).toBe(false)
  })
})

describe('parseLaunchArgs', () => {
  it('reads nothing into a plain call', () => {
    expect(parseLaunchArgs([])).toEqual({
      dir: null,
      account: null,
      provider: null,
      continue: false,
      resume: null,
      newChat: false,
      prompt: null,
      passthrough: [],
    })
  })

  it('reads the options, also with =', () => {
    expect(parseLaunchArgs(['app', '-c', '--codex', '-m', 'Fix the tests', '--account=Firma'])).toMatchObject({
      dir: 'app',
      continue: true,
      provider: 'codex',
      prompt: 'Fix the tests',
      account: 'Firma',
    })
    expect(parseLaunchArgs(['-n', '-a', 'privat', '--claude'])).toMatchObject({ newChat: true, account: 'privat', provider: 'claude' })
  })

  it('takes an id after -r only when it is one', () => {
    expect(parseLaunchArgs(['-r', ID])).toMatchObject({ resume: ID, dir: null })
    expect(parseLaunchArgs(['-r', 'app'])).toMatchObject({ resume: true, dir: 'app' })
    expect(parseLaunchArgs([`--resume=${ID}`]).resume).toBe(ID)
    expect(() => parseLaunchArgs(['--resume=abc'])).toThrow(/keine gültige ID/)
  })

  it('hands everything after -- to the CLI', () => {
    expect(parseLaunchArgs(['app', '--', '--model', 'opus', '-c'])).toMatchObject({ dir: 'app', continue: false, passthrough: ['--model', 'opus', '-c'] })
  })

  it('rejects what it does not know or what contradicts itself', () => {
    expect(() => parseLaunchArgs(['--bogus'])).toThrow(/Unbekannte Option.*hinter --/)
    expect(() => parseLaunchArgs(['-m'])).toThrow(/braucht einen Prompt/)
    expect(() => parseLaunchArgs(['-a'])).toThrow(/braucht einen Account-Namen/)
    expect(() => parseLaunchArgs(['a', 'b'])).toThrow(/Nur ein Ordner/)
    expect(() => parseLaunchArgs(['-c=1'])).toThrow(/nimmt keinen Wert/)
    expect(() => parseLaunchArgs(['--claude', '--codex'])).toThrow(/schließen sich aus/)
    expect(() => parseLaunchArgs(['-c', '-r'])).toThrow(/nicht kombinieren/)
    expect(() => parseLaunchArgs(['-n', '-c'])).toThrow(/-n öffnet einen neuen Chat/)
    expect(() => parseLaunchArgs(['-c', '--', '--model', 'opus'])).toThrow(/für einen neuen Chat/)
    expect(() => parseLaunchArgs(['-r', ID, '-a', 'Firma'])).toThrow(/-r öffnet einen Chat/)
    expect(() => parseLaunchArgs(['-r', ID, 'app'])).toThrow(/keinen Ordner/)
    expect(() => parseLaunchArgs(['-r', '-m', 'weiter'])).toThrow(/nur zusammen mit einer ID/)
  })
})

const account = (id: string, provider: Account['provider'], name: string, more: Partial<Account> = {}): Account => ({
  id,
  name,
  provider,
  kind: id.startsWith('system') ? 'system' : 'oauth',
  color: '#000000',
  configDir: '',
  customConfigDir: false,
  createdAt: 0,
  secretHint: null,
  authState: 'ok',
  identity: { email: null, displayName: null, organizationName: null, organizationType: null, subscriptionType: null },
  tokenExpiresAt: null,
  loginEndsAt: null,
  tokenSavedAt: null,
  renewable: false,
  extraArgs: [],
  ...more,
})

const ACCOUNTS = [
  account('system', 'claude', 'Standard'),
  account('c-firma', 'claude', 'Firma', { identity: { email: 'me@firma.de', displayName: null, organizationName: null, organizationType: null, subscriptionType: null } }),
  account('c-privat', 'claude', 'Privat'),
  account('system-codex', 'codex', 'Standard'),
  account('x-firma', 'codex', 'Firma Codex'),
]

describe('findAccount', () => {
  const settings = defaultSettings()

  it('finds an account of either CLI by id, name, e-mail or part of the name', () => {
    expect(findAccount(ACCOUNTS, 'c-privat', settings, null).id).toBe('c-privat')
    expect(findAccount(ACCOUNTS, 'PRIVAT', settings, null).id).toBe('c-privat')
    expect(findAccount(ACCOUNTS, 'me@firma.de', settings, null).id).toBe('c-firma')
    expect(findAccount(ACCOUNTS, 'codex', settings, null).id).toBe('x-firma')
  })

  it('takes the CLI asked for, else the one new chats start with where a name fits both', () => {
    expect(findAccount(ACCOUNTS, 'firma', settings, null).id).toBe('c-firma')
    expect(findAccount(ACCOUNTS, 'firma', settings, 'codex').id).toBe('x-firma')
    expect(findAccount(ACCOUNTS, 'irm', settings, null).id).toBe('c-firma')
    expect(findAccount(ACCOUNTS, 'irm', { ...settings, defaults: { ...settings.defaults, provider: 'codex' } }, null).id).toBe('x-firma')
  })

  it('leaves out the standard accounts once others are there, and says what there is', () => {
    expect(() => findAccount(ACCOUNTS, 'standard', settings, null)).toThrow('Kein Account „standard“. Vorhanden: Firma (Claude), Privat (Claude), Firma Codex (Codex).')
    expect(() => findAccount(ACCOUNTS, 'privat', settings, 'codex')).toThrow(/Kein Codex-Account „privat“/)
  })

  it('does not guess between accounts of one CLI', () => {
    const twins = [...ACCOUNTS, account('c-firma2', 'claude', 'Firma 2')]
    expect(() => findAccount(twins, 'irm', settings, 'claude')).toThrow(/passt auf mehrere Accounts: Firma \(Claude\), Firma 2 \(Claude\)/)
  })
})

describe('resolveLaunch', () => {
  const cwd = resolve('/work/app')
  const other = resolve('/work/other')
  const projects: Project[] = [
    { id: 'p-app', name: 'app', path: cwd, createdAt: 0, updatedAt: 0 },
    { id: 'p-other', name: 'other', path: other, createdAt: 0, updatedAt: 0 },
  ]
  const chat = (id: string, more: Partial<SessionMeta> = {}): SessionMeta => ({
    id,
    projectId: 'p-app',
    title: id,
    titleSource: 'user',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'ask',
    createdAt: 0,
    updatedAt: 0,
    preview: 'Schon benutzt',
    cli: { claude: { sessionId: `${id}-cli`, seenItems: 0 } },
    ...more,
  })
  const context = (sessions: SessionMeta[], running: string[] = [], tune?: (settings: AppSettings) => void): LaunchContext => {
    const settings = defaultSettings()
    tune?.(settings)
    return { settings, accounts: ACCOUNTS, projects, sessions, running: new Set(running), home: resolve('/home/me') }
  }
  const launch = (args: string[], ctx = context([])) => resolveLaunch({ cwd, args }, ctx)

  it('opens a new chat in the folder, as before', () => {
    expect(launch([])).toEqual({ kind: 'create', dir: cwd, provider: 'claude', account: null, cliArgs: [], prompt: null })
    expect(launch(['sub', '--codex', '-m', 'Hallo'])).toMatchObject({ kind: 'create', dir: join(cwd, 'sub'), provider: 'codex', prompt: 'Hallo' })
    expect(launch(['~/x'])).toMatchObject({ dir: resolve('/home/me/x') })
  })

  it('starts with the account named, and its CLI', () => {
    expect(launch(['-a', 'Firma Codex'])).toMatchObject({ kind: 'create', provider: 'codex', account: 'x-firma' })
  })

  it('goes to a chat of the folder whose CLI runs, or that is still empty', () => {
    const sessions = [chat('newest'), chat('running'), chat('elsewhere', { projectId: 'p-other' })]
    expect(launch([], context(sessions, ['running', 'elsewhere']))).toEqual({ kind: 'open', sessionId: 'running', prompt: null })
    const empty = chat('empty', { preview: undefined, cli: {} })
    expect(launch([], context([chat('newest'), empty]))).toMatchObject({ kind: 'open', sessionId: 'empty' })
    // A chat in a folder of its own in the project counts for that folder.
    const sub = chat('sub', { cwd: join(cwd, 'sub') })
    expect(launch(['sub'], context([sub], ['sub']))).toMatchObject({ kind: 'open', sessionId: 'sub' })
    expect(launch([], context([sub], ['sub']))).toMatchObject({ kind: 'create' })
  })

  it('opens a new one when asked to, or when the open one is of another CLI or account', () => {
    const ctx = context([chat('running')], ['running'])
    for (const args of [['-n'], ['-m', 'Neue Aufgabe'], ['--', '--model', 'opus'], ['--codex'], ['-a', 'Privat']]) {
      expect(launch(args, ctx), args.join(' ')).toMatchObject({ kind: 'create' })
    }
    // Without an account of its own the chat runs with the default one, which -a may name.
    expect(launch(['-a', 'Firma'], ctx)).toMatchObject({ kind: 'open', sessionId: 'running' })
    expect(launch(['-a', 'Privat'], context([chat('running', { accounts: { claude: 'c-privat' } })], ['running']))).toMatchObject({ kind: 'open' })
    expect(launch([], context([chat('running')], ['running'], (s) => (s.general.nxReuseChat = false)))).toMatchObject({ kind: 'create' })
    // Archived chats are put away.
    expect(launch([], context([chat('running', { archived: true })], ['running']))).toMatchObject({ kind: 'create' })
  })

  it('opens the last chat of the folder with -c, of the CLI or account asked for', () => {
    const sessions = [chat('codex', { provider: 'codex' }), chat('claude'), chat('other', { projectId: 'p-other' })]
    expect(launch(['-c', '-m', 'Weiter'], context(sessions))).toEqual({ kind: 'open', sessionId: 'codex', prompt: 'Weiter' })
    expect(launch(['-c', '--claude'], context(sessions))).toMatchObject({ kind: 'open', sessionId: 'claude' })
    expect(launch(['-c', '-a', 'Privat'], context(sessions))).toMatchObject({ kind: 'create', account: 'c-privat' })
    expect(launch(['-c'], context([]))).toMatchObject({ kind: 'create' })
  })

  it('resumes a chat by its id or that of its CLI conversation, else takes the conversation over', () => {
    const sessions = [chat(ID, { projectId: 'p-other' }), chat('claude', { cli: { claude: { sessionId: CLAUDE_SESSION, seenItems: 0 } } })]
    expect(launch(['-r', ID.toUpperCase()], context(sessions))).toEqual({ kind: 'open', sessionId: ID, prompt: null })
    expect(launch(['-r', CLAUDE_SESSION, '-m', 'Weiter'], context(sessions))).toEqual({ kind: 'open', sessionId: 'claude', prompt: 'Weiter' })
    const unknown = '9b2f3c4d-0000-4000-8000-000000000000'
    expect(launch(['-r', unknown], context(sessions))).toEqual({ kind: 'takeOver', id: unknown, prompt: null })
    const cleared = chat('cleared', { earlierCli: [{ codex: { sessionId: unknown, seenItems: 0 } }] })
    expect(launch(['-r', unknown], context([cleared]))).toMatchObject({ kind: 'open', sessionId: 'cleared' })
  })

  it('offers the chats of the folder with -r alone', () => {
    expect(launch(['-r'])).toEqual({ kind: 'pick', query: 'app' })
    expect(launch(['-r', 'neu'])).toEqual({ kind: 'pick', query: 'neu' })
  })

  it('gives Codex only its config overrides', () => {
    expect(launch(['--codex', '--', '-c', 'model_reasoning_effort=high'])).toMatchObject({ kind: 'create', cliArgs: ['-c', 'model_reasoning_effort=high'] })
    expect(() => launch(['-a', 'Firma Codex', '--', '--model', 'o3'])).toThrow(/Codex nimmt hinter -- nur -c/)
  })
})
