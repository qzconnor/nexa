import { API_ROUTES, API_TAGS, ref, type ApiRoute, type JsonSchema } from './routes'

/**
 * The OpenAPI 3.1 document of the local API, built from the route table (`routes.ts`), and the shapes
 * of what it answers. The shapes follow the types in `src/shared` (`types.ts`, `chat.ts`,
 * `accounts.ts`); fields Nexa may add later are allowed.
 */

const ms = (what: string): JsonSchema => ({ type: 'integer', description: `${what} (Millisekunden seit 1970)` })
const str = (description: string): JsonSchema => ({ type: 'string', description })
const nullable = (type: string, description: string): JsonSchema => ({ type: [type, 'null'], description })

const PROVIDER_ID: JsonSchema = { type: 'string', enum: ['claude', 'codex', 'gemini'], description: 'Die CLI: `claude` (Claude Code), `codex` (Codex) oder `gemini` (Gemini CLI).' }
const SESSION_STATUS: JsonSchema = {
  type: 'string',
  enum: ['idle', 'starting', 'running', 'waiting', 'error', 'stopped'],
  description: '`idle` ruht, `starting` startet die CLI, `running` arbeitet, `waiting` wartet auf den Nutzer (Freigabe, Frage, Plan), `error` endete mit einem Fehler, `stopped` wurde beendet.',
}
const PERMISSION_MODE: JsonSchema = {
  type: 'string',
  enum: ['ask', 'edits', 'plan', 'auto', 'full'],
  description:
    'Freigaben: `ask` fragt vor Änderungen und Befehlen, `edits` ändert Dateien ohne Nachfrage und fragt vor Befehlen, `plan` liest nur und schlägt einen Plan vor, `auto` lässt einen Klassifikator entscheiden, `full` tut alles ohne Nachfrage.',
}
const CONTEXT: JsonSchema = {
  type: 'object',
  description: 'Wie voll der Kontext des Modells ist.',
  properties: { used: { type: 'integer', description: 'Tokens im Kontext.' }, window: { type: 'integer', description: 'So viele passen hinein.' } },
}
const BY_PROVIDER = (schema: JsonSchema, description: string): JsonSchema => ({
  type: 'object',
  description,
  properties: { claude: schema, codex: schema },
})

export const API_SCHEMAS: Record<string, JsonSchema> = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: { error: str('Was nicht ging, auf Deutsch.') },
  },
  Status: {
    type: 'object',
    required: ['app', 'providers', 'usage', 'sessions'],
    properties: {
      app: { type: 'object', properties: { name: { type: 'string', const: 'Nexa' }, version: str('Version von Nexa.') } },
      providers: { type: 'array', items: ref('ProviderStatus') },
      usage: { type: 'array', items: ref('ProviderUsage') },
      sessions: { type: 'array', items: ref('SessionSummary'), description: 'Die Chats, deren Status nicht `idle` ist.' },
    },
  },
  ProviderStatus: {
    type: 'object',
    description: 'Was Nexa beim Start über eine CLI herausfand.',
    required: ['id', 'name', 'installed', 'loggedIn', 'checkedAt'],
    properties: {
      id: PROVIDER_ID,
      name: str('„Claude Code“ oder „Codex“.'),
      installed: { type: 'boolean' },
      path: str('Wo die CLI liegt.'),
      version: str('Version der CLI.'),
      loggedIn: nullable('boolean', 'Ob der Vorgabe-Account angemeldet ist; `null`, solange unbekannt.'),
      account: {
        type: 'object',
        description: 'Der Login, wie die CLI ihn meldet.',
        properties: { email: { type: 'string' }, organization: { type: 'string' }, plan: { type: 'string' }, authMode: str('`chatgpt`, `apiKey`, `oauth` …') },
      },
      error: str('Warum die Erkennung scheiterte.'),
      checkedAt: ms('Wann zuletzt geprüft'),
    },
  },
  ProviderUsage: {
    type: 'object',
    description: 'Die Limits eines Accounts.',
    required: ['provider', 'accountId', 'windows', 'updatedAt', 'source'],
    properties: {
      provider: PROVIDER_ID,
      accountId: str('Der Account (aus `GET /api/accounts`).'),
      windows: { type: 'array', items: ref('UsageWindow') },
      plan: str('Der Plan, wie die CLI ihn nennt (`max`, `plus` …).'),
      limited: { type: 'boolean', description: 'Das Limit ist erreicht: Die CLI nimmt bis zu einem Reset nichts an.' },
      message: str('Warum die letzte Messung scheiterte; die Fenster sind dann die von davor.'),
      updatedAt: ms('Wann gemessen'),
      source: { type: 'string', enum: ['session', 'api'], description: '`session`: aus der Antwort einer CLI, `api`: abgefragt.' },
    },
  },
  UsageWindow: {
    type: 'object',
    description: 'Ein Limit-Fenster, z. B. 5 Stunden oder eine Woche.',
    required: ['key', 'label', 'usedPercent'],
    properties: {
      key: str('`five_hour`, `seven_day`, `primary` …'),
      label: str('Name, wie Nexa ihn zeigt („5 Stunden“, „Woche“).'),
      usedPercent: { type: 'number', minimum: 0, maximum: 100, description: 'Verbraucht in Prozent.' },
      resetsAt: ms('Wann das Fenster zurückgesetzt wird'),
      windowMinutes: { type: 'integer', description: 'Länge des Fensters in Minuten.' },
      forecast: { oneOf: [ref('UsageForecast'), { type: 'null' }] },
    },
  },
  UsageForecast: {
    type: 'object',
    description: 'Wohin das Fenster im aktuellen Tempo läuft.',
    required: ['exhaustsAt', 'atReset', 'ratePerHour', 'basis'],
    properties: {
      exhaustsAt: nullable('integer', 'Wann es 100 % erreicht (Millisekunden seit 1970), wenn vor dem Reset; sonst `null`.'),
      atReset: { type: 'number', description: 'Prozent beim Reset in diesem Tempo, auch über 100.' },
      ratePerHour: { type: 'number', description: 'Prozentpunkte je Stunde.' },
      basis: { type: 'string', enum: ['recent', 'window'], description: '`recent`: aus den Messungen der letzten Zeit, `window`: Mittel seit Beginn des Fensters.' },
    },
  },
  Account: {
    type: 'object',
    description: 'Ein Account einer CLI: ihr Konfigurationsordner mit Login.',
    required: ['id', 'name', 'provider', 'kind', 'color', 'configDir', 'customConfigDir', 'createdAt', 'secretHint', 'authState', 'identity', 'tokenExpiresAt', 'extraArgs'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      provider: PROVIDER_ID,
      kind: {
        type: 'string',
        enum: ['system', 'oauth', 'token', 'apiKey'],
        description: '`system`: der eigene Ordner der CLI, `oauth`: Browser-Login in eigenem Ordner, `token`: Long-lived Token, `apiKey`: API-Key.',
      },
      color: str('Farbe des Punkts neben dem Namen (`#rrggbb`).'),
      configDir: str('Der Ordner, mit dem die CLI startet (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GEMINI_CLI_HOME`).'),
      customConfigDir: { type: 'boolean', description: 'Der Ordner gehört dem Nutzer; Nexa löscht ihn nie.' },
      createdAt: ms('Angelegt'),
      secretHint: nullable('string', 'Anfang und Ende von Token oder API-Key.'),
      authState: {
        type: 'string',
        enum: ['ok', 'expired', 'dead', 'missing'],
        description: '`expired`: läuft beim nächsten Start neu, `dead`: braucht einen neuen Login, `missing`: nicht angemeldet.',
      },
      identity: {
        type: 'object',
        properties: {
          email: nullable('string', 'E-Mail des Logins.'),
          displayName: { type: ['string', 'null'] },
          organizationName: { type: ['string', 'null'] },
          organizationType: nullable('string', 'z. B. `claude_max`.'),
          subscriptionType: nullable('string', 'Der Plan: `max`, `pro`, `plus` …'),
        },
      },
      tokenExpiresAt: nullable('string', 'Wann der Zugangstoken abläuft (ISO 8601); die CLI erneuert ihn.'),
      extraArgs: { type: 'array', items: { type: 'string' }, description: 'Argumente für jeden Start der CLI.' },
    },
  },
  Project: {
    type: 'object',
    description: 'Ein Projekt: ein Ordner, in dem die Agents arbeiten.',
    required: ['id', 'name', 'path', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      path: str('Der Ordner (absolut).'),
      createdAt: ms('Angelegt'),
      updatedAt: ms('Zuletzt aktiv'),
      collapsed: { type: 'boolean', description: 'In der Sidebar eingeklappt.' },
      sectionId: str('Der Trenner, unter dem es steht.'),
      mcpOff: BY_PROVIDER({ type: 'array', items: { type: 'string' } }, 'Ausgeschaltete MCP-Server je CLI.'),
    },
  },
  SessionSummary: {
    type: 'object',
    description: 'Ein Chat in Kurzform.',
    required: ['id', 'projectId', 'title', 'provider', 'model', 'updatedAt', 'status'],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      title: { type: 'string' },
      provider: PROVIDER_ID,
      model: str('Das Modell; leer: die Vorgabe der CLI.'),
      updatedAt: ms('Zuletzt aktiv'),
      status: SESSION_STATUS,
    },
  },
  SessionMeta: {
    type: 'object',
    description: 'Ein Chat, wie Nexa ihn speichert (ohne Verlauf).',
    required: ['id', 'projectId', 'title', 'titleSource', 'provider', 'model', 'effort', 'permissionMode', 'createdAt', 'updatedAt', 'cli'],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      title: { type: 'string' },
      titleSource: { type: 'string', enum: ['auto', 'user'], description: '`auto`: vom ersten Prompt oder vom Modell, `user`: vom Nutzer.' },
      provider: { ...PROVIDER_ID, description: 'Die CLI, die den nächsten Prompt beantwortet.' },
      model: str('Das Modell; leer: die Vorgabe der CLI.'),
      effort: str('Der Denkaufwand; leer: die Vorgabe.'),
      ultracode: { type: 'boolean', description: 'Ultracode von Claude Code; fehlt: wie die CLI es einstellt.' },
      permissionMode: PERMISSION_MODE,
      createdAt: ms('Angelegt'),
      updatedAt: ms('Zuletzt aktiv'),
      pinned: { type: 'boolean' },
      archived: { type: 'boolean' },
      preview: str('Anfang des letzten Prompts oder der letzten Antwort.'),
      cli: BY_PROVIDER(ref('CliLink'), 'Die Unterhaltung jeder CLI, die im Chat schon antwortete.'),
      accounts: BY_PROVIDER({ type: 'string' }, 'Der Account je CLI; fehlt: die Vorgabe.'),
      cwd: str('Der Ordner, in dem der Agent arbeitet, wenn es nicht der des Projekts ist.'),
      dirs: { type: 'array', items: { type: 'string' }, description: 'Weitere Ordner, die der Agent nutzen darf.' },
      context: CONTEXT,
    },
  },
  CliLink: {
    type: 'object',
    description: 'Was eine CLI von einem Chat weiß.',
    required: ['sessionId', 'seenItems'],
    properties: {
      sessionId: str('Session von Claude Code bzw. Thread von Codex.'),
      seenItems: { type: 'integer', description: 'So viele Einträge des Chats kennt die CLI.' },
      accountId: str('Der Account, in dessen Ordner die Unterhaltung liegt.'),
      configDir: str('Der Ordner, in dem sie gespeichert wurde.'),
    },
  },
  SessionRuntime: {
    type: 'object',
    description: 'Was ein Chat gerade tut.',
    required: ['status', 'connected'],
    properties: {
      status: SESSION_STATUS,
      connected: { type: 'boolean', description: 'Der Prozess der CLI läuft (Claude) bzw. der Thread ist geladen (Codex).' },
      model: str('Das Modell, mit dem die CLI läuft.'),
      context: CONTEXT,
      error: str('Warum der Chat stehen blieb oder was scheiterte.'),
      turnStartedAt: ms('Seit wann die laufende Antwort läuft'),
      compactingSince: ms('Seit wann die CLI den Kontext zusammenfasst'),
      openElsewhere: {
        type: 'object',
        description: 'Wo die Unterhaltung sonst noch offen ist (z. B. Claude Code im Terminal).',
        properties: { provider: PROVIDER_ID, where: { type: 'string' } },
      },
      queued: { type: 'array', items: { type: 'object' }, description: 'Prompts, die die CLI noch nicht aufgenommen hat.' },
      resume: {
        type: 'object',
        description: 'Der Chat steht am Limit und geht von selbst weiter.',
        properties: {
          at: nullable('integer', 'Wann (Millisekunden seit 1970); `null`: mit keinem Account.'),
          estimated: { type: 'boolean', description: '`at` ist geschätzt.' },
          accountId: { type: ['string', 'null'], description: 'Mit welchem Account.' },
          byUser: { type: 'boolean', description: 'Der Nutzer bat darum („Am Reset fortsetzen“).' },
        },
      },
    },
  },
  RuntimeEvent: {
    type: 'object',
    description: 'Die Daten von `event: runtime` in `GET /api/events`.',
    required: ['sessionId', 'runtime'],
    properties: { sessionId: { type: 'string' }, runtime: ref('SessionRuntime') },
  },
}

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } })

/** The statuses a route answers with besides success, and why. */
export function routeErrors(route: ApiRoute): [status: string, description: string][] {
  const errors: [string, string][] = Object.entries(route.errors ?? {})
  if (route.params) errors.push(['404', 'Den Chat gibt es nicht'])
  if (!route.public) {
    errors.push(['401', 'Token fehlt oder ist falsch'], ['500', 'Nexa konnte es nicht ausführen; `error` sagt warum (z. B. CLI ausgeschaltet)'])
  }
  errors.push(['403', 'Anfrage aus einer Webseite (`Origin`) oder an einen anderen Host als `127.0.0.1`/`localhost`'])
  // One status a line, the route's own words first.
  const seen = new Set<string>()
  return errors.filter(([status]) => !seen.has(status) && seen.add(status)).sort(([a], [b]) => Number(a) - Number(b))
}

function operation(route: ApiRoute): Record<string, unknown> {
  const success = route.response
    ? { '200': { description: route.response.description, content: { [route.response.contentType ?? 'application/json']: { schema: route.response.schema } } } }
    : { '204': { description: 'Erledigt, ohne Inhalt' } }
  const parameters = Object.entries(route.params ?? {}).map(([name, description]) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } }))
  return {
    tags: [route.tag],
    operationId: route.operationId,
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(route.body
      ? { requestBody: { required: true, content: { 'application/json': { schema: route.body.schema, example: route.body.example } } } }
      : {}),
    responses: { ...success, ...Object.fromEntries(routeErrors(route).map(([status, description]) => [status, errorResponse(description)])) },
    ...(route.public ? { security: [] } : {}),
  }
}

/** The OpenAPI 3.1 document of the API that listens at `baseUrl`. */
export function buildOpenApi(baseUrl: string, version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of API_ROUTES as readonly ApiRoute[]) {
    paths[route.path] ??= {}
    paths[route.path]![route.method.toLowerCase()] = operation(route)
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Nexa – lokale API',
      version,
      description:
        'Steuert Nexa von anderen Programmen aus (Stream Deck, Skripte). Der Server lauscht nur auf 127.0.0.1 und ist aus, bis er unter Einstellungen › Lokale API eingeschaltet wird; ' +
        'jede Anfrage außer der Beschreibung braucht den Token von dort als `Authorization: Bearer <token>`. Anfragen aus Webseiten (mit `Origin`) lehnt er ab.',
    },
    servers: [{ url: baseUrl }],
    tags: Object.entries(API_TAGS).map(([name, description]) => ({ name, description })),
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Der Token aus Einstellungen › Lokale API.' } },
      schemas: API_SCHEMAS,
    },
  }
}
