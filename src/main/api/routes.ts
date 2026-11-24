/**
 * The routes of Nexa's local API, each with what the OpenAPI document (`openapi.ts`) and the docs page
 * (`docs-page.ts`) say of it. The server answers only what stands here (`matchRoute`) and keys its
 * handlers by these routes, so no route goes without its description.
 */

export type JsonSchema = Record<string, unknown>
export type ApiMethod = 'GET' | 'POST'

/** The groups of the routes, in the order the docs show them. */
export const API_TAGS = {
  Status: 'Zustand der App und ihrer CLIs',
  Accounts: 'Accounts der CLIs und ihre Limits',
  Projekte: 'Projekte der Sidebar',
  Chats: 'Chats anlegen, Prompts senden, Antworten abbrechen, Chats zeigen',
  Fenster: 'Das Fenster von Nexa',
  Ereignisse: 'Live-Ereignisse als Server-Sent Events',
  Dokumentation: 'Diese Beschreibung der API, ohne Token',
} as const

export type ApiTag = keyof typeof API_TAGS

export interface ApiRoute {
  method: ApiMethod
  /** With its parameters in braces, as OpenAPI writes them: `/api/sessions/{id}/send`. */
  path: string
  operationId: string
  tag: ApiTag
  summary: string
  description?: string
  /** Answered without the token: the description of the API itself. */
  public?: boolean
  /** The parameters in the path, by name. */
  params?: Readonly<Record<string, string>>
  body?: { schema: JsonSchema; example: unknown }
  /** What a 200 carries; none: 204 without content. */
  response?: { description: string; schema: JsonSchema; contentType?: string }
  /** Errors of the route itself, by status; 401, 403, 404 for a path with parameters and 500 come with every route that has them. */
  errors?: Readonly<Record<number, string>>
}

export const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` })
const listOf = (name: string): JsonSchema => ({ type: 'array', items: ref(name) })

const CHAT_ID = { id: 'ID des Chats (aus `GET /api/sessions`)' }

export const API_ROUTES = [
  {
    method: 'GET',
    path: '/api/status',
    operationId: 'getStatus',
    tag: 'Status',
    summary: 'Zustand der App',
    description:
      'Version von Nexa, die CLIs (installiert, Version, Login), die Limits aller Accounts und die Chats, die gerade nicht ruhen: Status nicht `idle`, also beim Starten, Arbeiten, Warten auf den Nutzer oder nach einem Fehler.',
    response: { description: 'App, CLIs, Limits und Chats, die nicht ruhen', schema: ref('Status') },
  },
  {
    method: 'GET',
    path: '/api/usage',
    operationId: 'getUsage',
    tag: 'Accounts',
    summary: 'Limits aller Accounts',
    description:
      'Je Account die zuletzt gemessenen Limit-Fenster mit Reset und Prognose. Nexa misst alle 5 Minuten und bei jeder Antwort einer CLI; ein Account ohne Messung fehlt.',
    response: { description: 'Limits je Account', schema: listOf('ProviderUsage') },
  },
  {
    method: 'GET',
    path: '/api/accounts',
    operationId: 'getAccounts',
    tag: 'Accounts',
    summary: 'Accounts der CLIs',
    description:
      'Alle Accounts von Claude Code und Codex in der Reihenfolge der Einstellungen, mit Login und Plan. Token und API-Keys sind nicht dabei, nur ihr Anfang und Ende (`secretHint`).',
    response: { description: 'Die Accounts', schema: listOf('Account') },
  },
  {
    method: 'GET',
    path: '/api/projects',
    operationId: 'getProjects',
    tag: 'Projekte',
    summary: 'Projekte',
    description: 'Die Projekte der Sidebar: je ein Ordner, in dem die Agents arbeiten.',
    response: { description: 'Die Projekte', schema: listOf('Project') },
  },
  {
    method: 'GET',
    path: '/api/sessions',
    operationId: 'getSessions',
    tag: 'Chats',
    summary: 'Chats',
    description: 'Alle Chats, die zuletzt aktiven zuerst, mit ihrem Status.',
    response: { description: 'Die Chats', schema: listOf('SessionSummary') },
  },
  {
    method: 'POST',
    path: '/api/sessions',
    operationId: 'createSession',
    tag: 'Chats',
    summary: 'Neuen Chat anlegen',
    description:
      'Legt einen Chat in einem Projekt an, schickt auf Wunsch gleich den ersten Prompt und zeigt ihn im Fenster. Mit `path` statt `projectId` nimmt Nexa das Projekt genau dieses Ordners und legt eines an, wenn es keins gibt. ' +
      'Ohne `provider` und `account` gelten die Vorgaben der Einstellungen; ein Account bestimmt auch die CLI. Die Antwort kommt, sobald der Prompt bei der CLI ist, nicht erst mit der Antwort des Agents.',
    body: {
      schema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Das Projekt (aus `GET /api/projects`).' },
          path: { type: 'string', description: 'Ein Ordner, wenn `projectId` fehlt.' },
          provider: { type: 'string', enum: ['claude', 'codex'], description: 'Die CLI; fehlt sie (oder ist es eine andere), gilt die Vorgabe.' },
          account: { type: 'string', description: 'ID eines Accounts (aus `GET /api/accounts`); ein unbekannter gilt als keiner.' },
          prompt: { type: 'string', description: 'Der erste Prompt; ohne ihn bleibt der Chat leer.' },
          show: { type: 'boolean', default: true, description: '`false`: das Fenster bleibt, wo es ist.' },
        },
      },
      example: { path: 'C:\\Projekte\\demo', provider: 'claude', prompt: 'Was macht dieses Projekt?' },
    },
    response: { description: 'Der neue Chat', schema: ref('SessionMeta') },
    errors: {
      400: '„path“ oder „projectId“ fehlt, den Ordner gibt es nicht, oder der Body ist kein JSON-Objekt',
      404: 'Das Projekt `projectId` gibt es nicht',
      413: 'Der Body ist größer als 1 MB',
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/{id}/send',
    operationId: 'sendPrompt',
    tag: 'Chats',
    summary: 'Prompt senden',
    description:
      'Schickt einen Prompt in den Chat wie das Eingabefeld: Ruht der Chat, startet seine CLI damit; arbeitet der Agent gerade, nimmt er ihn bei seinem nächsten Schritt auf. ' +
      'Die Antwort kommt, sobald die CLI den Prompt hat; was der Agent antwortet, zeigen das Fenster und die Ereignisse (`GET /api/events`).',
    params: CHAT_ID,
    body: {
      schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: 'Der Prompt (Markdown).' } } },
      example: { text: 'Führe die Tests aus und behebe, was fehlschlägt.' },
    },
    errors: { 400: '„text“ fehlt oder ist leer, oder der Body ist kein JSON-Objekt', 413: 'Der Body ist größer als 1 MB' },
  },
  {
    method: 'POST',
    path: '/api/sessions/{id}/interrupt',
    operationId: 'interruptSession',
    tag: 'Chats',
    summary: 'Antwort abbrechen',
    description: 'Bricht die laufende Antwort des Agents ab, wie Esc im Fenster; ruht der Chat, geschieht nichts.',
    params: CHAT_ID,
  },
  {
    method: 'POST',
    path: '/api/sessions/{id}/show',
    operationId: 'showSession',
    tag: 'Chats',
    summary: 'Chat zeigen',
    description: 'Holt das Fenster nach vorn (öffnet es, wenn es zu ist) und zeigt den Chat.',
    params: CHAT_ID,
  },
  {
    method: 'POST',
    path: '/api/window/show',
    operationId: 'showWindow',
    tag: 'Fenster',
    summary: 'Fenster zeigen',
    description: 'Holt das Fenster nach vorn, auch aus dem Infobereich.',
  },
  {
    method: 'GET',
    path: '/api/events',
    operationId: 'getEvents',
    tag: 'Ereignisse',
    summary: 'Ereignisse (Server-Sent Events)',
    description:
      'Ein Strom, der offen bleibt. `event: sessions` bringt alle Chats (`SessionMeta[]`), sobald sich einer ändert; `event: runtime` bringt `{ sessionId, runtime }` (`RuntimeEvent`), wenn ein Chat startet, arbeitet, wartet oder ruht; `event: usage` bringt die Limits aller Accounts (`ProviderUsage[]`). ' +
      'Zu Beginn kommt nur der Kommentar `: nexa`, keine Momentaufnahme: den Stand geben `GET /api/status` und `GET /api/sessions`. Alle 25 Sekunden hält der Kommentar `: ping` die Verbindung offen.',
    response: {
      description: 'Strom von Ereignissen, je `event: <Name>` und `data: <JSON>`',
      contentType: 'text/event-stream',
      schema: { type: 'string' },
    },
  },
  {
    method: 'GET',
    path: '/openapi.json',
    operationId: 'getOpenApi',
    tag: 'Dokumentation',
    summary: 'OpenAPI-Beschreibung',
    description: 'Diese API als OpenAPI 3.1, zum Import in Postman, Insomnia, Bruno oder einen Client-Generator.',
    public: true,
    response: { description: 'Das OpenAPI-Dokument', schema: { type: 'object' } },
  },
  {
    method: 'GET',
    path: '/docs',
    operationId: 'getDocs',
    tag: 'Dokumentation',
    summary: 'Dokumentation',
    description: 'Diese API als Seite für den Browser, mit Beispielen; sie lädt nichts aus dem Netz.',
    public: true,
    response: { description: 'Die Seite', contentType: 'text/html', schema: { type: 'string' } },
  },
] as const satisfies readonly ApiRoute[]

type KeyOf<R> = R extends { method: infer M extends string; path: infer P extends string } ? `${M} ${P}` : never

/** `GET /api/status`, `POST /api/sessions/{id}/send` …: a route as the server's handlers are keyed. */
export type ApiRouteKey = KeyOf<(typeof API_ROUTES)[number]>

export function routeKey(route: Pick<ApiRoute, 'method' | 'path'>): ApiRouteKey {
  return `${route.method} ${route.path}` as ApiRouteKey
}

/** The parameters of a path from the parts of a request's path; null when it doesn't fit. */
function matchPath(path: string, parts: readonly string[]): Record<string, string> | null {
  const pattern = path.split('/').filter(Boolean)
  if (pattern.length !== parts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pattern.length; i++) {
    const name = /^\{(\w+)\}$/.exec(pattern[i]!)?.[1]
    if (!name) {
      if (pattern[i] !== parts[i]) return null
      continue
    }
    try {
      params[name] = decodeURIComponent(parts[i]!)
    } catch {
      return null
    }
  }
  return params
}

export type RouteMatch = { route: ApiRoute; key: ApiRouteKey; params: Record<string, string> }

/**
 * The route a request goes to. Without one, `allowed` names the methods its path has (405), or none
 * (404). Slashes at the end and doubled ones don't count.
 */
export function matchRoute(method: string, pathname: string): RouteMatch | { allowed: ApiMethod[] } {
  const parts = pathname.split('/').filter(Boolean)
  const allowed: ApiMethod[] = []
  for (const route of API_ROUTES as readonly ApiRoute[]) {
    const params = matchPath(route.path, parts)
    if (!params) continue
    if (route.method === method) return { route, key: routeKey(route), params }
    allowed.push(route.method)
  }
  return { allowed }
}
