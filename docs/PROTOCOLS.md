# Protokolle der CLIs

Was Nexa von den CLIs nutzt und welche Eigenheiten dabei auffielen. Bei neuen CLI-Versionen hier
nachtragen, was sich geändert hat.

## Claude Code (`claude -p`)

Ein Prozess je Session:

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --include-partial-messages --forward-subagent-text
       --permission-prompt-tool stdio --permission-mode <modus>
       [--model …] [--effort …] [--resume <id>] [--append-system-prompt …]
       [--mcp-config <json> --allowedTools=<mcp__nexa__…,…>] [--no-chrome]
```

- **Eingabe**: `{"type":"user","message":{"role":"user","content":[…]}}` je Zeile, Bilder als
  `image`-Blöcke (Base64).
- **Ausgabe**: `system/init` (Sitzungs-ID, Modell, Werkzeuge), `stream_event` (Teil-Deltas für Text und
  Thinking), `assistant`/`user` (fertige Blöcke, `tool_use`/`tool_result`), `result` (Turn-Ende mit
  Kosten und Tokens), `rate_limit_event` (Usage-Fenster mit Prozent und Reset).
- **Control-Protokoll** (`control_request`/`control_response`):
  - an Claude: `initialize`, `interrupt`, `set_model`, `set_permission_mode`, `get_task_output`,
    `stop_task`
  - von Claude: `can_use_tool` (Freigabe, Antwort `allow` mit ggf. geänderter Eingabe oder `deny` mit
    Nachricht). `AskUserQuestion` und `ExitPlanMode` kommen ebenfalls hierüber und werden als Frage bzw.
    Plan angezeigt.
- Der Denkaufwand (`--effort`) lässt sich nicht im laufenden Prozess ändern: Nexa beendet den Prozess,
  der nächste Turn startet mit `--resume`.
- Subagents: `tool_use` von `Task`/`Agent`, ihre Nachrichten tragen `parent_tool_use_id`. Seit 2.1.x laufen
  sie auch ohne `run_in_background` im Hintergrund: `system/task_started` mit `task_type: "local_agent"` und
  `is_backgrounded: true`, das `tool_result` kommt sofort („Async agent launched successfully. agentId: …“),
  der Turn endet, während der Agent weiterläuft. `task_progress` meldet Werkzeuge (`last_tool_name`,
  `usage.tool_uses`), `task_notification` das Ende (`status`, `summary` mit dem Bericht des Agents); danach
  setzt Claude Code den Hauptchat mit einem eigenen Turn fort.
- **Shells** (Bash, auch im Vordergrund) sind Tasks: `system/task_started` mit `task_type: "local_bash"`,
  `tool_use_id` und `is_backgrounded`. Im Hintergrund kommt das `tool_result` sofort („Command running in
  background with ID: … Output is being written to: …“), das Ende später: `task_updated`
  (`patch.status`: `completed`, `failed`, `killed`; `patch.is_backgrounded`, wenn ein Befehl nachträglich in
  den Hintergrund geht), `task_notification` (`status`: `completed`, `failed`, `stopped`) und
  `background_tasks_changed` (die ganze Liste, die noch läuft). `get_task_output { task_id }` liefert die
  letzten 8 KiB der Ausgabe (`output`, `truncated`), auch nach dem Ende, solange der Prozess lebt;
  `stop_task { task_id }` beendet die Shell. Mit dem Prozess von Claude Code enden auch seine Shells.
- `--allowedTools` nennt Nexas Werkzeuge einzeln (in der `=`-Form, sonst nimmt die Option die folgenden
  Argumente mit). Nicht genannte, z. B. die heiklen Browser-Werkzeuge, fragen über `can_use_tool` und
  erscheinen als Freigabe im Chat. `--no-chrome` schaltet „Claude in Chrome“ ab, damit Claude den
  Browser von Nexa nimmt (Einstellung „Ohne ‚Claude in Chrome‘“, nur mit eingeschalteten Browser-Werkzeugen).

### Accounts, Login und Limits

- **Ordner**: `CLAUDE_CONFIG_DIR` legt alles in einen Ordner: `.credentials.json` (`claudeAiOauth` mit
  `accessToken`, `refreshToken`, `expiresAt`, `subscriptionType`), `.claude.json` (`oauthAccount` mit
  E-Mail, Organisation, `organizationType`), `projects/<cwd mit - statt Sonderzeichen>/<id>.jsonl`,
  `file-history/<id>/`. Ohne die Variable liegt `.claude.json` im Home-Ordner statt in `~/.claude`.
  `.claude.json` kann noch den vorigen Login nennen; Nexa nimmt ihn nur, wenn der Plan passt.
- **Token und Key**: `CLAUDE_CODE_OAUTH_TOKEN` (aus `claude setup-token`, ein Jahr gültig) bzw.
  `ANTHROPIC_API_KEY`. Nexa entfernt beide (und weitere Anmelde-Variablen) aus der Umgebung von
  Accounts, die sie nicht nutzen.
- **`claude auth login`** ohne Terminal (stdio als Pipes): öffnet den Browser selbst und schreibt den Link
  als OSC-8-Terminal-Link (`ESC ] 8 ;; url BEL`) sowie `Paste code here if prompted >`. Ein Code aus dem
  Browser geht als Zeile über stdin. Exit-Code 0 heißt angemeldet, der Login steht dann in
  `.credentials.json`.
- **Limits**: `GET https://api.anthropic.com/api/oauth/usage` mit `Authorization: Bearer <accessToken>`
  und `anthropic-beta: oauth-2025-04-20`. Ältere Antworten: `five_hour` / `seven_day` mit `utilization`
  und `resets_at`; neuere zusätzlich `limits[]` mit `kind` (`session`, `weekly_all`, `weekly_<modell>`),
  `percent`, `resets_at` und `scope.model.display_name`. Nur mit Browser-Login (nicht mit Setup-Token
  oder Key); 429 mit `retry-after`, Nexa wartet dann je Account. Ohne Browser-Login kommen die Limits wie
  bisher aus `rate_limit_event`.

## Codex (`codex app-server`)

Ein Prozess je Account für alle seine Sessions, JSON-RPC 2.0 über stdio
(`codex app-server --listen stdio://`, mit `CODEX_HOME` des Accounts).

- **Start**: `initialize`, danach `account/read` (Anmeldung, Plan) und `account/rateLimits/read`.
- **Session**: `thread/start` bzw. `thread/resume` mit `cwd`, `approvalPolicy`, `sandbox`,
  `developerInstructions` und `config` mit dem MCP-Server von Nexa (gepunktete Schlüssel, gelten nur für
  diesen Thread):
  - `mcp_servers.nexa.url`
  - `mcp_servers.nexa.http_headers = { Authorization: "Bearer <token>" }`: ein Token je Thread, so
    erkennt der Server den Chat, auch wenn sich mehrere Threads einen App-Server teilen. Geprüft mit
    codex-cli 0.169: Codex schickt den Header bei jeder Anfrage, zwei Threads eines App-Servers jeweils
    ihren eigenen; `thread/resume` (auch nach `thread/unsubscribe`) verbindet den Server neu mit dem
    Token aus der Resume-Konfiguration. Das Token landet nicht im Rollout.
  - `mcp_servers.nexa.tool_timeout_sec = 900`: Codex bricht MCP-Aufrufe sonst nach etwa 60 s ab; ein
    Browser-Werkzeug wartet z. B., solange der Nutzer den Browser übernommen hat.
  - `mcp_servers.nexa.tools.<werkzeug>.approval_mode`: `approve` für die Werkzeuge ohne Rückfrage,
    `prompt` für die heiklen Browser-Werkzeuge (außer im Modus „Vollzugriff“).
- **Turn**: `turn/start`; während ein Turn läuft, gehen weitere Nachrichten über `turn/steer`.
  `turn/interrupt` bricht ab.
- **Benachrichtigungen**: `turn/started`, `turn/completed`, `item/started`, `item/completed`,
  `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`,
  `item/commandExecution/outputDelta`, `turn/plan/updated`, `thread/tokenUsage/updated`,
  `thread/compacted`, `model/rerouted`, `account/rateLimits/updated`.
- **Anfragen vom Server** (Antwort nötig): `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`.
- **Befehle**: `commandExecution.command` ist unter Windows die ganze Shell-Zeile
  (`"…\powershell.exe" -Command '…'`). Nexa zeigt stattdessen `commandActions[].command` an und
  erkennt Lesen (`read` mit `path`), Auflisten (`listFiles`) und Suchen (`search` mit `query`, `path`) als
  eigene Werkzeugart. Ohne `commandActions` wird die Shell-Hülle entfernt (`unwrapShell`).
- **Dateiänderungen**: `fileChange.changes[]` mit `path`, `kind` und Unified Diff.

### Accounts und Login

- **Ordner**: `CODEX_HOME` mit `auth.json` (`tokens.id_token`, `tokens.access_token` als JWT; Konto,
  Plan `chatgpt_plan_type` und Workspaces stehen in den Claims unter `https://api.openai.com/auth`,
  oder `OPENAI_API_KEY`), `config.toml` und `sessions/<jjjj>/<mm>/<tt>/rollout-<zeit>-<thread-id>.jsonl`.
- **Schlüsselbund**: Ohne `cli_auth_credentials_store = "file"` kann Codex den Login im Schlüsselbund
  des Systems ablegen, gemeinsam für alle Ordner. Nexa schreibt die Zeile in jeden neuen Account-Ordner.
- **`codex login`** ohne Terminal: startet einen lokalen Server auf `http://localhost:1455` (nennt ihn
  zuerst, dann den Link zu `auth.openai.com`) und öffnet den Browser. Exit-Code 0 heißt angemeldet. Weil
  der Port fest ist, läuft immer nur ein Codex-Login.
- **Wechsel des Accounts**: Nexa kopiert den Rollout an dieselbe Stelle unter `sessions/` des neuen
  Ordners und setzt mit `thread/resume { threadId, path }` fort; der App-Server des neuen Accounts findet
  den Thread sonst nicht.
- **Limits**: `account/rateLimits/read` je App-Server; `account/rateLimits/updated` kommt vom Server des
  Accounts, der gerade arbeitet. Für Accounts ohne laufenden Server fragt Nexa nur beim ausdrücklichen
  Aktualisieren (startet dafür den Server).

## Nexa-MCP-Server

Streamable HTTP auf `127.0.0.1:<port>/mcp`, Bearer-Token. Jeder Run bekommt ein eigenes Token, das seinen
Chat nennt (`McpCaller.sessionId`): Claude über `--mcp-config`, Codex über `http_headers` des Threads
(siehe oben). Werkzeuge: `render_chart`, `render_diagram`, `render_table`, `render_stats`, `render_callout`.
Der Aufruf wird als Werkzeugzeile angezeigt, das Ergebnis als `render`-Item direkt darunter (Specs in
`src/shared/render.ts`).

Dazu die Browser-Werkzeuge aus dem Claude Manager (Einstellung „Browser neben dem Chat“), sie bedienen
den Browser des Chats, zu dem das Token gehört: `browser_navigate`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_fill_form`, `browser_select_option`, `browser_hover`, `browser_drag`,
`browser_press_key`, `browser_scroll`, `browser_find`, `browser_wait_for`, `browser_take_screenshot`,
`browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_network_request`,
`browser_inspect`, `browser_check_accessibility`, `browser_emulate`, `browser_performance`,
`browser_route`, `browser_storage`, `browser_clear_site_data`, `browser_file_upload`,
`browser_handle_dialog`, `browser_history`, `browser_resize`, `browser_tabs`, `browser_pdf_save`,
`browser_generate_test`. Heikel (fragen vorher, `SENSITIVE_BROWSER_TOOLS`): die, die über die Seite
hinausgreifen (Skripte, Cookies und Speicher, Uploads, Inhalte von Anfragen, Daten löschen). Die
Anleitung für die Agents steht in `instructions` der Initialisierung (`BROWSER_INSTRUCTIONS`) und kurz im
Systemprompt.

Ein `tools/call` mit `Accept: text/event-stream` wird als SSE beantwortet: bis das Ergebnis kommt, hält
alle 20 s ein Kommentar (`: keepalive`) die Verbindung offen, dann folgt `event: message` mit der
JSON-RPC-Antwort. Browser-Aktionen können lange dauern (Warten auf die Seite, Übernahme durch den Nutzer).
