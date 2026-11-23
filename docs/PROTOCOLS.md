# Protokolle der CLIs

Was Nexa von den CLIs nutzt und welche Eigenheiten dabei auffielen. Bei neuen CLI-Versionen hier
nachtragen, was sich geändert hat.

## Claude Code (`claude -p`)

Ein Prozess je Session:

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --include-partial-messages --forward-subagent-text
       --permission-prompt-tool stdio --permission-mode <modus>
       [--model …] [--effort …] [--resume <id> [--fork-session [--resume-session-at <uuid>]]]
       [--append-system-prompt …]
       [--mcp-config <json> --allowedTools=<mcp__nexa__…,…>] [--no-chrome] [--add-dir=<ordner> …]
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
  der nächste Turn startet mit `--resume`. Ebenso Ultracode: `--settings '{"ultracode":true}'` (bzw.
  `false`) gilt für den Prozess, ohne die Option gilt, was in den Einstellungen der CLI steht.
- **Befehle für die Eingabe**: Die Antwort auf `initialize` enthält `commands` (`name`, `description`,
  `argumentHint`, `aliases`), also was im Modus `-p` geht, Skills und eigene Befehle eingeschlossen.
  Prompts der MCP-Server heißen `server:prompt (MCP)` und kommen erst, wenn ihr Server verbunden ist:
  `system/commands_changed` mit der ganzen Liste. Aufgerufen wird ein Befehl als Text am Anfang des
  Prompts (`/<name> …`, ein MCP-Prompt mit „ (MCP)“ im Namen). Nexa fragt einen kurzen eigenen Prozess
  (`--no-session-persistence`, nur `initialize`) je Account und Ordner und hört ihm 20 s auf
  `commands_changed` zu (`claude-probe.ts`).
- **Vorgaben eines Modells**: `get_settings` liefert unter `applied` den Denkaufwand ohne `--effort`
  (`effort`, abhängig von Modell und Einstellungen) sowie `ultracode` und `ultracodeAvailable`. `set_model`
  im selben Prozess behält den bisherigen Denkaufwand, deshalb fragt Nexa einen Prozess je Modell
  (`--model`).
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
- **Slash-Befehle** (geprüft mit 2.1.330): `initialize` und `system/commands_changed` nennen nur, was im
  Stream-Modus geht. Lokale Befehle antworten mit einer `assistant`-Nachricht von `model: "<synthetic>"`
  und einem `result` ohne Usage: `/context` (Markdown-Tabelle), `/usage` und `/cost` (Limits und
  Verbrauch), `/mcp` (nur eine Zeile mit der Zahl der Server), `/model` ohne Namen (Liste der Kürzel),
  `/config` ohne `key=value` (die Schlüssel), `/fast` („not available in the Agent SDK“). Was es nur im
  Terminal gibt, kennt er nicht und sagt „/diff isn't available in this environment.“ (ebenso `/status`,
  `/help`). `/rename <Titel>` meldet `system/session_title_changed`. `/clear` meldet `conversation_reset`
  (`new_conversation_id`, `trigger: "clear"`) und danach ein neues `system/init` mit neuer `session_id`:
  eine neue Unterhaltung, von der der Chat nichts weiß. Deshalb führt Nexa diese Befehle selbst aus,
  bevor sie die CLI erreichen (renderer `lib/chat-commands.ts`); `/compact`, `/context`, `/usage`,
  `/init` und die Skills gehen weiter an Claude Code.
- **Abzweigen** (geprüft mit 2.1.330): `--resume <id> --fork-session` setzt eine Kopie der Unterhaltung
  unter neuer ID fort; `system/init` nennt gleich die neue `session_id`, die alte Datei bleibt unberührt.
  `--resume-session-at <uuid>` (versteckt, im Agent SDK `resumeSessionAt`) nimmt die Unterhaltung nur
  bis zu diesem Eintrag mit, der neue Prompt hängt direkt daran (`parentUuid`). Nexa merkt sich beim
  Abzweigen die letzte `assistant`-Zeile des Hauptstrangs ohne `tool_use` (`forkPoint`), damit kein
  Aufruf ohne Ergebnis übrig bleibt und spätere Turns des anderen Chats nicht mitkommen.
- **Zusammenfassen des Kontexts** (automatisch oder mit `/compact`; geprüft mit 2.1.330):
  `system/status` mit `status: "compacting"` beim Start und danach alle 30 s erneut, am Ende `status: null`
  mit `compact_result` (`success`, `failed`, dann ggf. `compact_error`). Danach `system/compact_boundary`
  mit `compact_metadata`: `trigger` (`auto`, `manual`), `pre_tokens`, `post_tokens`, `duration_ms`. Das
  `result` von `/compact` hat keine Usage; Nexa setzt den Kontext auf `post_tokens`. `status` kommt auch
  mit anderen Werten (`requesting`) und mit `null` bei einem Wechsel des Freigabe-Modus.
- `--allowedTools` nennt Nexas Werkzeuge einzeln (in der `=`-Form, sonst nimmt die Option die folgenden
  Argumente mit). Nicht genannte, z. B. die heiklen Browser-Werkzeuge, fragen über `can_use_tool` und
  erscheinen als Freigabe im Chat. `--no-chrome` schaltet „Claude in Chrome“ ab, damit Claude den
  Browser von Nexa nimmt (Einstellung „Ohne ‚Claude in Chrome‘“, nur mit eingeschalteten Browser-Werkzeugen).
- **Kontext**: Die Usage im `result` summiert alle API-Aufrufe eines Turns (mit Werkzeugen schnell ein
  Vielfaches des Fensters). Den Kontext gibt die `usage` der letzten `assistant`-Nachricht des Hauptchats
  (ohne `parent_tool_use_id`): `input_tokens + cache_creation_input_tokens + cache_read_input_tokens +
  output_tokens`. Genau und aufgeschlüsselt: `get_context_usage { detail: "summary" }` liefert
  `categories[]` (`id` wie `system_prompt`, `system_tools`, `mcp_tools`, `memory_files`, `messages`,
  `autocompact_buffer`, `free_space`, mit `_deferred` für Werkzeuge, die erst bei Bedarf geladen werden;
  `name`, `tokens`), `totalTokens`, `maxTokens` (die Grenze aus den Einstellungen, z. B.
  `autoCompactWindow`, nicht das Fenster des Modells), `autoCompactThreshold`, `isAutoCompactEnabled`,
  `mcpTools[]` (`name`, `serverName`, `tokens`, `isLoaded`), `agents[]`, `memoryFiles[]` (`path`, `type`,
  `tokens`) und `skills`. Nexa fragt danach am Ende jedes Turns (`claude-context.ts`).
- **MCP-Server**: `mcp_status` liefert `mcpServers[]` (`name`, `status`: `connected`, `failed`,
  `needs-auth`, `pending`, `disabled`; `scope`, `tools[]`, `error`). `mcp_toggle { serverName, enabled }`
  schaltet einen Server im laufenden Prozess; geprüft mit 2.1.330: Claude Code speichert das nicht
  (`.claude.json` bleibt gleich), Nexa schickt es deshalb nach jedem Start für die Server, die im Projekt
  aus sind. Ohne laufenden Chat fragt Nexa einen kurzen Prozess (`initialize`, gut 2 s warten, bis die
  Server verbunden sind, dann `mcp_status`). Weitere Untertypen, die Nexa noch nicht nutzt:
  `mcp_reconnect`, `mcp_authenticate`, `reload_plugins`, `rewind_files`, `cancel_async_message`
  (eine eingereihte Nachricht zurücknehmen), `mcp_read_resource`, `apply_flag_settings`,
  `get_session_cost`, `set_cwd`.
- **Weitere Ordner**: `--add-dir=<ordner>` (je Ordner einmal) gibt Claude Zugriff außerhalb des
  Arbeitsordners; gilt für den Prozess, Nexa startet ihn bei einer Änderung neu.

### Accounts, Login und Limits

- **Ordner**: `CLAUDE_CONFIG_DIR` legt alles in einen Ordner: `.credentials.json` (`claudeAiOauth` mit
  `accessToken`, `refreshToken`, `expiresAt`, `subscriptionType`), `.claude.json` (`oauthAccount` mit
  E-Mail, Organisation, `organizationType`), `projects/<cwd mit - statt Sonderzeichen>/<id>.jsonl`,
  `file-history/<id>/`. Ist der Name des Projektordners länger als 200 Zeichen, kürzt Claude Code ihn
  und hängt einen Hash des Pfads an (`claudeProjectKey`). Ohne die Variable liegt `.claude.json` im Home-Ordner statt in `~/.claude`.
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

### Transkripte (`projects/<key>/<id>.jsonl`)

Was Claude Code selbst speichert und Nexa beim Übernehmen liest (`claude-transcript.ts`):

- Je Zeile ein Eintrag. `user` und `assistant` mit `uuid`, `timestamp`, `cwd`, `message` wie in der API;
  ein Antwort-Block je Zeile, mehrere Zeilen teilen `message.id` (Usage je `message.id` einmal zählen).
  `message.model: "<synthetic>"` sind Meldungen von Claude Code selbst. `isMeta` (eingefügte Skills und
  Ähnliches) und `isSidechain` (Subagents in älteren Versionen) gehören nicht zum Hauptchat.
- Was der Nutzer tippte: Tags herausnehmen (`system-reminder`, `local-command-*`, `command-message`,
  `bash-stdout`/`bash-stderr`, `task-notification` …). Slash-Befehle stehen als `<command-name>` und
  `<command-args>`, `! befehl` als `<bash-input>` mit der Ausgabe als eigener Eintrag
  (`<bash-stdout>`, `<bash-stderr>`), Abbrüche als `[Request interrupted by user …]`, eingefügter Text
  als `<pasted_content id="…">`. `isCompactSummary` ist die Zusammenfassung nach `/compact`.
- `system`: `compact_boundary` (`compactMetadata.trigger`, `preTokens`, bei neueren Versionen auch
  `postTokens` und `durationMs`), `turn_duration` (`durationMs`
  am Ende eines Turns), `local_command` (Slash-Befehle neuerer Versionen).
- Titel: `custom-title` (`/rename`), `ai-title`, älter `summary`; `relocated.relocatedCwd`, wenn die
  Session in einen anderen Ordner zog (`--resume` geht nur von dort). Nexa schreibt diesen Eintrag
  selbst, wenn es einen Chat verschiebt (`{"type":"relocated","sessionId","relocatedCwd"}`), nachdem das
  Transkript und der Ordner `<id>/` daneben in den Projektordner des neuen Ordners gewandert sind.
- Hintergrund-Agents: das `tool_result` ist „Async agent launched …“, das Ende ein Eintrag des Nutzers
  mit `<task-notification>` (`<tool-use-id>`, `<status>` `completed`/`failed`/`killed`, `<summary>`,
  `<result>`). Die Arbeit eines Subagents liegt in `<id>/subagents/agent-<agentId>.jsonl`, sein Aufruf in
  `agent-<agentId>.meta.json` (`toolUseId`, `agentType`).
- Viele Zeilen braucht der Chat nicht (`api-request*`, `file-history-*`, `permission-mode`, `mode`,
  `queue-operation` …); sie sind der größte Teil der Datei und werden am Zeilenanfang erkannt und
  übersprungen.
- **Ende eines Turns**: `message.stop_reason` jeder `assistant`-Zeile, `tool_use` mitten im Turn, sonst
  (`end_turn`, `max_tokens` …) die letzte Antwort; dazu `[Request interrupted by user …]` und, wo
  vorhanden, `turn_duration`. `--resume` schreibt in dieselbe Datei weiter (dieselbe Session-ID; nur
  `--fork-session` legt eine neue an).
- **Abgleich** (`transcriptSince`, `SessionService.syncCli`): Der Link des Chats merkt sich in `synced`,
  bis wann (ms) der Chat das Transkript kennt, gesetzt am Ende jedes Turns in Nexa und nach jedem
  Abgleich. Neuer ist, was außerhalb dazukam. Nexa liest die Datei von hinten bis zur ersten
  `user`/`assistant`/`system`-Zeile, die nicht neuer ist (Titel und Buchhaltung schreibt Claude Code auch
  später mit älterer oder ohne Zeit), und schneidet nach dem letzten Turn-Ende ab: Ein Turn, der noch
  läuft, kommt erst, wenn er fertig ist. Ergebnisse und Benachrichtigungen zu Aufrufen, die der Chat schon
  hat (ein Hintergrund-Agent aus Nexa), landen auf diesen Items. Gleiche mtime: nicht neu gelesen.

### Laufende Sitzungen (`<config>/sessions/<pid>.json`)

Jeder Prozess von Claude Code legt für seine Laufzeit eine Datei an: `pid`, `sessionId`, `cwd`,
`kind: "interactive"`, `entrypoint` (`cli` im Terminal, `claude-desktop`, `claude-vscode`, `sdk-ts` für
Nexa und andere SDK-Programme), `status`. Nach einem Absturz bleibt sie liegen; ob der Prozess noch
lebt, zeigt erst `process.kill(pid, 0)` (EPERM heißt: lebt, unter anderem Benutzer). Nexa nimmt den
eigenen Prozess des Chats aus und zeigt sonst „Auch in … offen“ (`claude-presence.ts`). Zwei Prozesse auf
einer Sitzung schreiben beide ins Transkript, und jeder macht mit dem weiter, was er kennt.

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
  - `mcp_servers.<name>.enabled = false` für die MCP-Server, die im Projekt aus sind (nur Namen aus
    Buchstaben, Ziffern, `_` und `-`, sonst bricht der gepunktete Schlüssel).
- **MCP-Server**: `mcpServerStatus/list` liefert `data[]` mit `name`, `runtimeStatus`, `authStatus`,
  `tools` (Objekt je Werkzeug) und `serverInfo`; dabei ist `codex_apps`, Codex' eigener Server für die
  Apps, den Nexa nicht anzeigt. Umschalten geht nur über die Konfiguration des Threads, also ab dem
  nächsten Start des Threads.
- **Turn**: `turn/start`; während ein Turn läuft, gehen weitere Nachrichten über `turn/steer`.
  `turn/interrupt` bricht ab. Weitere Ordner zum Schreiben stehen in `sandboxPolicy.writableRoots`
  (`{ type: "workspaceWrite", writableRoots, networkAccess }`) von `turn/start`.
- **Benachrichtigungen**: `turn/started`, `turn/completed`, `item/started`, `item/completed`,
  `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`,
  `item/commandExecution/outputDelta`, `turn/plan/updated`, `thread/tokenUsage/updated`,
  `thread/compacted`, `model/rerouted`, `account/rateLimits/updated`.
- **Zusammenfassen des Kontexts**: ein Item `contextCompaction` (`id`, `startedAtMs`, `completedAtMs`)
  mit `item/started` und `item/completed`, ohne Tokens oder Anlass (geprüft mit 0.169). Dazwischen kommt
  `thread/tokenUsage/updated` mit `last.inputTokens` und `last.outputTokens` 0; Nexa nimmt als Größe
  vorher die letzte Meldung davor. `thread/compacted` ist veraltet und kam in 0.169 nicht mehr; Nexa zeigt
  es nur ohne Items. `thread/compact/start { threadId }` startet es von Hand (Nexas `/compact`) und
  antwortet sofort mit `{}`; es läuft dann als eigener Turn: `turn/started`, das Item, `turn/completed`.
- **Abzweigen**: `thread/fork` nimmt dieselben Parameter wie `thread/resume` (auch `path`) und dazu
  `lastTurnId`: nur die Turns bis einschließlich diesem (er darf nicht mehr laufen). Die Antwort sieht aus
  wie die von `thread/resume`, mit der neuen `thread.id`. Ein unbekannter Turn ergibt den Fehler
  „turn not found: …“; Nexa zweigt dann den ganzen Thread ab. Mit `ephemeral: true` (nichts wird
  gespeichert) verlangt der Server `excludeTurns: true`. Geprüft mit 0.169.
- **Slash-Befehle** kennt der App-Server nicht: `/…` ginge als Text an das Modell. Nexa führt seine eigenen
  aus (renderer `lib/chat-commands.ts`), die Skills kommen mit `skills/list` und gehen als `$name`.
- **Anfragen vom Server** (Antwort nötig): `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`.
- **Befehle**: `commandExecution.command` ist unter Windows die ganze Shell-Zeile
  (`"…\powershell.exe" -Command '…'`). Nexa zeigt stattdessen `commandActions[].command` an und
  erkennt Lesen (`read` mit `path`), Auflisten (`listFiles`) und Suchen (`search` mit `query`, `path`) als
  eigene Werkzeugart. Ohne `commandActions` wird die Shell-Hülle entfernt (`unwrapShell`).
- **Dateiänderungen**: `fileChange.changes[]` mit `path`, `kind` und Unified Diff.
- **Skills**: `skills/list { cwds }` liefert `data[].skills[]` (`name`, `description`, `shortDescription`,
  `interface.shortDescription`, `path`, `scope`, `enabled`), `skills/changed` meldet Änderungen. Im Prompt
  steht ein Skill als `$name`; Nexa hängt dazu `{ type: "skill", name, path }` an die Eingabe von
  `turn/start` bzw. `turn/steer`. Die Slash-Befehle der TUI kennt der App-Server nicht.

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
