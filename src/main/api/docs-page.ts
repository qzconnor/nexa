import { API_SCHEMAS, routeErrors } from './openapi'
import { API_ROUTES, API_TAGS, type ApiRoute, type ApiTag, type JsonSchema } from './routes'

/**
 * The page `/docs` of the local API, built from the same route table and shapes as `/openapi.json`.
 * It stands alone (no scripts, styles inline, nothing from the net), so it works offline and under the
 * server's Content-Security-Policy. Colors are the browser's system colors, light or dark as it is set.
 */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** `code` in descriptions becomes <code>, the rest is escaped. */
const inline = (value: string) => escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>')

const ROUTES = API_ROUTES as readonly ApiRoute[]

const schemaName = (schema: JsonSchema) => (typeof schema.$ref === 'string' ? schema.$ref.split('/').pop()! : null)

/** A schema's type in short, with links to the shapes it names. */
function typeHtml(schema: JsonSchema): string {
  const name = schemaName(schema)
  if (name) return `<a href="#schema-${name}">${name}</a>`
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as JsonSchema[]).map(typeHtml).join(' | ')
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => `<code>${escapeHtml(JSON.stringify(value))}</code>`).join(' | ')
  if ('const' in schema) return `<code>${escapeHtml(JSON.stringify(schema.const))}</code>`
  if (schema.type === 'array') return `${typeHtml((schema.items ?? {}) as JsonSchema)}[]`
  if (Array.isArray(schema.type)) return schema.type.join(' | ')
  if (schema.type === 'object') return 'object'
  return typeof schema.type === 'string' ? schema.type : 'beliebig'
}

/** The fields of an object, those of objects in it below them (`identity.email`). */
function fieldRows(schema: JsonSchema, prefix = ''): string[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema.required ?? []) as string[])
  return Object.entries(properties).flatMap(([name, field]) => {
    const path = `${prefix}${name}`
    const optional = required.has(name) ? '' : ' <span class="muted">optional</span>'
    const extra = field.default !== undefined ? ` Vorgabe: <code>${escapeHtml(JSON.stringify(field.default))}</code>.` : ''
    const row = `<tr><td><code>${escapeHtml(path)}</code>${optional}</td><td>${typeHtml(field)}</td><td>${inline(String(field.description ?? ''))}${extra}</td></tr>`
    const nested = !schemaName(field) && field.type === 'object' && field.properties ? fieldRows(field, `${path}.`) : []
    return [row, ...nested]
  })
}

function fieldTable(rows: string[]): string {
  return rows.length ? `<table><thead><tr><th>Feld</th><th>Typ</th><th>Bedeutung</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ''
}

function curlExample(route: ApiRoute, baseUrl: string): string {
  const parts = ['curl']
  if (route.method !== 'GET') parts.push(`-X ${route.method}`)
  if (!route.public) parts.push('-H "Authorization: Bearer $TOKEN"')
  if (route.body) parts.push('-H "Content-Type: application/json"', `-d '${JSON.stringify(route.body.example)}'`)
  if (route.response?.contentType === 'text/event-stream') parts.push('-N')
  parts.push(`${baseUrl}${route.path.replace(/\{(\w+)\}/g, '<$1>')}`)
  return parts.join(' ')
}

function responseHtml(route: ApiRoute): string {
  const response = route.response
  if (!response) return '<p><code>204</code> Erledigt, ohne Inhalt.</p>'
  const type = response.contentType && response.contentType !== 'application/json' ? `<code>${response.contentType}</code>` : typeHtml(response.schema)
  return `<p><code>200</code> ${inline(response.description)}: ${type}</p>`
}

function renderRoute(route: ApiRoute, baseUrl: string): string {
  const params = Object.entries(route.params ?? {}).map(
    ([name, description]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>Pfad</td><td>${inline(description)}</td></tr>`,
  )
  const errors = routeErrors(route).map(([status, description]) => `<li><code>${status}</code> ${inline(description)}</li>`)
  return `
    <article class="route" id="${route.operationId}">
      <header>
        <span class="method ${route.method.toLowerCase()}">${route.method}</span>
        <code class="path">${escapeHtml(route.path)}</code>
        ${route.public ? '<span class="badge">ohne Token</span>' : ''}
      </header>
      <h3>${escapeHtml(route.summary)}</h3>
      ${route.description ? `<p>${inline(route.description)}</p>` : ''}
      ${params.length ? `<p class="label">Parameter</p><table><thead><tr><th>Name</th><th>Ort</th><th>Bedeutung</th></tr></thead><tbody>${params.join('')}</tbody></table>` : ''}
      ${
        route.body
          ? `<p class="label">Body (JSON)</p>${fieldTable(fieldRows(route.body.schema))}<pre>${escapeHtml(JSON.stringify(route.body.example, null, 2))}</pre>`
          : ''
      }
      <p class="label">Antwort</p>
      ${responseHtml(route)}
      <ul class="errors">${errors.join('')}</ul>
      <p class="label">Beispiel</p>
      <pre>${escapeHtml(curlExample(route, baseUrl))}</pre>
    </article>`
}

function renderSchema(name: string, schema: JsonSchema): string {
  return `
    <article class="schema" id="schema-${name}">
      <h3>${name}</h3>
      ${schema.description ? `<p>${inline(String(schema.description))}</p>` : ''}
      ${fieldTable(fieldRows(schema))}
    </article>`
}

/** The page, for the API that listens at `baseUrl`. */
export function renderDocsPage(baseUrl: string, version: string): string {
  const tags = (Object.keys(API_TAGS) as ApiTag[]).filter((tag) => ROUTES.some((route) => route.tag === tag))
  const nav = tags.map((tag) => `<li><a href="#tag-${tag}">${escapeHtml(tag)}</a></li>`).join('')
  const sections = tags
    .map(
      (tag) => `
      <section id="tag-${tag}">
        <h2>${escapeHtml(tag)}</h2>
        <p class="muted">${escapeHtml(API_TAGS[tag])}</p>
        ${ROUTES.filter((route) => route.tag === tag)
          .map((route) => renderRoute(route, baseUrl))
          .join('')}
      </section>`,
    )
    .join('')
  const schemas = Object.entries(API_SCHEMAS)
    .map(([name, schema]) => renderSchema(name, schema))
    .join('')
  const base = escapeHtml(baseUrl)

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexa – lokale API</title>
<style>
  :root {
    color-scheme: light dark;
    --line: color-mix(in srgb, CanvasText 14%, Canvas);
    --soft: color-mix(in srgb, CanvasText 6%, Canvas);
    --muted: color-mix(in srgb, CanvasText 62%, Canvas);
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: Canvas; color: CanvasText; font: 15px/1.6 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; }
  .layout { display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 40px; max-width: 1120px; margin: 0 auto; padding: 40px 24px; }
  nav { position: sticky; top: 40px; align-self: start; }
  nav ul { list-style: none; padding: 0; margin: 12px 0 0; }
  nav a { color: var(--muted); text-decoration: none; display: block; padding: 3px 0; }
  nav a:hover { color: CanvasText; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 48px 0 4px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  h3 { font-size: 16px; margin: 12px 0 4px; }
  p { margin: 6px 0; }
  a { color: LinkText; }
  code, pre { font-family: "Cascadia Mono", Consolas, ui-monospace, monospace; font-size: 13px; }
  code { background: var(--soft); padding: 1px 5px; border-radius: 5px; }
  pre { background: var(--soft); padding: 12px 14px; border-radius: 10px; overflow-x: auto; margin: 6px 0; }
  .route, .schema { border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin: 14px 0; }
  .route header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .path { background: none; padding: 0; font-size: 14px; }
  .method { font: 600 12px/1 "Cascadia Mono", Consolas, ui-monospace, monospace; padding: 5px 8px; border-radius: 6px; background: CanvasText; color: Canvas; }
  .method.post { background: LinkText; }
  .badge { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; }
  .label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-top: 14px; }
  .muted { color: var(--muted); }
  .errors { margin: 6px 0; padding-left: 18px; color: var(--muted); font-size: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; }
  td:first-child { white-space: nowrap; }
  @media (max-width: 800px) { .layout { grid-template-columns: 1fr; } nav { position: static; } }
</style>
</head>
<body>
<div class="layout">
  <nav>
    <strong>Nexa – lokale API</strong>
    <div class="muted">Version ${escapeHtml(version)}</div>
    <ul>
      <li><a href="#auth">Zugang</a></li>
      ${nav}
      <li><a href="#schemas">Schemas</a></li>
      <li><a href="/openapi.json">openapi.json</a></li>
    </ul>
  </nav>
  <main>
    <h1>Lokale API</h1>
    <p class="muted">Steuert Nexa von anderen Programmen aus, etwa vom Stream Deck oder aus Skripten: lesen, was die CLIs und Chats tun, Chats anlegen, Prompts senden, Antworten abbrechen, das Fenster zeigen.</p>
    <section id="auth">
      <h2>Zugang</h2>
      <p>Der Server lauscht nur auf <code>${base}</code> und läuft, solange er unter <em>Einstellungen › Lokale API</em> eingeschaltet ist. Jede Anfrage außer dieser Seite und <code>/openapi.json</code> braucht den Token von dort (in den Beispielen <code>$TOKEN</code>):</p>
      <pre>Authorization: Bearer &lt;token&gt;</pre>
      <p>Anfragen aus Webseiten (mit <code>Origin</code>-Header) und an andere Host-Namen als <code>127.0.0.1</code> oder <code>localhost</code> lehnt er mit <code>403</code> ab: Die API ist für Programme und Skripte auf diesem Rechner. Bodies sind JSON-Objekte bis 1 MB. Fehler kommen als <code>{"error": "…"}</code> mit passendem Status, eine Methode, die es auf einem Pfad nicht gibt, mit <code>405</code> und <code>Allow</code>.</p>
      <p>Die maschinenlesbare Beschreibung liegt unter <a href="/openapi.json">/openapi.json</a> (OpenAPI 3.1), zum Import in Postman, Insomnia, Bruno oder einen Client-Generator.</p>
      <p class="label">PowerShell</p>
      <pre>${escapeHtml(`$h = @{ Authorization = 'Bearer <token>' }
Invoke-RestMethod ${baseUrl}/api/status -Headers $h
Invoke-RestMethod ${baseUrl}/api/sessions/<id>/send -Method Post -Headers $h -ContentType 'application/json' -Body '{"text":"Weiter"}'`)}</pre>
    </section>
    ${sections}
    <section id="schemas">
      <h2>Schemas</h2>
      <p class="muted">Was die Endpunkte senden und bekommen. Zeiten sind Millisekunden seit 1970; Nexa kann Felder hinzufügen.</p>
      ${schemas}
    </section>
  </main>
</div>
</body>
</html>`
}
