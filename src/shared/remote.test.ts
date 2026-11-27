import { describe, expect, it } from 'vitest'
import type { ChatItem } from './chat'
import { FilesEvent, FilesInvoke } from './files-ipc'
import { IpcEvent, IpcInvoke } from './ipc'
import {
  applyDiff,
  channelLevel,
  diffList,
  jsonBytes,
  levelAllows,
  parseInteractionResponse,
  parseRemoteEvents,
  parseRemoteRequest,
  parseRemoteResponse,
  remoteErrorText,
  REMOTE_TEXT_LIMIT,
  remoteWindow,
  slimItem,
} from './remote'

const user = (id: string, text = 'Hallo'): ChatItem => ({ kind: 'user', id, ts: 1, provider: 'claude', text })

/** A list as the host's list events carry it, and the base of each side made of it. */
const chat = (id: string, title = `Chat ${id}`) => ({ id, title, updatedAt: 1 })
const hostBase = (list: { id: string }[]) => new Map(list.map((e) => [e.id, JSON.stringify(e)]))
const clientBase = (list: { id: string }[]) => new Map(list.map((e) => [e.id, e]))

describe('levels', () => {
  it('include the ones below them', () => {
    expect(levelAllows('full', 'prompt')).toBe(true)
    expect(levelAllows('prompt', 'read')).toBe(true)
    expect(levelAllows('read', 'prompt')).toBe(false)
    expect(levelAllows('off', 'read')).toBe(false)
  })
})

describe('channelLevel', () => {
  it('gives the level of each channel on the list', () => {
    expect(channelLevel(IpcInvoke.settingsGet, [])).toBe('read')
    expect(channelLevel(IpcInvoke.sessionsList, [])).toBe('read')
    expect(channelLevel(IpcInvoke.sessionsOpen, ['c1'])).toBe('read')
    expect(channelLevel(IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])).toBe('prompt')
    expect(channelLevel(IpcInvoke.projectsArrange, [])).toBe('prompt')
    expect(channelLevel(IpcInvoke.appSaveImage, ['aGFsbG8=', 'image/png'])).toBe('prompt')
    expect(channelLevel(IpcInvoke.settingsUpdate, [{}])).toBe('full')
    expect(channelLevel(IpcInvoke.sessionsRespond, [])).toBe('full')
    expect(channelLevel(IpcInvoke.sessionsRunShell, [])).toBe('full')
    expect(channelLevel(IpcInvoke.projectsRemove, ['p1'])).toBe('full')
  })

  it('lets the file panel read the chats’ folders and change their files only with the full level', () => {
    const read = [
      FilesInvoke.list,
      FilesInvoke.status,
      FilesInvoke.searchList,
      FilesInvoke.watch,
      FilesInvoke.diff,
      FilesInvoke.reviewBase,
      FilesInvoke.grep,
      FilesInvoke.history,
      FilesInvoke.gitBranch,
      FilesInvoke.gitWatch,
      FilesInvoke.gitWebUrl,
      FilesInvoke.gitMainWorktree,
      FilesInvoke.gitPullRequests,
    ]
    for (const ch of read) expect(channelLevel(ch, ['F:\\nexa'])).toBe('read')
    const write = [FilesInvoke.create, FilesInvoke.rename, FilesInvoke.trash, FilesInvoke.stage, FilesInvoke.unstage, FilesInvoke.discard, FilesInvoke.hunk]
    for (const ch of write) expect(channelLevel(ch, ['F:\\nexa', 'a.ts'])).toBe('full')
    // Whether a folder can get a worktree is the host's own business.
    expect(channelLevel(FilesInvoke.gitWorktreeCheck, ['F:\\nexa'])).toBeNull()
  })

  it('lets nothing else through: the host’s windows, dialogs, files and terminals stay its own', () => {
    expect(channelLevel(IpcInvoke.settingsExport, [])).toBeNull()
    expect(channelLevel(IpcInvoke.sessionsExportMarkdown, ['c1'])).toBeNull()
    expect(channelLevel(IpcInvoke.accountsLogin, [])).toBeNull()
    expect(channelLevel(IpcInvoke.projectsCreate, [])).toBeNull()
    expect(channelLevel('format:disk', ['C:'])).toBeNull()
    // Names every object has must not count as channels.
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(channelLevel(name, [])).toBeNull()
  })

  it('takes the full level to change how a chat’s agent runs, the prompt level for the rest', () => {
    const update = (patch: unknown) => channelLevel(IpcInvoke.sessionsUpdate, ['c1', patch])
    expect(update({ title: 'Neu' })).toBe('prompt')
    expect(update({ pinned: true, archived: false })).toBe('prompt')
    for (const field of ['provider', 'account', 'model', 'effort', 'ultracode', 'permissionMode', 'dirs']) {
      expect(update({ title: 'Neu', [field]: undefined })).toBe('full')
    }
    expect(update({ model: 'opus' })).toBe('full')
    // Nothing to read: nothing of the agent changes.
    expect(update(undefined)).toBe('prompt')
    expect(update(['model'])).toBe('prompt')
    expect(channelLevel(IpcInvoke.sessionsUpdate, [])).toBe('prompt')
  })

  it('takes the full level for a new chat with CLI arguments or one that doesn’t ask before it acts', () => {
    const create = (input: unknown) => channelLevel(IpcInvoke.sessionsCreate, [input])
    expect(create({ projectId: 'p1' })).toBe('prompt')
    expect(create({ projectId: 'p1', permissionMode: 'ask' })).toBe('prompt')
    expect(create({ projectId: 'p1', permissionMode: 'plan' })).toBe('prompt')
    expect(create({ projectId: 'p1', cliArgs: [] })).toBe('prompt')
    for (const mode of ['edits', 'auto', 'full', 'root']) expect(create({ projectId: 'p1', permissionMode: mode })).toBe('full')
    expect(create({ projectId: 'p1', cliArgs: ['--dangerously-skip-permissions'] })).toBe('full')
    expect(create(null)).toBe('prompt')
    expect(channelLevel(IpcInvoke.sessionsCreate, [])).toBe('prompt')
  })
})

describe('parseRemoteRequest', () => {
  it('takes the requests with their parameters', () => {
    expect(parseRemoteRequest({ m: 'hello' })).toEqual({ m: 'hello', p: {} })
    expect(parseRemoteRequest({ m: 'hello', p: { extra: 1 } })).toEqual({ m: 'hello', p: {} })
    expect(parseRemoteRequest({ m: 'unwatch', p: {} })).toEqual({ m: 'unwatch', p: {} })
    expect(parseRemoteRequest({ m: 'invoke', p: { ch: IpcInvoke.sessionsOpen, args: ['c1'] } })).toEqual({ m: 'invoke', p: { ch: 'sessions:open', args: ['c1'] } })
    expect(parseRemoteRequest({ m: 'invoke', p: { ch: FilesInvoke.searchList, args: [] } })).toEqual({ m: 'invoke', p: { ch: 'files:search-list', args: [] } })
  })

  it('takes the chats to watch once each, and `fresh` only as true', () => {
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['a', 'a', 'b'] } })).toEqual({ m: 'watch', p: { ids: ['a', 'b'] } })
    expect(parseRemoteRequest({ m: 'watch', p: { ids: [], fresh: true } })).toEqual({ m: 'watch', p: { ids: [], fresh: true } })
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['a'], fresh: 'yes' } })).toEqual({ m: 'watch', p: { ids: ['a'] } })
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['a'], fresh: false } })).toEqual({ m: 'watch', p: { ids: ['a'] } })
    expect(parseRemoteRequest({ m: 'watch', p: { ids: Array.from({ length: 32 }, (_, i) => `c${i}`) } })).not.toBeNull()
  })

  it('refuses what isn’t one', () => {
    expect(parseRemoteRequest(null)).toBeNull()
    expect(parseRemoteRequest('hello')).toBeNull()
    expect(parseRemoteRequest({ m: 1 })).toBeNull()
    // Methods of the protocol before the window API went over it.
    for (const m of ['chats', 'open', 'send', 'respond']) expect(parseRemoteRequest({ m, p: { id: 'c1' } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch' })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: 'c1' } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['../x'] } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: [7] } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['x'.repeat(129)] } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: Array.from({ length: 33 }, (_, i) => `c${i}`) } })).toBeNull()
  })

  it('refuses calls whose channel isn’t named like one, or with too many arguments', () => {
    const invoke = (ch: unknown, args: unknown = []) => parseRemoteRequest({ m: 'invoke', p: { ch, args } })
    for (const ch of ['Sessions:open', 'sessions', 'sessions:', ':open', 'sessions:open:x', '../x:y', 'sessions:open ', 'sessions:Open', '1x:y', `${'a'.repeat(33)}:y`, `x:${'a'.repeat(65)}`, 7, undefined]) {
      expect(invoke(ch)).toBeNull()
    }
    // Named like one but not on the list: the host refuses it itself (`channelLevel`), with an answer.
    expect(invoke('format:disk')).toEqual({ m: 'invoke', p: { ch: 'format:disk', args: [] } })
    expect(invoke(IpcInvoke.sessionsOpen, Array.from({ length: 8 }, () => 0))).not.toBeNull()
    expect(invoke(IpcInvoke.sessionsOpen, Array.from({ length: 9 }, () => 0))).toBeNull()
    expect(invoke(IpcInvoke.sessionsOpen, 'c1')).toBeNull()
    expect(invoke(IpcInvoke.sessionsOpen, { 0: 'c1', length: 1 })).toBeNull()
    expect(parseRemoteRequest({ m: 'invoke', p: { ch: IpcInvoke.sessionsOpen } })).toBeNull()
  })
})

describe('parseInteractionResponse', () => {
  it('checks each shape', () => {
    expect(parseInteractionResponse({ type: 'permission', decision: 'allow' })).toEqual({ type: 'permission', decision: 'allow' })
    expect(parseInteractionResponse({ type: 'permission', decision: 'deny', message: 'Nein' })).toEqual({ type: 'permission', decision: 'deny', message: 'Nein' })
    expect(parseInteractionResponse({ type: 'permission', decision: 'sure' })).toBeNull()
    expect(parseInteractionResponse({ type: 'question', answers: { Farbe: ['Blau'] } })).toEqual({ type: 'question', answers: { Farbe: ['Blau'] } })
    expect(parseInteractionResponse({ type: 'question', answers: { Farbe: 'Blau' } })).toBeNull()
    expect(parseInteractionResponse({ type: 'plan', approve: true, mode: 'auto' })).toMatchObject({ approve: true })
    expect(parseInteractionResponse({ type: 'plan', approve: true, mode: 'root' })).toBeNull()
    expect(parseInteractionResponse({ type: 'elicitation', action: 'accept', content: { a: 1 } })).toMatchObject({ action: 'accept' })
    expect(parseInteractionResponse({ type: 'elicitation', action: 'accept', content: 'a' })).toBeNull()
    expect(parseInteractionResponse({ type: 'form', action: 'submit', values: { n: 3, tags: ['a'] } })).toMatchObject({ action: 'submit' })
    expect(parseInteractionResponse({ type: 'form', action: 'submit', values: { n: { deep: 1 } } })).toBeNull()
    expect(parseInteractionResponse({ type: 'shell' })).toBeNull()
    expect(parseInteractionResponse(null)).toBeNull()
  })
})

describe('parseRemoteResponse', () => {
  it('reads results and errors; an unknown code counts as failed', () => {
    expect(parseRemoteResponse({ re: 'm1', r: null })).toEqual({ re: 'm1', r: null })
    expect(parseRemoteResponse({ re: 'm1', r: undefined })).toEqual({ re: 'm1', r: undefined })
    expect(parseRemoteResponse({ re: 'm1', e: { code: 'forbidden', message: 'x' } })).toEqual({ re: 'm1', e: { code: 'forbidden', message: 'x' } })
    expect(parseRemoteResponse({ re: 'm1', e: { code: 'weird', message: 'x' } })).toMatchObject({ e: { code: 'failed' } })
    expect(parseRemoteResponse({ re: 'm1', e: { code: 'failed' } })).toBeNull()
    expect(parseRemoteResponse({ re: 'm1' })).toBeNull()
    expect(parseRemoteResponse({ r: 1 })).toBeNull()
  })

  it('cuts a long message of the host', () => {
    const response = parseRemoteResponse({ re: 'm1', e: { code: 'failed', message: 'x'.repeat(5_000) } })
    expect(response && 'e' in response && response.e.message).toHaveLength(1000)
  })

  it('has a German text for each error', () => {
    expect(remoteErrorText({ code: 'disabled', message: '' })).toMatch(/Fernsteuerung aus/)
    expect(remoteErrorText({ code: 'busy', message: '' })).toMatch(/kommt gerade nicht hinterher/)
    expect(remoteErrorText({ code: 'too-large', message: '' })).toMatch(/zu groß/)
    expect(remoteErrorText({ code: 'failed', message: 'Das Projekt der Session gibt es nicht mehr.' })).toBe('Das Projekt der Session gibt es nicht mehr.')
  })
})

describe('parseRemoteEvents', () => {
  it('keeps the window events another device gets and drops the rest', () => {
    const session = (event: unknown) => ({ ch: IpcEvent.sessionEvent, args: [event] })
    const events = parseRemoteEvents({
      events: [
        session({ type: 'item', sessionId: 's', item: user('u1') }),
        session({ type: 'delta', sessionId: 's', itemId: 'a1', field: 'text', text: 'Hal' }),
        session({ type: 'delta', sessionId: 's', itemId: 'a1', field: 'html', text: '<b>' }),
        session({ type: 'runtime', sessionId: 's', runtime: { status: 'running', connected: true } }),
        session({ type: 'truncated', sessionId: 's', length: 3 }),
        session({ type: 'truncated', sessionId: 's', length: 1.5 }),
        session({ type: 'item', sessionId: 's', item: { id: 'x' } }),
        session({ type: 'item', item: user('u2') }),
        { ch: IpcEvent.settingsChanged, args: [{ theme: 'dark' }] },
        // The host's own windows' business, not on the list.
        { ch: IpcEvent.showSession, args: ['s'] },
        { ch: IpcEvent.windowState, args: [{}] },
        { ch: IpcEvent.settingsChanged },
        'nonsense',
        null,
      ],
    })
    expect(events).toEqual([
      session({ type: 'item', sessionId: 's', item: user('u1') }),
      session({ type: 'delta', sessionId: 's', itemId: 'a1', field: 'text', text: 'Hal' }),
      session({ type: 'runtime', sessionId: 's', runtime: { status: 'running', connected: true } }),
      session({ type: 'truncated', sessionId: 's', length: 3 }),
      { ch: IpcEvent.settingsChanged, args: [{ theme: 'dark' }] },
    ])
  })

  it('takes changes of lists, only for list events and with ids', () => {
    const diff = { ids: ['a', 'b'], changed: [chat('b')] }
    const events = parseRemoteEvents({
      events: [
        { ch: IpcEvent.sessionsChanged, diff },
        { ch: IpcEvent.projectsChanged, diff: { ids: [], changed: [] } },
        // Settings are no list.
        { ch: IpcEvent.settingsChanged, diff },
        { ch: IpcEvent.sectionsChanged, diff: { ids: [1], changed: [] } },
        { ch: IpcEvent.accountsChanged, diff: { ids: ['a'], changed: [{ name: 'ohne id' }] } },
        { ch: IpcEvent.accountsChanged, diff: { ids: ['a'], changed: 'a' } },
        { ch: IpcEvent.accountsChanged, diff: ['a'] },
      ],
    })
    expect(events).toEqual([
      { ch: IpcEvent.sessionsChanged, diff },
      { ch: IpcEvent.projectsChanged, diff: { ids: [], changed: [] } },
    ])
  })

  it('takes the file panel’s events only in the shapes it reads', () => {
    const changed = { ch: FilesEvent.changed, args: ['F:\\nexa', ['', 'src'], true, false] }
    const touched = { ch: FilesEvent.touched, args: ['s', [{ path: 'F:\\nexa\\a.ts', kind: 'write' }]] }
    const branch = { ch: FilesEvent.gitBranchChanged, args: ['F:\\nexa', { name: 'main', detached: false }] }
    const noBranch = { ch: FilesEvent.gitBranchChanged, args: ['F:\\nexa', null] }
    const events = parseRemoteEvents({
      events: [
        changed,
        touched,
        branch,
        noBranch,
        { ch: FilesEvent.changed, args: ['F:\\nexa', 'src', true, false] },
        { ch: FilesEvent.changed, args: [1, [], true, false] },
        { ch: FilesEvent.touched, args: ['s', [{ path: 1, kind: 'write' }]] },
        { ch: FilesEvent.touched, args: ['s'] },
        { ch: FilesEvent.gitBranchChanged, args: ['F:\\nexa', 'main'] },
      ],
    })
    expect(events).toEqual([changed, touched, branch, noBranch])
  })

  it('refuses what has no events at all', () => {
    expect(parseRemoteEvents(null)).toBeNull()
    expect(parseRemoteEvents({ events: 'x' })).toBeNull()
    expect(parseRemoteEvents({ events: [] })).toEqual([])
  })
})

describe('diffList and applyDiff', () => {
  it('send a whole list the first time', () => {
    const list = [chat('a'), chat('b')]
    const change = diffList(list, new Map())!
    expect(change.diff).toEqual({ ids: ['a', 'b'], changed: list })
    expect(applyDiff(change.diff, new Map())).toEqual(list)
  })

  it('send only what changed and make the list whole again: added, changed, removed, reordered', () => {
    const before = [chat('a'), chat('b'), chat('c'), chat('d')]
    // `d` goes, `b` changes, `e` comes, and `c` moves to the front.
    const after = [chat('c'), chat('a'), chat('b', 'Umbenannt'), chat('e')]
    const change = diffList(after, hostBase(before))!
    expect(change.diff).toEqual({ ids: ['c', 'a', 'b', 'e'], changed: [chat('b', 'Umbenannt'), chat('e')] })
    expect(change.next).toEqual(hostBase(after))
    expect(applyDiff(change.diff, clientBase(before))).toEqual(after)
  })

  it('send no entry for a list that stayed the same', () => {
    const list = [chat('a'), chat('b')]
    expect(diffList(list, hostBase(list))!.diff).toEqual({ ids: ['a', 'b'], changed: [] })
    expect(diffList([], hostBase(list))!.diff).toEqual({ ids: [], changed: [] })
  })

  it('make no change of what isn’t a list of entries with ids', () => {
    expect(diffList({ a: 1 }, new Map())).toBeNull()
    expect(diffList([chat('a'), { title: 'ohne id' }], new Map())).toBeNull()
    expect(diffList([{ id: 7 }], new Map())).toBeNull()
    expect(diffList(['a'], new Map())).toBeNull()
  })

  it('can’t apply a change whose base is missing on this side', () => {
    const before = [chat('a'), chat('b')]
    const change = diffList([chat('a'), chat('b'), chat('c')], hostBase(before))!
    // This side lost `b` (or never had it): the list can't be made whole.
    expect(applyDiff(change.diff, clientBase([chat('a')]))).toBeNull()
    expect(applyDiff(change.diff, new Map())).toBeNull()
  })
})

describe('jsonBytes', () => {
  it('counts UTF-8 bytes of the JSON', () => {
    expect(jsonBytes('a')).toBe(3)
    expect(jsonBytes('ä')).toBe(4)
    expect(jsonBytes('漢')).toBe(5)
    expect(jsonBytes('😀')).toBe(6)
    expect(jsonBytes(undefined)).toBe(0)
  })

  it('counts what can’t be JSON as too large', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(jsonBytes(loop)).toBe(Infinity)
    expect(jsonBytes(1n)).toBe(Infinity)
  })
})

describe('slimItem', () => {
  it('cuts long output from its start and leaves out what only works at the host', () => {
    const tool: ChatItem = {
      kind: 'tool',
      id: 't1',
      ts: 1,
      provider: 'claude',
      tool: 'bash',
      title: 'Bash',
      status: 'done',
      startedAt: 1,
      output: 'a'.repeat(REMOTE_TEXT_LIMIT) + 'ENDE',
      app: { resourceUri: 'ui://x', server: 'srv' },
    } as ChatItem
    const slim = slimItem(tool) as Extract<ChatItem, { kind: 'tool' }>
    expect(slim.output!.endsWith('ENDE')).toBe(true)
    expect(slim.output!.startsWith('… (gekürzt)\n')).toBe(true)
    expect(slim.output!.length).toBeLessThan(REMOTE_TEXT_LIMIT + 20)
    // The page's reference stays: the window fetches the page (and the result) from the device.
    expect(slim.app).toEqual({ resourceUri: 'ui://x', server: 'srv' })
    const withImage = slimItem({ ...user('u1'), images: ['C:\\bild.png'] } as ChatItem) as Extract<ChatItem, { kind: 'user' }>
    // The pictures stay as their paths there: the window fetches them with `sessions:image`.
    expect(withImage.images).toEqual(['C:\\bild.png'])
    expect(withImage.text).toBe('Hallo')
  })

  it('leaves short items as they are', () => {
    const item = user('u1')
    expect(slimItem(item)).toEqual(item)
    const other: ChatItem = { kind: 'notice', id: 'n1', ts: 1, provider: 'claude', level: 'error', text: 'x'.repeat(REMOTE_TEXT_LIMIT * 2) }
    expect(slimItem(other)).toBe(other)
  })

  it('cuts by UTF-8 bytes, so umlauts and CJK stay within the limit too', () => {
    for (const char of ['Ü', '漢', '😀']) {
      const answer = slimItem({ kind: 'assistant', id: 'a', ts: 1, provider: 'claude', text: char.repeat(50_000) }, 1024) as Extract<ChatItem, { kind: 'assistant' }>
      expect(new TextEncoder().encode(answer.text).length).toBeLessThanOrEqual(4 * 1024 + 20)
      // No half character at the cut.
      expect(answer.text).not.toContain('\uFFFD')
      expect(answer.text.startsWith(char)).toBe(true)
      expect(answer.text.endsWith('\n… (gekürzt)')).toBe(true)
    }
    const tool = slimItem({ kind: 'tool', id: 't', ts: 1, provider: 'claude', tool: 'bash', title: 'Bash', status: 'done', startedAt: 1, output: `${'ö'.repeat(5_000)}SCHLUSS` } as ChatItem, 1024)
    expect((tool as Extract<ChatItem, { kind: 'tool' }>).output!.endsWith('SCHLUSS')).toBe(true)
  })

  it('leaves out a tool’s input and rendering when they are too large', () => {
    const big = { kind: 'tool', id: 't', ts: 1, provider: 'claude', tool: 'write', title: 'Write', status: 'done', startedAt: 1, input: { content: 'x'.repeat(2_000) }, render: { rows: ['y'.repeat(2_000)] } } as unknown as ChatItem
    const slim = slimItem(big, 1024) as Extract<ChatItem, { kind: 'tool' }>
    expect(slim.input).toBeUndefined()
    expect(slim.render).toBeUndefined()
    const small = slimItem({ ...big, input: { path: 'a.ts' } } as ChatItem, 1024) as Extract<ChatItem, { kind: 'tool' }>
    expect(small.input).toEqual({ path: 'a.ts' })
  })

  it('leaves out the texts of many changed files before the changes', () => {
    const changes = Array.from({ length: 30 }, (_, i) => ({ path: `f${i}.ts`, type: 'update' as const, oldText: 'a'.repeat(900), newText: 'b'.repeat(900) }))
    const tool = slimItem({ kind: 'tool', id: 't', ts: 1, provider: 'claude', tool: 'edit', title: 'Edit', status: 'done', startedAt: 1, changes } as ChatItem, 1024) as Extract<ChatItem, { kind: 'tool' }>
    expect(tool.changes).toHaveLength(30)
    expect(tool.changes!.every((c) => c.oldText === undefined && c.path)).toBe(true)

    const huge = Array.from({ length: 30 }, (_, i) => ({ path: `f${i}.ts`, type: 'update' as const, diff: 'd'.repeat(1_000) }))
    const without = slimItem({ kind: 'tool', id: 't', ts: 1, provider: 'claude', tool: 'edit', title: 'Edit', status: 'done', startedAt: 1, changes: huge } as ChatItem, 1024) as Extract<ChatItem, { kind: 'tool' }>
    expect(without.changes).toBeUndefined()
  })

  it('cuts a subagent’s prompt and result', () => {
    const agent = { kind: 'agent', id: 'g', ts: 1, provider: 'claude', agentType: 'Explore', description: 'Suche', status: 'done', prompt: 'p'.repeat(2_000), result: 'r'.repeat(2_000) } as ChatItem
    const slim = slimItem(agent, 1024) as Extract<ChatItem, { kind: 'agent' }>
    expect(slim.prompt!.length).toBeLessThan(1024 + 20)
    expect(slim.result!.startsWith('r')).toBe(true)
    expect(slim.result!.length).toBeLessThan(1024 + 20)
  })
})

describe('remoteWindow', () => {
  const answer = (id: string, bytes: number): ChatItem => ({ kind: 'assistant', id, ts: 1, provider: 'claude', text: 'x'.repeat(bytes) })
  /** `turns` turns of a prompt and `answers` answers of about `bytes` each. */
  const chatOf = (turns: number, answers: number, bytes: number) =>
    Array.from({ length: turns }, (_, t) => [user(`u${t}`), ...Array.from({ length: answers }, (_, a) => answer(`a${t}-${a}`, bytes))]).flat()
  const ids = (items: ChatItem[]) => items.map((item) => item.id)

  it('gives a short chat whole', () => {
    const items = chatOf(3, 2, 10)
    expect(remoteWindow(items, items.length)).toEqual({ items, older: 0 })
  })

  it('gives the newest items of a long chat, beginning with a prompt, and the ones before page by page', () => {
    const items = chatOf(20, 3, 1000)
    const newest = remoteWindow(items, items.length, 10_000)
    expect(newest.items[0]!.kind).toBe('user')
    expect(jsonBytes(newest.items)).toBeLessThanOrEqual(10_000)
    expect(newest.older).toBe(items.length - newest.items.length)
    expect(ids(newest.items)).toEqual(ids(items.slice(newest.older)))

    // Page by page to the first item, each one exactly once.
    const seen = [...newest.items]
    let older = newest.older
    while (older > 0) {
      const page = remoteWindow(items, older, 10_000)
      expect(page.items[0]!.kind).toBe('user')
      expect(page.older).toBeLessThan(older)
      seen.unshift(...page.items)
      older = page.older
    }
    expect(ids(seen)).toEqual(ids(items))
  })

  it('goes back to the prompt of one long turn, but not without end', () => {
    const items = [user('u0'), ...Array.from({ length: 30 }, (_, i) => answer(`a${i}`, 1000))]
    const window = remoteWindow(items, items.length, 10_000)
    expect(window).toMatchObject({ older: 0 })
    expect(window.items).toHaveLength(31)

    const endless = [user('u0'), ...Array.from({ length: 100 }, (_, i) => answer(`a${i}`, 1000))]
    const cut = remoteWindow(endless, endless.length, 10_000)
    expect(cut.older).toBeGreaterThan(0)
    expect(jsonBytes(cut.items)).toBeLessThan(4 * 10_000 + 2000)
  })

  it('slims the items it gives, and gives at least one however large', () => {
    const items = [user('u0'), answer('a0', 8 * REMOTE_TEXT_LIMIT)]
    const window = remoteWindow(items, items.length, 1000)
    expect(ids(window.items)).toEqual(['a0'])
    expect(window.older).toBe(1)
    expect((window.items[0] as Extract<ChatItem, { kind: 'assistant' }>).text.length).toBeLessThan(4 * REMOTE_TEXT_LIMIT + 20)
  })
})
