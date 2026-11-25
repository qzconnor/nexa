import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@shared/accounts'

const fetchMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

const { ArtifactService, artifactToken, listFailure, parseArtifact, thumbUrl } = await import('./artifact-service')

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const waited: number[] = []

function service(kind: Account['kind'] = 'oauth', provider: Account['provider'] = 'claude') {
  return new ArtifactService(
    { get: () => ({ id: 'a', kind, provider }) as Account, token: () => ({ token: 'tok' }) },
    'nexa/test',
    () => '2.1.330',
    async (ms) => {
      waited.push(ms)
    },
  )
}

// A function returned from the hook would run as its cleanup.
beforeEach(() => {
  fetchMock.mockReset()
  waited.length = 0
})

describe('parseArtifact', () => {
  it('reads a row of the newer list', () => {
    expect(
      parseArtifact({
        id: 'abc_DEF-123',
        title: '  Bericht  ',
        kind: 'document',
        rel: 'mine',
        audience: 'org',
        created_at: '2026-11-01T10:00:00Z',
        last_viewed_at: 1_763_000_000,
        view_count: 7,
      }),
    ).toEqual({
      id: 'abc_DEF-123',
      url: 'https://claude.ai/code/artifact/abc_DEF-123',
      shortId: null,
      title: 'Bericht',
      description: null,
      kind: 'document',
      mine: true,
      external: false,
      audience: 'org',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: null,
      lastViewedAt: new Date(1_763_000_000_000).toISOString(),
      views: 7,
      pinned: false,
      renamable: true,
    })
  })

  it('reads pins, and whether a shared one may be renamed as claude.ai says', () => {
    expect(parseArtifact({ id: 'pinned-1', rel: 'shared', starred: true })).toMatchObject({ pinned: true, renamable: false })
    expect(parseArtifact({ id: 'shared-2', rel: 'shared', renamable: true })).toMatchObject({ pinned: false, renamable: true })
  })

  it('takes the link claude.ai names, on claude.ai only', () => {
    expect(parseArtifact({ id: 'with-link', open_url: 'https://claude.ai/artifact/R7RbnhAPX1Qy' })).toMatchObject({
      url: 'https://claude.ai/artifact/R7RbnhAPX1Qy',
      shortId: 'R7RbnhAPX1Qy',
    })
    expect(parseArtifact({ id: 'elsewhere', open_url: 'https://evil.example/artifact/x' })).toMatchObject({
      url: 'https://claude.ai/code/artifact/elsewhere',
      shortId: null,
    })
  })

  it('takes a row of the older list as a page, published when its version says', () => {
    const artifact = parseArtifact({ slug: 'older-frame', live: '1763000000-abcdef' })
    expect(artifact).toMatchObject({ id: 'older-frame', kind: 'page', title: 'Ohne Titel', updatedAt: new Date(1_763_000_000_000).toISOString() })
  })

  it('skips deleted rows, other kinds and ids that could leave the path', () => {
    expect(parseArtifact({ id: 'gone', soft_deleted: true })).toBeNull()
    expect(parseArtifact({ id: 'chat', kind: 'conversation' })).toBeNull()
    expect(parseArtifact({ id: '../etc' })).toBeNull()
  })
})

describe('thumbUrl', () => {
  it('takes thumbnails from the artifacts host only', () => {
    expect(thumbUrl('https://x1.frame.claudeusercontent.com/t.png?sig=1')).toBe('https://x1.frame.claudeusercontent.com/t.png?sig=1')
    expect(thumbUrl('http://x1.frame.claudeusercontent.com/t.png')).toBeNull()
    expect(thumbUrl('https://evil.example/frame.claudeusercontent.com.png')).toBeNull()
    expect(thumbUrl('https://u:p@x.frame.claudeusercontent.com/t.png')).toBeNull()
  })
})

describe('artifactToken', () => {
  it('uses the token of a token account and the access token of a login', () => {
    expect(artifactToken('token', { authState: 'missing', accessToken: null }, 'sk-ant-oat')).toEqual({ token: 'sk-ant-oat' })
    expect(artifactToken('oauth', { authState: 'ok', accessToken: 'at' }, null)).toEqual({ token: 'at' })
    expect(artifactToken('system', { authState: 'ok', accessToken: 'at' }, null)).toEqual({ token: 'at' })
  })

  it('says why there is none', () => {
    expect(artifactToken('apiKey', { authState: 'ok', accessToken: null }, null)).toMatchObject({ status: 'unavailable' })
    expect(artifactToken('oauth', { authState: 'expired', accessToken: null }, null)).toMatchObject({
      status: 'signed-out',
      message: expect.stringContaining('erneuert'),
    })
    expect(artifactToken('oauth', { authState: 'missing', accessToken: null }, null)).toMatchObject({ status: 'signed-out' })
  })
})

describe('listFailure', () => {
  it('tells a revoked token from an expired login', () => {
    expect(listFailure(401, 'token').status).toBe('unavailable')
    expect(listFailure(401, 'oauth').status).toBe('signed-out')
    expect(listFailure(403, 'oauth').status).toBe('unavailable')
    expect(listFailure(500, 'oauth')).toEqual({ status: 'error', message: 'claude.ai antwortete mit HTTP 500.' })
  })
})

describe('ArtifactService.list', () => {
  it('asks like Claude Code and joins the own and the shared list, each artifact once, latest first', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.includes('rel=all')
        ? json(200, { artifacts: [{ id: 'own-one-1', rel: 'mine', last_viewed_at: '2026-11-01T00:00:00Z' }] })
        : json(200, {
            artifacts: [
              { id: 'own-one-1', rel: 'mine', last_viewed_at: '2026-11-01T00:00:00Z' },
              { id: 'shared-1', rel: 'shared', last_viewed_at: '2026-11-20T00:00:00Z' },
            ],
          }),
    )
    const list = await service().list('a')
    expect(list.status).toBe('ok')
    expect(list.artifacts.map((a) => a.id)).toEqual(['shared-1', 'own-one-1'])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/api\/frame\/artifacts\?rel=all&kind=page%2Cdocument/)
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'anthropic-beta': 'oauth-2025-04-20',
      'X-Frame-Surface': 'code',
      'X-Frame-Client-Version': '2.1.330',
    })
    expect(init?.redirect).toBe('error')
  })

  it('falls back to the older list when the newer one is refused', async () => {
    fetchMock.mockImplementation(async (url) => (url.includes('/frames') ? json(200, { frames: [{ id: 'frame-1' }] }) : json(403, {})))
    const list = await service().list('a')
    expect(list.artifacts.map((a) => a.id)).toEqual(['frame-1'])
  })

  it('reports a refused login without throwing', async () => {
    fetchMock.mockResolvedValue(json(401, {}))
    expect(await service('token').list('a')).toMatchObject({ status: 'unavailable', artifacts: [] })
  })

  it('has none for Codex accounts', async () => {
    expect(await service('oauth', 'codex').list('a')).toMatchObject({ status: 'unavailable' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches only the thumbnails of the last list, as data URL', async () => {
    fetchMock.mockImplementation(async (url) =>
      url.startsWith('https://api.anthropic.com')
        ? json(200, {
            artifacts: [{ id: 'with-thumb', thumbnail_url: 'https://t.frame.claudeusercontent.com/a.png', thumbnail_dark_url: 'https://evil.example/b.png' }],
          })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const s = service()
    expect(await s.thumbnail('a', 'with-thumb', false)).toBeNull()
    await s.list('a')
    expect(await s.thumbnail('a', 'with-thumb', true)).toBe('data:image/png;base64,AQID')
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://t.frame.claudeusercontent.com/a.png')
  })
})

describe('ArtifactService actions', () => {
  it('says whether claude.ai offers pins to the login', async () => {
    fetchMock.mockImplementation(async (url) => json(200, { artifacts: [], starsEnabled: url.includes('rel=all') }))
    expect((await service().list('a')).pinsEnabled).toBe(true)
  })

  it('renames with the title on one line, and refuses an empty or too long one before asking', async () => {
    fetchMock.mockResolvedValue(json(200, {}))
    await service().rename('a', 'own-1', '  Neuer\n Titel ')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/api/frame/retitle/own-1')
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ title: 'Neuer Titel' }), redirect: 'error' })
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' })
    await expect(service().rename('a', 'own-1', '   ')).rejects.toThrow('leer')
    await expect(service().rename('a', 'own-1', 'x'.repeat(301))).rejects.toThrow('300')
    await expect(service().rename('a', '../frames', 'Titel')).rejects.toThrow('Ungültige')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deletes once more after the time a busy server names, and knows one already gone', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 409, headers: { 'retry-after': '3' } })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await service().remove('a', 'own-1')).toBe('deleted')
    expect(waited).toEqual([3000])
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      'DELETE https://api.anthropic.com/api/frame/own-1',
      'DELETE https://api.anthropic.com/api/frame/own-1',
    ])
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await service().remove('a', 'own-1')).toBe('gone')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(service().remove('a', 'shared-1')).rejects.toThrow('gehört nicht diesem Login')
  })

  it('pins and unpins', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    const s = service()
    await s.setPinned('a', 'own-1', true)
    await s.setPinned('a', 'own-1', false)
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      'POST https://api.anthropic.com/api/frame/favorite/own-1',
      'DELETE https://api.anthropic.com/api/frame/favorite/own-1',
    ])
  })

  it('changes nothing for Codex accounts', async () => {
    await expect(service('oauth', 'codex').setPinned('a', 'own-1', true)).rejects.toThrow('nur für Claude')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
