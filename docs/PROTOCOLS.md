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

- **Eingabe**: `{"type":"user","uuid":"…","message":{"role":"user","content":[…]}}` je Zeile, Bilder als
  `image`-Blöcke (Base64).
- **Warteschlange** (geprüft mit 2.1.330): Zu jeder Eingabe mit `uuid` meldet Claude Code
  `{"type":"command_lifecycle","command_uuid":…,"state":…}`: `queued`, `started`, `completed` oder
  `cancelled`. Eine Nachricht, die während eines Turns kommt, bleibt `queued` und wird am nächsten
  Werkzeugergebnis desselben Turns `started` (im Transkript `queue-operation` `remove` mit
  `reason: "absorbed_mid_turn"` und ein `attachment` vom Typ `queued_command`). Nach einem `interrupt`
  nennt die Antwort `still_queued: [uuid…]`; dann kommt das `result` des abgebrochenen Turns, `cancelled`
  für den alten Befehl und `started` für den wartenden, der als eigener Turn läuft. Nexa zeigt eine
  solche Nachricht bis `started` unter dem Chat und setzt sie dann an dieser Stelle in den Verlauf.
  „Jetzt senden“ an der ersten wartenden schickt genau dieses `interrupt` (wie Strg+X Strg+S in der TUI).
  `--replay-user-messages` würde die Nachricht beim Aufnehmen noch einmal ausgeben (`isReplay: true`),
  Nexa braucht das nicht.
- **Turn ohne Prompt** (geprüft mit 2.1.331): Endet eine Shell oder ein Agent im Hintergrund, nachdem der
  Turn vorbei ist, macht Claude Code von sich aus weiter: `system/task_notification`, `system/init`,
  `system/status` (`requesting`), dann die Antwort (`stream_event` `message_start` ohne
  `parent_tool_use_id`) und am Ende ein `result`, aber kein `command_lifecycle`. Nexa zählt die erste
  Antwort im Hauptchat ohne laufenden Turn als dessen Beginn (`ownTurn`), sonst stünde der Chat still,
  während Claude Code arbeitet, und bliebe nach einer Rückfrage darin auf „wartet“. Antworten eines
  Agents (mit `parent_tool_use_id`) beginnen keinen Turn. Fragt ein Agent im Hintergrund nach dem Turn,
  ist der Chat nach der Antwort wieder in Ruhe (`idle`) statt auf „wartet“. `generate_session_title` und
  `get_context_usage` nach einem Turn schicken nur ihre `control_response`.
- **Vorschlag für den nächsten Prompt** (abgelesen an 2.1.331, nicht an einem echten Turn geprüft):
  `promptSuggestions: true` im `initialize` (oder `--prompt-suggestions`) schaltet ihn ein. Nach jedem
  Turn kommt dann, etwas nach dem `result`, `{"type":"prompt_suggestion","suggestion":"…","uuid",
  "session_id"}`.
  - **Erzeugung**: Claude Code fragt dafür dasselbe Modell noch einmal, mit dem Gespräch aus dem Cache
    (kein Cache-Schreiben), ohne Werkzeuge und mit festem Auftrag: vorhersagen, was der Nutzer tippen
    würde, 2–12 Wörter, sonst nichts. Antworten im Ton von Claude, Fragen und Lob verwirft es.
  - **Kein Vorschlag**: in den ersten zwei Antworten, nach einer fehlgeschlagenen, bei offener Freigabe
    oder Rückfrage, im Plan-Modus, kurz vor dem Limit, ohne Cache-Treffer und nach mehr als 8 Turns, in
    denen der Nutzer nicht da war.
  - **Freigabe**: Die Einstellung `promptSuggestionEnabled` von Claude Code (ab Werk an) gilt; bei
    Abo-Accounts entscheidet zusätzlich ein Feature-Flag des Servers. `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION`
    erzwingt ihn (`1`) oder schaltet ihn ab (`0`); Nexa setzt die Variable nicht.
  - **Pause**: `set_prompt_suggestions_paused { paused }` hält ihn zur Laufzeit an, gedacht für Hosts ohne
    sichtbare Eingabe. Abschalten ginge nur mit einem neuen `initialize`. Deshalb fragt Nexa immer danach
    und pausiert, solange die Einstellung „Vorschlag für den nächsten Prompt“ aus ist.
  - **Anzeige**: Nexa zeigt den Vorschlag grau im leeren Eingabefeld (Tab übernimmt), bis der nächste
    Prompt oder Turn beginnt; einen, der erst während des nächsten Turns kommt, verwirft es.
- **Ausgabe**: `system/init` (Sitzungs-ID, Modell, Werkzeuge), `stream_event` (Teil-Deltas für Text und
  Thinking), `assistant`/`user` (fertige Blöcke, `tool_use`/`tool_result`), `result` (Turn-Ende mit
  Kosten und Tokens), `rate_limit_event` (Usage-Fenster mit Prozent und Reset).
- **Start ohne Prompt** (geprüft mit 2.1.331): `system/init` kommt erst mit dem ersten Prompt; vorher
  antwortet Claude Code nur auf Control-Requests (`initialize`) und schickt `system/commands_changed`.
  Startet Nexa die CLI ohne Prompt neu („Chat neu starten“), gilt sie mit der Antwort auf `initialize` als
  bereit.
- **Ergebnis eines Werkzeugs** (geprüft mit 2.1.331): Die `user`-Nachricht mit dem `tool_result` trägt
  daneben `tool_use_result`, das ganze Ergebnis-Objekt des Werkzeugs (im Transkript `toolUseResult`). Bei
  `Edit`, `MultiEdit` und `Write` steht darin `structuredPatch` (`oldStart`, `oldLines`, `newStart`,
  `newLines`, `lines` mit ` `/`-`/`+` davor), `filePath`, `originalFile` und bei `Write` `type` (`create`,
  `update`). Nexa nimmt daraus den Diff mit den Zeilennummern der Datei (`changesFromResult`); `old_string`
  und `new_string` der Eingabe zählen nur ab ihrer eigenen ersten Zeile.
- **Control-Protokoll** (`control_request`/`control_response`):
  - an Claude: `initialize`, `interrupt`, `set_model`, `set_permission_mode`, `get_task_output`,
    `stop_task`
  - von Claude: `can_use_tool` (Freigabe, Antwort `allow` mit ggf. geänderter Eingabe oder `deny` mit
    Nachricht). `AskUserQuestion` und `ExitPlanMode` kommen ebenfalls hierüber und werden als Frage bzw.
    Plan angezeigt.
  - `control_cancel_request` (`request_id`) zieht eine offene Anfrage zurück, etwa im Auto-Modus, wenn
    der Klassifikator das Werkzeug doch selbst freigibt. Der Turn läuft dann weiter. Ist danach keine
    Frage mehr offen, steht der Chat wieder auf „arbeitet“ statt auf „wartet“.
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
- **Ausgabedateien und Kodierung**: Eine Shell im Hintergrund schreibt in `…\tasks\<task_id>.output` im
  Temp-Ordner von Claude Code; den Pfad nennt das `tool_result` („Output is being written to: …“, je nach
  Fall auch ohne Doppelpunkt) und `task_notification.output_file` (erst am Ende; `task_started` hat ihn
  nicht). Im Vordergrund gibt es keine Datei. Claude Code liest alles als UTF-8; Windows-Konsolenprogramme
  (ping, ipconfig …) schreiben ohne Konsole aber in der DOS-Codepage (850), ihre Umlaute kommen in
  `get_task_output`, im `tool_result` und in einem `Read` der Datei als `�` an. Ein `Read` solcher Dateien
  hängt „[This file is not valid UTF-8: …]“ an. Nexa liest die Datei deshalb selbst
  (`providers/claude/output-encoding.ts`): die Ausgabe für `shellOutput` und die `�`-Zeilen eines `Read`,
  jede nur, wenn die Bytes noch genau die Zeile ergeben, die Claude Code gelesen hat.
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
  Aufruf ohne Ergebnis übrig bleibt und spätere Turns des anderen Chats nicht mitkommen. Beim Bearbeiten
  eines Prompts weiter oben endet sie an der letzten Zeile der Nachricht davor: Jede Zeile trägt die
  `message.id` der API (`msg_…`), dieselbe wie `api_message_id` im Stream, und ein Block einer Nachricht
  steht je in einer eigenen Zeile mit eigener `uuid`.
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
  `cancel_async_message` (eine eingereihte Nachricht zurücknehmen), `apply_flag_settings`,
  `get_session_cost`, `set_cwd`; zu `rewind_files` und `rewind_conversation` siehe „Checkpoints“.
  `mcp_read_resource` und `mcp_call` siehe „MCP Apps“.
- **Checkpoints** (geprüft am Binary von 2.1.332): Mit `-p` legt Claude Code keine Sicherungen unter
  `file-history/<id>/` an, außer mit der Umgebungsvariablen `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`
  (`CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING` oder `fileCheckpointingEnabled: false` in den Einstellungen
  schalten sie ganz ab). Dann setzt `rewind_files { user_message_id, dry_run? }` die Dateien auf den Stand
  vor der Nachricht `user_message_id` (ihre `uuid` im Transkript) und antwortet mit `{ canRewind, error?,
  filesChanged?, insertions?, deletions?, skippedLinks? }`; `rewind_conversation { target_message_uuid }`
  kürzt die Unterhaltung. Gesichert ist nur, was Claude Code mit seinen eigenen Werkzeugen schreibt, nicht
  was ein Befehl in `Bash` ändert. Nexa nutzt beides nicht, sondern eigene Checkpoints für alle CLIs
  (unten, „Checkpoints (Nexa)“).
- **Neu verbinden und Anmelden** (geprüft mit 2.1.330): `mcp_reconnect { serverName }` antwortet ohne
  Inhalt, sobald der Server wieder verbunden ist, sonst mit dem Fehler des Servers.
  `mcp_authenticate { serverName }` antwortet mit `authUrl`, `requiresUserAction` und
  `callbackExpected`. Bei einem claude.ai-Konnektor ist es eine Seite auf claude.ai
  (`…/mcp/start-auth/<server>`), `callbackExpected: false`: Man meldet sich dort an, danach verbindet
  `mcp_reconnect` den Server im laufenden Prozess (ein neuer Prozess holt die Konnektoren ohnehin frisch).
  Bei eigenem OAuth des Servers wartet der Prozess selbst auf die Weiterleitung des Browsers
  (`callbackExpected: true`, dazu `redirectScheme`, `state`, `callbackPort`); er muss also laufen, bis die
  Anmeldung durch ist. Ohne laufenden Chat hält Nexa dafür einen eigenen Prozess bis zu 5 min offen und
  fragt `mcp_status`, bis der Server verbunden ist. `requiresUserAction: false` ohne `authUrl`: schon
  angemeldet.
- **Plugins** (geprüft mit 2.1.330): `claude plugin list --json` (im Ordner des Chats, mit der Umgebung
  des Accounts, knapp 1 s) nennt jede Installation: `id` (`<plugin>@<marktplatz>`), `version`, `scope`
  (`user`, `project`, `local`), `projectPath` (bei `project` und `local`), `installPath`, `mcpServers` und
  `enabled`, so wie die Einstellungen aus diesem Ordner gesehen sagen. Eingebaute Plugins (`@builtin`)
  stehen nicht darin. Name und Beschreibung stehen im Manifest `<installPath>/.claude-plugin/plugin.json`.
  `claude plugin enable|disable <id> --json` schaltet wie `/plugin` im Scope der Installation
  (`--scope` erkennt es selbst) und antwortet mit einer Zeile `{"outcome":"ok","scope":…}`: Aus schreibt
  `enabledPlugins: { "<id>": false }` in `<config>/settings.json` (Scope `user`) bzw.
  `.claude/settings.local.json` (`local`), An nimmt den Eintrag wieder heraus. Der laufende Prozess lädt
  die Plugins mit `reload_plugins` neu; die Antwort enthält `commands`, `agents`, `plugins[]` (`name`,
  `path`, `source` = die ID, `version`; nur geladene), `mcpServers` und `error_count`. Neu geladene Server
  von Plugins sind wieder an, Nexa schaltet die im Projekt ausgeschalteten danach erneut ab.
- **Weitere Ordner**: `--add-dir=<ordner>` (je Ordner einmal) gibt Claude Zugriff außerhalb des
  Arbeitsordners; gilt für den Prozess, Nexa startet ihn bei einer Änderung neu.
- **Titel** (geprüft mit 2.1.330): Claude Code benennt eine Session selbst, auch mit `-p`. Etwa 2 s nach dem
  ersten Prompt schreibt es `{"type":"ai-title","aiTitle":"…"}` ins Transkript, in der Sprache des
  Chats. Auf stdout kommt dazu nichts: `system/session_title_changed` gibt es nur bei `/rename` und im
  Remote-Modus. `generate_session_title { description, persist }` antwortet mit `{ title }`. Mit
  `persist: false` ist der Titel jedes Mal neu erzeugt und wird nicht gespeichert. Mit `persist: true`
  kommt der gesetzte Name (`custom-title`), sonst der `ai-title`, sonst ein neuer, der als `ai-title`
  gespeichert wird. Gleich nach dem ersten Prompt gefragt, antwortet es in unter 1 s, und Claude Code
  schreibt danach keinen anderen `ai-title`. Nexa fragt so nach dem ersten Prompt (`description` ist der
  Prompt, auf 2000 Zeichen gekürzt). `rename_session { title, source }` setzt einen Namen wie `/rename`.
- **Aufgaben** (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`; neuere Versionen statt `TodoWrite`):
  Anders als `TodoWrite` trägt kein Aufruf die ganze Liste. `TaskCreate { subject, description,
  activeForm? }` legt eine Aufgabe an, ihre ID steht erst im Ergebnis („Task #3 created successfully: …“,
  `tool_use_result.task.id`); `TaskUpdate { taskId, status?, subject?, activeForm?, … }` ändert sie,
  `status: "deleted"` löscht sie; `TaskList` gibt alle („#1 [completed] Betreff [blocked by #2]“,
  `tool_use_result.tasks[]`). Es gibt eine Liste je Sitzung, Subagents eingeschlossen. Nexa führt sie in
  `ClaudeTasks` (`claude-tools.ts`) als Todo-Liste des Hauptchats (`todo:main`, Einträge mit `id`); ein
  neuer Run übernimmt sie aus dem Chat (`RunOptions.todos`), damit `TaskUpdate` nach einem Neustart
  greift. Die Formate stammen aus dem Quelltext, ein echter Aufruf lag nicht vor (ungeprüft).
- **Agents untereinander**: `SendMessage { to, summary?, message }` zeigt Nexa als „Nachricht an <to>“ mit
  dem Text (`ToolItem.text`), `ListAgents {}` als „Agenten auflisten“. `SubagentHandback { message }`
  (ein Subagent übergibt seinen Bericht, Ergebnis `{"success":true,"message":"Report delivered to your
  caller."}`) blendet Nexa aus: Derselbe Bericht ist das Ergebnis des Agents auf seiner Karte.

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
- **Login erneuern** (wie Claude Code beim Start, übernommen aus dem Claude Manager):
  `POST https://platform.claude.com/v1/oauth/token` mit JSON `{ grant_type: "refresh_token", refresh_token,
  client_id, scope }`; `client_id` ist `claudeAiOauth.clientId`, sonst der von Claude Code
  (`9d1c250a-e61b-44d9-88ed-5944d1962f5e`), `scope` die gespeicherten `scopes` mit Leerzeichen. Claude Code
  erneuert nur mit `user:inference` in `scopes` und solange `refreshTokenExpiresAt` (Ende des Logins, ms)
  nicht vorbei ist. Antwort: `access_token`, `expires_in` (s), meist ein neuer `refresh_token` (der alte
  gilt dann nicht mehr), `refresh_token_expires_in` (s), `scope`. In `.credentials.json` werden daraus
  `accessToken`, `refreshToken`, `expiresAt`, `refreshTokenExpiresAt`, `scopes`; alles andere der Datei
  (z. B. `mcpOAuth`) bleibt. 400 oder 401 mit `error: "invalid_grant"`: Der Refresh-Token ist verbraucht,
  widerrufen oder abgelaufen, nur neu anmelden hilft.
- **Sperre beim Erneuern**: Ein Refresh-Token geht nur einmal, darum erneuert Claude Code unter
  `<config>/.oauth_refresh.lock` und (ältere Versionen) `<config>.lock` neben dem Ordner (über `realpath`).
  Beides sind Ordner von proper-lockfile: angelegt mit `mkdir`, alle 5 s berührt (mtime), nach 60 s ohne
  Berührung verwaist und übernehmbar. Nexa nimmt beide (ohne Schreibrecht neben dem Ordner nur die erste,
  wie Claude Code), liest die Datei darunter noch einmal und schreibt atomar (Temp-Datei und Umbenennen,
  Modus 0600, kompaktes JSON), nur wenn sie noch den benutzten Refresh-Token hält.
- **Limits**: `GET https://api.anthropic.com/api/oauth/usage` mit `Authorization: Bearer <accessToken>`
  und `anthropic-beta: oauth-2025-04-20`. Ältere Antworten: `five_hour` / `seven_day` mit `utilization`
  und `resets_at`; neuere zusätzlich `limits[]` mit `kind` (`session`, `weekly_all`, `weekly_<modell>`),
  `percent`, `resets_at` und `scope.model.display_name`. Nur mit Browser-Login (nicht mit Setup-Token
  oder Key); 429 mit `retry-after`, Nexa wartet dann je Account. Ohne Browser-Login kommen die Limits wie
  bisher aus `rate_limit_event`.
- **Turn am Limit**: `rate_limit_event` mit `rate_limit_info.status: "rejected"`, dann eine eigene Antwort
  von Claude Code (`assistant` mit `error: "rate_limit"`, Text wie „You've hit your limit · resets …“)
  und ein `result` mit `is_error`. Nexa markiert den Turn dann mit `limit` (Benachrichtigung „Limit
  erreicht“, der Reset kommt aus den Usage-Fenstern des Accounts).

### Artefakte (claude.ai)

Was Claude Code mit seinem Werkzeug `Artifact` auf claude.ai veröffentlicht (Seiten und Dokumente), listet
Nexa je Account auf der Seite „Artefakte“ (`main/artifacts/artifact-service.ts`, wie der Claude Manager).

- **Liste**: `GET https://api.anthropic.com/api/frame/artifacts?rel=all|shared&kind=page,document&sort=last_viewed&limit=200`
  (weitere Seiten mit `page_token` aus `next_page_token`), Kopfzeilen wie Claude Code: `Authorization:
  Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`, `X-Frame-CP: go`, `X-Frame-Surface: code`,
  `X-Frame-Platform: cli`, `X-Frame-Client-Version: <Version von Claude Code>`. Wer `/artifacts` nicht
  bekommt, bekommt die ältere Liste `GET …/frames?limit=200`.
- **Felder** von `/artifacts`: `id` (UUID), `kind`, `rel` (`mine`, `shared`), `title`, `open_url`
  (`https://claude.ai/artifact/<kurze id>`), `audience` (`owner`, `users`, `org`, `public`),
  `created_at`, `updated_at`, `last_viewed_at`, `view_count` bzw. `public_view_count`, `thumbnail_url`
  und `thumbnail_dark_url` (JPEG von `<id>.frame.claudeusercontent.com` mit kurzlebigem Token im Link,
  ohne Anmeldung abrufbar), `owner_account` (UUID, keine E-Mail). `/frames` nennt die id `slug`, die
  Bilder `thumbImgURL`/`thumbDarkImgURL` und die Version `live` (`<Sekunden>-<Hash>`).
- **Werkzeug `Artifact`**: sein Ergebnis nennt den Link wie `open_url` („… at
  https://claude.ai/artifact/<kurze id> (Version 1, …)“), `toolUseResult` zusätzlich `artifact_id` (die
  UUID). Daran findet Nexa den Chat, aus dem ein Artefakt kam (`artifactLinks`, `artifactChatMap` in
  `shared/artifacts.ts`): den neuesten, in dem das Werkzeug es veröffentlicht hat, sonst den neuesten,
  der den Link nennt.
- **Umbenennen, löschen, anpinnen** (wie der Claude Manager, mit denselben Kopfzeilen):
  `POST …/frame/retitle/<id>` mit `{ title }` (bis 300 Zeichen); `DELETE …/frame/<id>`, 404 heißt schon
  weg, 409, 429 und 503 versucht Nexa einmal wieder (nach `retry-after`, höchstens 10 s);
  `POST`/`DELETE …/frame/favorite/<id>` pinnt an bzw. löst. Die Liste sagt mit `starsEnabled`, ob der
  Account Pins hat, je Artefakt `starred` (angepinnt) und `renamable` (fehlt es, darf der Eigentümer
  umbenennen); löschen darf nur der Eigentümer (`rel: mine`). 403 heißt: nicht erlaubt.
- Nur mit Browser-Login oder Setup-Token, nicht mit API-Key. Ein abgelaufenes Access-Token erneuert
  Nexa nicht selbst; das tut Claude Code beim nächsten Start mit dem Account.

### Spracheingabe (`/voice`)

Claude Code diktiert mit `/voice` über eine Spracherkennung von Anthropic; Nexa nutzt dieselbe für das
Mikrofon in der Eingabe, für Chats mit jeder CLI (`main/voice/voice-service.ts`). Abgelesen an Claude
Code 2.1.331 und mit einer Testaufnahme geprüft.

- **Verbindung**: WebSocket `wss://api.anthropic.com/api/ws/speech_to_text/voice_stream?encoding=linear16&sample_rate=16000&channels=1&endpointing_ms=300&utterance_end_ms=1000&language=<code>&use_conversation_engine=true`
  mit `Authorization: Bearer <accessToken>` (Browser-Login oder Setup-Token, kein API-Key), `x-app: cli`
  und optional `x-config-keyterms` (erwartete Wörter, durch Kommas getrennt, nur druckbares ASCII, höchstens
  1024 Zeichen). Ohne gültiges Token lehnt der Server das Upgrade ab.
- **Sprachen**: `en es fr ja de pt it ko hi id ru pl tr nl uk el cs da sv no`; Claude Code fällt bei
  anderen auf `en` zurück (Einstellung `language`, auch als Name wie „Deutsch“).
- **Hin**: Audio als Binärnachrichten (16-Bit-PCM little-endian, mono, 16 kHz; Nexa schickt 64 ms je
  Nachricht), dazu `{"type":"KeepAlive"}` gleich nach dem Öffnen und alle 8 s, damit eine Pause die
  Verbindung nicht beendet. `{"type":"CloseStream"}` beendet die Aufnahme; danach kein Audio mehr.
- **Zurück** (Text-JSON): `{"type":"TranscriptText","data":"…"}` (auch `TranscriptInterim`) ist die
  laufende Äußerung bisher, jedes Mal vollständig, nicht nur das neue Stück (`"Bitte"`, `"Bitte erstelle"`
  …). `{"type":"TranscriptEndpoint"}` schließt sie ab; die nächste `TranscriptText` beginnt eine neue.
  Fehler kommen als `{"type":"TranscriptError","description"|"error_code":…}` oder
  `{"type":"error","message":…}`.
- **Ende**: Nach `CloseStream` kommt die letzte Äußerung, dann `TranscriptEndpoint`, dann schließt der
  Server mit 1000. Claude Code wartet darauf höchstens 5 s und gibt nach 1,5 s ohne neue Wörter auf; was
  bis dahin als `TranscriptText` kam, zählt dann als gesagt. Nexa hält es genauso.

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

### Nachrichten zwischen Sitzungen (`SendMessage`, Peer-Protokoll 1)

Abgelesen an 2.1.331 (nicht dokumentiert, Nexa nutzt es noch nicht; Nexas eigene Nachrichten zwischen
Chats laufen über den MCP-Server, siehe unten). Jede Sitzung, auch die von Nexa (`entrypoint: "sdk-ts"`),
hat einen Posteingang:

- `sessions/<pid>.json` nennt zusätzlich `messagingSocketPath` (unter Windows eine Named Pipe
  `\\.\pipe\LOCAL\cc-msg-<hex>`), `peerProtocol: 1`, `peerFeatures` (z. B. `notify_idle`,
  `artifact_yield`), `name` mit `nameSource` (`derived` aus dem Ordner, `user`, `peer` …) und `hostSessionId`.
  `ListAgents` listet diese Sitzungen unter `name`, nicht unter Nexas Titeln.
- Daneben `sessions/<pid>.<sha256(pipe)>.key` mit `{ peerToken (32 Hex), procStartFt, pidDomain }`.
  Unter Windows schickt Claude Code nur an eine Pipe, zu der es so einen Schlüssel einer lebenden Sitzung
  gibt („refusing to send to an unvouched pipe“).
- Auf der Pipe: zuerst `{"type":"auth","token":"<peerToken>"}`, dann eine Zeile
  `{"msgV":1,"msg_id":"<uuid>","type":"user","message":{"role":"user","content":"<cross-session-message from=\"<Antwortadresse>\">\n…\n</cross-session-message>"},"priority":"next","from":"<Antwortadresse>"}`,
  danach schließt der Sender. Die Antwortadresse ist die Pipe des Absenders.
- Der Empfänger rahmt die Nachricht ein („Another Claude session sent a message …“) und sagt dem Modell,
  dass sie nicht vom Nutzer kommt, keine Freigaben ersetzt und dass Weiterreichen verweigerter Aktionen
  „permission laundering“ ist. Ein Posteingang verwirft, was zu dicht hintereinander kommt; der Sender
  hält deshalb selbst Abstand.
- Für Programme, die Claude Code einbetten, gibt es eine Spur „host-injected“ über stdin (`origin`
  `{ kind: "peer", hostInjected: true, from }`, `CLAUDE_CODE_HOST_SESSION_ID`): Das Modell soll dann über
  das Nachrichten-Werkzeug des Hosts antworten. Sie hängt an internen Schaltern; Nexa nutzt sie nicht.

### Was zu einer Sitzung gehört (Löschen)

Je Config-Ordner, in dem die Sitzung liegt (nach einem Account-Wechsel in mehreren,
`conversation-files.ts`):

- `projects/<key>/<id>.jsonl`, das Transkript. Ohne es gibt es die Sitzung für Claude Code nicht mehr.
- `projects/<key>/<id>/` daneben: `subagents/` und ausgelagerte Werkzeug-Ausgaben.
- `file-history/<id>/`: die Sicherungen für `/rewind` (Checkpoints).
- `session-env/<id>/` und `tasks/<id>/`: Umgebung und Aufgabenliste der Sitzung.

Nexa legt diese Dateien und Ordner in den Papierkorb, nicht aber Einträge in gemeinsamen Dateien
(`history.jsonl` mit den Prompts aller Sitzungen). Hat ein Prozess außerhalb von Nexa die Sitzung offen
(`sessions/<pid>.json`), bleiben ihre Dateien in diesem Ordner liegen, weil er sie weiterschreiben würde.

### Worktrees (`--worktree`)

Laut Doku (code.claude.com/docs/en/worktrees): `claude --worktree <name>` (`-w`) legt
`.claude/worktrees/<name>` im Repository an, auf einem neuen Branch `worktree-<name>`, standardmäßig vom
Standard-Branch des Remotes (`origin/HEAD`; `worktree.baseRef: "head"` nimmt den eigenen HEAD), und kopiert
ignorierte Dateien, die `.worktreeinclude` nennt, hinein. Ohne Namen erfindet es einen
(`bright-running-fox`), einen vorhandenen betritt es wieder. Filter aus der Konfiguration des Repositorys
laufen dabei nicht. Die Sitzung ist dann „isoliert“: Claude Code verweigert Bearbeitungen, Befehle und
git-Umleitungen in den Hauptordner. Beim Betreten und Verlassen zieht das Transkript wie bei `/cd` um. Am Ende
einer interaktiven Sitzung entfernt es einen Worktree ohne Änderungen und neue Commits samt Branch und fragt
sonst; mit `-p` räumt es nicht auf, und seine Sperre (`git worktree lock`) bleibt liegen, bis ein späterer
Lauf sie löst.

Genauer (Doku und Claude Code 2.1.331 selbst):

- **Basis** (`worktree.baseRef`, Vorgabe `"fresh"`): der Standard-Branch von `origin`. Den Namen nimmt es aus
  `refs/remotes/origin/HEAD`, sofern dessen Branch da ist, sonst `main`, sonst `master` (je nachdem, welcher
  `refs/remotes/origin/…` existiert), sonst `main`. Hat git den Branch, holt es ihn nur, wenn `FETCH_HEAD` älter
  als 24 Stunden ist: `git fetch --upload-pack=git-upload-pack origin <branch>` ohne Eingabe (Passwort,
  Passphrase, neuer SSH-Host zählen als Fehlschlag), höchstens 5 s, sonst bleibt der vorhandene. Hat git ihn
  nicht, holt es ihn; scheitert das, nimmt es den HEAD. `"head"`: der HEAD des Ordners, in einem Worktree
  dessen HEAD.
- **Anlegen**: `git worktree add --no-track -B worktree-<name> <ordner> <commit>^{commit}`. `--no-track`, damit
  der Branch nicht `origin/main` folgt; `-B` setzt einen übrig gebliebenen Branch `worktree-<name>` auf die Basis
  zurück.
- **`.worktreeinclude`** (im Hauptordner, Syntax der `.gitignore`, ohne Groß-/Kleinschreibung): kopiert werden
  nur ignorierte Dateien. Liste aus `git ls-files --others --ignored --exclude-standard --directory`; Dateien
  darin, die ein Muster trifft, kommen mit. Ein ganz ignorierter Ordner (`node_modules/`) wird nur durchsucht
  (`git ls-files … -- <ordner>`), wenn ein Muster in ihn führt: es beginnt mit dem Ordner, sein Teil vor dem
  ersten `*`, `?` oder `[` passt zum Ordner, der erste Name nach einem führenden `**/` steht im Pfad des
  Ordners, oder das Muster trifft den Ordner selbst. `.env` sucht also nicht in `node_modules/`. Links
  überspringt es, ebenso Ziele, deren Weg im Worktree über einen Link führt. Auf Windows kopiert es außerdem
  `.claude/settings.local.json` (anderswo liest Claude Code sie in einem Worktree aus dem Hauptordner).
- **Wiederbetreten**: Mit `"fresh"` setzt es einen vorhandenen Worktree auf den Standard-Branch zurück
  (`git reset --hard`), wenn er noch auf seinem Branch ist, nichts geändert und nichts Neues darin ist und er
  keine eigenen Commits hat (oder seine Commits gemergt sind und der Remote-Branch gelöscht), keine andere
  Sitzung ihn sperrt und keine Sandbox schreibt. `.worktreeinclude` gilt nur beim Anlegen.

Nexa nutzt den Schalter nicht, sondern legt den Worktree an derselben Stelle mit git selbst an und startet
die CLI darin (ARCHITECTURE, „Chats in Worktrees“): Codex kennt keine Worktrees, Nexa muss den Ordner des
Chats vorher kennen (Dateibaum, Browser, Transkript), und mit `-p` bliebe jeder Worktree gesperrt. Für
Claude Code ist das eine gewöhnliche Sitzung in diesem Ordner, ihr Transkript liegt unter dem
Projektschlüssel des Worktrees; `claude --worktree <name>` im Terminal betritt denselben Worktree. Basis,
Holen, `.worktreeinclude`, `settings.local.json` und Wiederbetreten macht Nexa wie oben, mit drei Unterschieden:
Den Standard-Branch holt Nexa, wenn git ihn noch nicht hat, höchstens 20 s lang. Einen übrig gebliebenen Branch
`worktree-<name>` setzt Nexa fort statt ihn zurückzusetzen (Nexa lässt ihn nur mit eigenen Commits stehen).
Beim Wiederbetreten zählt statt der Sitzung „ein anderer Chat arbeitet darin“, und „nichts Eigenes“ heißt: alle
seine Commits sind schon auf dem Standard-Branch.

## Codex (`codex app-server`)

Sites (Codex' Gegenstück zu den Artefakten) gibt der App-Server nicht heraus, auch 0.172 nicht (Schema
von 0.169, Zeichenketten von 0.172: keine Methode listet sie, nur der Pfad `codex/sites/git` des Backends
kommt vor). Nexa zeigt sie deshalb (noch) nicht.

Ein Prozess je Account für alle seine Sessions, JSON-RPC 2.0 über stdio
(`codex app-server --listen stdio://`, mit `CODEX_HOME` des Accounts).

- **Start**: `initialize`, danach `account/read` (Anmeldung, Plan) und `account/rateLimits/read`.
- **Session**: `thread/start` bzw. `thread/resume` mit `cwd`, `approvalPolicy`, `sandbox`,
  `developerInstructions` und `config` (gepunktete Schlüssel, gelten nur für diesen Thread). Darin zuerst
  die `-c schlüssel=wert` aus den Argumenten des Accounts und des Chats (`nx -- …`, `codexOverrides`: Werte
  als JSON statt TOML, `'text'` als TOML-Literal, sonst der Text), darüber der MCP-Server von Nexa:
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
  nächsten Start des Threads. `mcpServer/oauth/login { name, threadId? }` startet die Anmeldung an einem
  Server: Antwort `{ authorizationUrl, loginId }`, der App-Server nimmt die Weiterleitung selbst entgegen
  und meldet `mcpServer/oauthLogin/completed` (`name`, `success`, `error`). `config/mcpServer/reload`
  (ohne Parameter) liest die Server aus der Konfiguration neu und verbindet sie; Nexa nutzt es für „Neu
  verbinden“ und nach einer Anmeldung. Ein unbekannter Name ergibt „No MCP server named '…' found.“
  Für MCP Apps siehe den Abschnitt dazu.
- **Plugins** (geprüft mit 0.169): `plugin/installed { cwds }` liefert `marketplaces[]` (`name`, `path`,
  `interface.displayName`, `plugins[]`) mit den installierten Plugins; `plugin/list` dazu die nicht
  installierten. Je Plugin `id` (`<name>@<marktplatz>`), `name`, `version` (entfernt) bzw. `localVersion`,
  `installed`, `enabled`, `availability` (`AVAILABLE`, `DISABLED_BY_ADMIN`), `disabledReason`,
  `interface` (`displayName`, `shortDescription`, `longDescription`, Logos). Die Apps von ChatGPT kommen
  als Plugins des Marktplatzes `openai-curated-remote`. Ein- und ausgeschaltet wird in der `config.toml`
  des Accounts: `[plugins."<id>"] enabled = true|false` (so schreibt es auch `plugin/install`). Nexa
  schreibt mit `config/value/write { keyPath: "plugins", value: { "<id>": { enabled } }, mergeStrategy:
  "upsert" }`: `upsert` führt die Tabellen zusammen, andere Schlüssel des Plugins bleiben, und eine ID
  mit Punkten bricht keinen gepunkteten Schlüssel. Threads übernehmen das erst bei ihrem nächsten Start.
- **Turn**: `turn/start`; während ein Turn läuft, gehen weitere Nachrichten über `turn/steer`
  (`{ threadId, input, expectedTurnId, clientUserMessageId? }`, Antwort `{ turnId }`; ist der Turn
  schon vorbei, ein Fehler). Beide nehmen `clientUserMessageId`, das als `clientId` am `userMessage`-Item
  zurückkommt, bei `turn/steer` sofort: Codex nimmt die Nachricht gleich in den laufenden Turn auf.
  Darum wartet bei Codex keine Nachricht unter dem Chat, und „Jetzt senden“ gibt es nicht. Einen
  Vorschlag für den nächsten Prompt wie Claude Code hat der App-Server nicht (0.169).
  `turn/interrupt` bricht ab. Weitere Ordner zum Schreiben stehen in `sandboxPolicy.writableRoots`
  (`{ type: "workspaceWrite", writableRoots, networkAccess }`) von `turn/start`.
- **Warteschlange** (nur mit `capabilities.experimentalApi`, abgelesen an 0.169, Nexa nutzt sie nicht):
  `thread/queue/add { threadId, input, clientUserMessageId }` → `{ queuedSubmission: { id, input,
  clientUserMessageId } }`, dazu `thread/queue/list`, `…/update`, `…/delete`, `…/reorder`, `…/start
  { threadId, queuedSubmissionId? }` (→ `{ turn }`) und die Meldung `thread/queue/changed { threadId }`.
  Ob ein anderer Prozess (die TUI, die den Thread hält) Einträge aufnimmt, ist ungeprüft. Nachrichten
  zwischen Prozessen wie bei Claude Code gibt es nicht.
- **Benachrichtigungen**: `turn/started`, `turn/completed`, `item/started`, `item/completed`,
  `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`,
  `item/commandExecution/outputDelta`, `item/plan/delta`, `item/mcpToolCall/progress`,
  `turn/plan/updated`, `thread/tokenUsage/updated`, `thread/compacted`, `model/rerouted`,
  `account/rateLimits/updated`.
- **Weitere Items** (Typen aus `codex app-server generate-ts` von 0.169, ohne echten Turn geprüft):
  - `plan { id, text }`, gestreamt mit `item/plan/delta { itemId, delta }`: der Plan, den Codex im
    Plan-Modus vorschlägt. Nexa zeigt ihn als Antwort mit `phase: 'plan'`, eingerahmt.
  - `sleep { id, durationMs }`: Codex wartet; „Warten“ mit der Dauer.
  - `hookPrompt { id, fragments: [{ text, hookRunId }] }`: Ein Hook gibt Codex einen Prompt; Nexa zeigt
    ihn als Hinweis mit dem Text.
  - `item/mcpToolCall/progress { itemId, message }`: Fortschritt eines MCP-Aufrufs; steht, solange er
    läuft, in der Werkzeugzeile (`ToolItem.progress`).
  - `webSearch { id, query, action }` mit `action` `search { query, queries }`, `openPage { url }`,
    `findInPage { url, pattern }` oder `other`: „Im Web suchen“, „Seite öffnen“, „Auf der Seite suchen“.
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
- **Zurückspulen**: `thread/revert { threadId, beforeTurnId }` nimmt die Turns ab `beforeTurnId` aus dem
  Verlauf (Benachrichtigung `thread/reverted`), lässt die Dateien aber, wie sie sind (geprüft mit 0.169).
  Nexa spult Dateien mit seinen eigenen Checkpoints zurück („Checkpoints (Nexa)“) und den Verlauf mit
  „Bearbeiten“ eines Prompts (`thread/fork` mit `lastTurnId`).
- **Liste und Verlauf** (Übernahme vorhandener Threads): `thread/list { limit, cursor, sourceKinds }`
  antwortet mit `{ data, nextCursor }`, den Threads im `CODEX_HOME` des Servers: `id`, `cwd`, `name`
  (vom Nutzer gesetzt, sonst `null`), `preview` (der erste Prompt), `createdAt`/`updatedAt` in Sekunden,
  `ephemeral`, `parentThreadId` (Subagents), `path` (Rollout) und `source`. Nexa fragt
  `sourceKinds: ["cli", "vscode", "appServer"]`, also ohne `codex exec`, und lässt Subagents und
  flüchtige Threads weg. `thread/read { threadId, includeTurns: true }` gibt den Thread mit `turns[]`
  (`id`, `items`, `status` `completed`/`interrupted`/`failed`/`inProgress`, `error`, `startedAt`,
  `completedAt` in Sekunden, `durationMs`); die Items sind dieselben wie in `item/completed`, Prompts als
  `userMessage` mit `content[]` (`text`, `localImage` mit `path`). Die Turns kennt `thread/read` nur aus
  den Aufzeichnungen des eigenen Accounts (`state_<n>.sqlite`): Für einen Rollout, der bloß in den
  Ordner kopiert wurde, kommen keine. `thread/resume` mit `excludeTurns: false` gäbe sie auch, ohne den
  Rollout anzufassen, hängt den Thread aber an den Server. Geprüft mit 0.169.
- **Neueste Turns**: `thread/turns/list { threadId, cursor, limit, sortDirection, itemsView }` gibt die
  Turns seitenweise, ohne den Thread zu laden: `sortDirection: "desc"` (die Vorgabe) die neuesten zuerst,
  `itemsView: "full"` mit allen Items (Vorgabe `summary`). Antwort `{ data, nextCursor, backwardsCursor }`,
  die Cursor sind undurchsichtige Strings. Die Turns sehen aus wie in `thread/read`. `thread/read` mit
  `includeTurns: false` gibt nur den Thread, darunter `path` (Rollout) und `updatedAt`. Geprüft mit 0.169.
- **Wer einen Thread offen hat** (geprüft mit 0.169 unter Windows): Ein Prozess, der einen Thread geladen
  hat (TUI, `codex exec`, VS Code, Desktop-App, ein App-Server wie der von Nexa), hält
  `<CODEX_HOME>/thread-writer-locks/<thread>.lock` offen, eine leere Datei, die beim Freigeben
  verschwindet. Jeder andere bekommt den Thread solange nicht: `thread/resume` scheitert mit „thread … already
  has an active writer“ (-32600), `codex exec resume` ebenso. Nexa prüft die Sperre, indem es die Datei
  exklusiv öffnet (`UV_FS_O_EXLOCK`, `0x10000000`, Node exportiert die Konstante unter Windows nicht):
  EBUSY heißt gehalten. Unter Linux und macOS sperrt Codex mit `flock`, das sieht Node nicht.
  `thread/loaded/list` (`{ data: [ids], nextCursor }`) nennt die Threads, die ein App-Server geladen hat.
  Nach `thread/unsubscribe` des letzten Abonnenten behält der Server den Thread noch 60 s und meldet dann
  `thread/closed`; erst dann ist die Sperre frei. Eine Methode zum sofortigen Entladen gibt es nicht.
  `thread/read` und `thread/turns/list` laden den Thread nicht und gehen auch, während ein anderer ihn hält.
  Nexa gibt den Thread eines Chats deshalb nach 60 s ohne Turn frei (`thread/unsubscribe`), damit die TUI
  ihn öffnen kann, und nimmt beim nächsten Abgleich die Turns auf, die dort fertig wurden
  (`codexTurnsFromOutside`): `userMessage` hat im Verlauf `clientId: null`, Nexas eigene Turns erkennt es
  an den IDs der übrigen Items und am `turn:<id>`.
- **Titel** (geprüft mit 0.169): Codex benennt Threads nicht selbst. `name` bleibt `null`, bis jemand ihn
  setzt. Das geht mit `thread/name/set { threadId, name }`, danach kommt `thread/name/updated`
  (`threadId`, `threadName`). Nexa fragt nach dem ersten Prompt in einem eigenen flüchtigen Thread:
  `thread/start` mit `ephemeral: true`, `baseInstructions` (nur den Titel antworten), `sandbox:
  "read-only"`, `approvalPolicy: "never"`, dem Standardmodell des Accounts und dem Temp-Ordner als `cwd`,
  damit keine `AGENTS.md` mitkommt. Dann `turn/start` mit der niedrigsten Stufe des Modells. Das dauert gut
  2 s. Flüchtige Threads stehen nicht in `thread/list` und werden nicht gespeichert, danach
  `thread/unsubscribe`. Den Titel setzt Nexa mit `thread/name/set` auch am Thread des Chats.
- **Slash-Befehle** kennt der App-Server nicht: `/…` ginge als Text an das Modell. Nexa führt seine eigenen
  aus (renderer `lib/chat-commands.ts`), die Skills kommen mit `skills/list` und gehen als `$name`.
- **Anfragen vom Server** (Antwort nötig): `item/commandExecution/requestApproval`,
  `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`.
  Ihre JSON-RPC-`id` zählt jeder App-Server-Prozess ab 0, sie wiederholt sich also nach einem Neustart im
  selben Thread. Nexa gibt der Rückfrage deshalb eine eigene ID statt einer aus `id` und Thread.
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
- **Erneuern**: `auth.json` hält dazu `tokens.refresh_token` und `last_refresh` (ISO, wann Codex die
  Tokens zuletzt gespeichert hat; die Tabelle „Logins“ zeigt es). CLI und App-Server erneuern den
  Access-Token selbst, sobald sie ihn brauchen, also auch der Server, den Nexa für die Limits startet. Nexa erneuert
  Codex-Logins nicht: OpenAIs Refresh-Tokens gehen nur einmal, ein laufender Codex hält seinen im Speicher,
  und Nexa kennt keine Sperre, unter der Codex erneuert. Eine Erneuerung daneben könnte ihn abmelden.
- **`codex login`** ohne Terminal: startet einen lokalen Server auf `http://localhost:1455` (nennt ihn
  zuerst, dann den Link zu `auth.openai.com`) und öffnet den Browser. Exit-Code 0 heißt angemeldet. Weil
  der Port fest ist, läuft immer nur ein Codex-Login.
- **Wechsel des Accounts**: Nexa kopiert den Rollout an dieselbe Stelle unter `sessions/` des neuen
  Ordners und setzt mit `thread/resume { threadId, path }` fort; der App-Server des neuen Accounts findet
  den Thread sonst nicht.
- **Löschen**: Ein Thread ist seine Rollouts unter `sessions/` und, archiviert, unter
  `archived_sessions/` (die Thread-ID steht am Ende des Dateinamens). Nexa legt sie in jedem Account-Ordner
  in den Papierkorb. Der App-Server hätte `thread/delete { threadId }` (endgültig, nur im eigenen
  `CODEX_HOME`); Nexa nutzt es nicht, damit sich ein Chat aus dem Papierkorb zurückholen lässt. Den Index
  von Codex (`state_<n>.sqlite`, `session_index.jsonl` mit den Namen) fasst Nexa nicht an.
- **Limits**: `account/rateLimits/read` je App-Server; `account/rateLimits/updated` kommt vom Server des
  Accounts, der gerade arbeitet. Für Accounts ohne laufenden Server fragt Nexa nur beim ausdrücklichen
  Aktualisieren (startet dafür den Server).
- **Turn am Limit**: `turn/completed` mit `turn.status: "failed"` und `turn.error.codexErrorInfo:
  "usageLimitExceeded"` (`CodexErrorInfo` aus `generate-ts`). Nexa markiert den Turn dann mit `limit`;
  andere Fehler wie `rateLimitExceeded` oder `sessionBudgetExceeded` gelten als gewöhnlicher Fehler.

### Sprache (`/voice`)

`/voice` in der TUI ist kein Diktat, sondern ein Sprachgespräch: Ein Echtzeit-Modell hört zu, antwortet
hörbar und gibt Aufgaben an Codex weiter. Nexa nutzt es nicht, die Spracheingabe läuft immer über Claude
(siehe „Spracheingabe“ bei Claude Code). Abgelesen an Codex 0.169 (`generate-ts --experimental`):

- **App-Server** (nur mit `capabilities.experimentalApi`): `thread/realtime/start { threadId,
  outputModality: "text" | "audio", transport, version, prompt, … }`, Audio per
  `thread/realtime/appendAudio { threadId, audio: { data (base64), sampleRate, numChannels, … } }`, Ende
  mit `thread/realtime/stop`. Zurück kommen `thread/realtime/transcript/delta` und `…/done` (mit `role`),
  `outputAudio/delta`, `sdp`, `error`, `closed`.
- **Mit ChatGPT-Login** nur über WebRTC (`transport: { type: "webrtc", sdp }`, Antwort als
  `thread/realtime/sdp`) und nur als Audio-Gespräch: `transport: websocket` meldet „realtime conversation
  requires API key auth“, Textausgabe „requires realtime v2“, v2 „AVAS realtime calls require realtime v1
  or v3“. Der Aufruf geht an `chatgpt.com/backend-api/codex/realtime/calls`; mit einem Free-Plan kam 404.
- **`codex-voice-host`** (`codex-resources/voice/bin`, GStreamer mit Opus und RTP) ist der Audio- und
  WebRTC-Teil dieses Gesprächs für die TUI, keine Spracherkennung zum Mitschreiben.
- Die Features `in_app_dictation` und `in_app_voice` sind Schalter für die Desktop-App von Codex, nicht
  für die CLI.

## Einstellungen der CLIs

Was Einstellungen › CLI-Konfiguration liest und schreibt (`providers/<id>/<id>-config.ts`). Geprüft mit
Claude Code 2.1, Codex 0.169 und Antigravity CLI 1.5.16.

### Claude Code

| Ebene | Berechtigungen und Hooks | MCP-Server |
| --- | --- | --- |
| Nutzer (`-s user`) | `<config>/settings.json` | `.claude.json` → `mcpServers` |
| Projekt (`-s project`) | `<projekt>/.claude/settings.json` | `<projekt>/.mcp.json` → `mcpServers` |
| Lokal (`-s local`) | `<projekt>/.claude/settings.local.json` | `.claude.json` → `projects["<ordner>"].mcpServers` |

- `<config>` ist `CLAUDE_CONFIG_DIR` des Accounts, sonst `~/.claude`. `.claude.json` liegt im
  `CLAUDE_CONFIG_DIR`, ohne ihn im Home (`claudePaths`).
- Die Schlüssel unter `projects` schreibt Claude Code mit Schrägstrichen (`F:/Code/app`); ältere Einträge
  können anders geschrieben sein, deshalb sucht `claudeProjectEntry` erst genau, dann über `folderKey`.
- Berechtigungen: `permissions.{allow, ask, deny, defaultMode, additionalDirectories}`; `defaultMode` ist
  `default`, `acceptEdits`, `plan`, `auto`, `dontAsk` oder `bypassPermissions`. Einen unbekannten Modus zeigt
  Nexa, wie er ist.
- Hooks: `hooks.<Ereignis>: [{ matcher?, hooks: [{ type: "command", command, timeout?, … }] }]`, `timeout`
  in Sekunden. Andere Arten (`prompt`, `agent`, `http`, `mcp_tool`) zeigt Nexa nur.
- Die Einstellungsdateien schreibt Nexa selbst (lesen, ändern, atomar schreiben). `.claude.json` schreibt
  Claude Code dauernd selbst (Zähler, Caches); Nexa ändert sie nur über die CLI:
  `claude mcp add-json <name> - -s <ebene>` mit dem JSON auf stdin (`-` als Wert) und `claude mcp remove
  <name> -s <ebene>`, für Projekt und Lokal im Ordner des Projekts. Einen Namen, den es gibt, lehnt
  `add-json` ab („already exists“): Bearbeiten ist Entfernen und neu Anlegen (der Server steht danach am
  Ende), schlägt das Anlegen fehl, kommt der alte zurück.
- `claude mcp add-json` verweigert innerhalb einer Claude-Code-Sitzung den Dienst, solange deren Variablen
  (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` …) gesetzt sind; `cliEnv` nimmt sie heraus.
- Arten von Servern: `stdio` (Vorgabe ohne `type`), `http`, `sse`; andere (`ws`, `sdk`, `claudeai-proxy`)
  zeigt Nexa nur und kann sie entfernen. Konnektoren von claude.ai stehen in keiner Datei.

### Codex

- Nexa geht über den App-Server des Accounts. `config/read { includeLayers: true, cwd }` liefert die
  Ebenen: `user` (`{ file, profile }`) und je Projekt `project` (`{ dotCodexFolder }`); einem Projekt, dem
  der Nutzer nicht vertraut hat, gibt Codex `disabledReason` mit und lädt es nicht.
- `config/batchWrite { edits: [{ keyPath, value, mergeStrategy: "replace" | "upsert" }], reloadUserConfig }`
  ändert die `config.toml` und behält Kommentare und Reihenfolge; `value: null` entfernt den Schlüssel. Es
  schreibt nur die Nutzer-Ebene („Only writes to the user config are allowed“, `configLayerReadonly`),
  deshalb zeigt Nexa die `.codex/config.toml` eines Projekts nur. Ersetzte Arrays schreibt Codex inline
  (`Stop= [{ … }]` statt `[[hooks.Stop]]`).
- MCP-Server: `mcp_servers.<name>` mit `command`, `args`, `env` oder `url`, `http_headers`,
  `bearer_token_env_var`, dazu `enabled` und Zeitgrenzen. Einen Namen, der kein einfacher Schlüssel ist,
  schreibt Nexa über die ganze Tabelle `mcp_servers`. Danach `config/mcpServer/reload`.
- Berechtigungen: `approval_policy` (`untrusted`, `on-request`, `never`; die feine Form `{ granular: … }`
  zeigt Nexa nur), `sandbox_mode` (`read-only`, `workspace-write`, `danger-full-access`),
  `approvals_reviewer`, `sandbox_workspace_write.{network_access, writable_roots}`.
- Hooks (seit 0.169) stehen unter `[hooks]` in der `config.toml` oder in `hooks.json` in `CODEX_HOME`, im
  selben Format wie bei Claude Code. Nexa schreibt in die Datei, in der sie stehen (`hooks.json` nur, wenn
  die `config.toml` keine hat). Einen Matcher kennen nur `PreToolUse`, `PermissionRequest`, `PostToolUse`,
  `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`.
- Codex führt einen Hook erst aus, wenn ihm vertraut ist: `hooks/list { cwds }` nennt je Hook `key`
  (`<datei>:<ereignis_snake>:<gruppe>:<index>`), `currentHash` (`sha256:…`) und `trustStatus`;
  vertraut wird über `hooks.state."<key>".trusted_hash`. Weil der Schlüssel den Platz enthält, verschiebt
  jedes Einfügen die Schlüssel der folgenden Hooks. Nach dem Speichern vertraut Nexa deshalb jedem Hook
  erneut, dessen Inhalt vorher vertraut war (nur verschoben) oder vorher nicht da war (in Nexa angelegt
  oder geändert); was sich außerhalb von Nexa geändert hat, bleibt unvertraut. Veraltete Schlüssel des
  Ereignisses entfernt es.

### Antigravity CLI

Abgelesen an Antigravity CLI 1.5.16 (`agy`): die Dateien, die es selbst anlegt, und was es aus ihnen liest.

| Ebene | MCP-Server | Hooks | Berechtigungen |
| --- | --- | --- | --- |
| Nutzer | `<.gemini>/config/mcp_config.json` | `<.gemini>/config/hooks.json` | `<.gemini>/antigravity-cli/settings.json`, geteilte Regeln in `<.gemini>/config/config.json` |
| Projekt | `<projekt>/.agents/mcp_config.json` | `<projekt>/.agents/hooks.json` | `<.gemini>/config/projects/default-cli-project.json` (für alle Ordner) |

- `<.gemini>` ist der Ordner des Accounts (`--gemini-dir`), sonst `~/.gemini`. Der Ordner heißt noch wie bei
  Gemini CLI, die Dateien darin sind andere.
- Nexa schreibt die Dateien selbst (lesen, ändern, atomar schreiben): `agy mcp add` nähme Variablen und
  Header als Argumente, in der Prozessliste lesbar.
- MCP-Server: `mcpServers.<name>` mit `command`, `args`, `env`, `cwd` (stdio) oder `url` (alt: `serverUrl`)
  und `headers` (Streamable HTTP), dazu `disabled`. Andere Schlüssel (`enabledTools`, `disabledTools`,
  `timeoutSeconds`, `tools.eager` …) bleiben, wie sie sind. Antigravity liest die Datei mit Kommentaren
  (`//`, `/* */`) und Kommas am Ende (1.5.17); Nexa zeigt sie so auch, ändert sie dann aber nicht, weil die
  Kommentare beim Schreiben verloren gingen (`readJsonFile` mit `comments`, `jsoncText`).
- Berechtigungen: `agentMode` (`""` = Standard, `accept-edits`, `auto`, `plan`), `toolPermission`
  (`request-review`, `proceed-in-sandbox`, `always-proceed`, `strict`), `allowNonWorkspaceAccess` und
  `permissions.{allow, ask, deny}` mit Regeln der Form `aktion(ziel)`.
- Projektregeln: `/permissions` kennt drei Ebenen: „Project“ (geht vor), „Shared with Antigravity“ und
  „Global“ (die `settings.json` oben). „Project“ ist kein Ordner, sondern ein Antigravity-Projekt: Jede
  Sitzung der CLI und von `agy acp` läuft im Projekt `default-cli-project` („CLI Project“, im Log
  „Conversation using project ID“), in jedem Ordner; nur die Oberfläche im Terminal nimmt mit `--project`
  ein anderes. Seine Regeln stehen in `<.gemini>/config/projects/default-cli-project.json` doppelt
  verschachtelt: `{ id, name, projectResources, permissionGrants: { permissionGrants: { allow, deny, ask } } }`.
  Die Datei legt erst die Oberfläche im Terminal an, `agy acp` nicht; ohne sie schreibt Nexa `id`, `name`
  und `projectResources: {}` wie Antigravity. Geprüft: Eine `deny`-Regel daraus (`read_file(secret.txt)`)
  verhindert das Lesen auch über ACP, in einem anderen Ordner. Nexa zeigt sie unter der Ebene Projekt,
  mit dem Hinweis, dass sie in allen Projekten gelten.
- Geteilte Regeln („Shared with Antigravity“, abgelesen an 1.5.17): `<.gemini>/config/config.json` ist
  die Einstellungsdatei, die sich CLI und Antigravity-App teilen (dort auch `plugins`, `skills` …). Die
  Regeln stehen unter `userSettings.globalPermissionGrants { allow, deny, ask }`, derselbe Typ wie die
  Projektregeln (`PermissionGrantsConfig`). Belege: die Felder des Typs im Programm, die Meldungen
  „applyUserSettings: stored shared config permissions: allow=%d deny=%d ask=%d“ und
  „persistSharedConfigPermissions: failed to save config.json“, und das Änderungsprotokoll („Immer
  erlauben“ aus einer Remote-Control-Sitzung landet „only to the shared `config.json`“). Ein Schreiben
  durch `/permissions` selbst ist noch nicht beobachtet. Nexa zeigt die drei Listen unter der Ebene
  Nutzer unter „Geteilt mit Antigravity“ und schreibt nur diesen Schlüssel, alles andere bleibt.
- Hooks: `{ "<name>": { enabled?, "<Ereignis>": […] } }`, also benannte Hooks mit ihren Ereignissen.
  `PreToolUse` und `PostToolUse` halten Gruppen `{ matcher, hooks: [{ type: "command", command, timeout? }] }`
  (Matcher ist ein regulärer Ausdruck auf den Werkzeugnamen), `SessionStart`, `PreInvocation`,
  `PostInvocation` und `Stop` halten die Befehle direkt. `timeout` in Sekunden. Nexa zeigt die Gruppen
  aller benannten Hooks je Ereignis und schreibt jede dorthin zurück, woher sie kam; neue kommen in den
  Hook `nexa`. Ein benannter Hook ohne Ereignisse fällt weg.
- MCP-Server im „+“-Menü (geprüft mit einem kleinen stdio-Server, der seinen Start mitschreibt):
  - `agy acp` startet beim `session/new` die Server des Nutzers (1.5.16 auch die aus
    `.agents/mcp_config.json`; 1.5.17 startete diese bis 15 s danach nicht, vielleicht erst mit dem
    ersten Prompt). Über ACP nennt es keinen Zustand, auch `agy mcp list` nur `enabled`/`disabled` aus der
    Datei des Nutzers. Ohne laufenden Chat zeigt Nexa die Server aus den Dateien („Eingerichtet“ oder
    „Aus“).
  - **Zustand der MCP-Server** (1.5.17, `antigravity-server.ts`): Jeder `agy acp`-Prozess startet mit der
    ersten Sitzung einen lokalen HTTP-Server (seinen „Language Server“, Connect-Protokoll mit JSON). Den
    Port nennt sein Log `<.gemini>/antigravity-cli/log/acp-server-<zeit>-<pid>.log` („Language server
    listening on random port at <port> for HTTP“, eine Zeile davor die für HTTPS/gRPC); die PID im
    Namen ist die des Prozesses, den Nexa startet (nicht bei einem Start über `agy.cmd`). Anfragen
    brauchen einen CSRF-Token im Header `x-codeium-csrf-token` (oder `x-antigravity-csrf-token`), den
    Nexa dem Prozess mit `ANTIGRAVITY_SERVER_CSRF_TOKEN` vorgibt; ohne ihn 401 „missing CSRF token“.
    `POST /exa.language_server_pb.LanguageServerService/GetMcpServerStates` mit `{}` liefert
    `states[]`: `spec` (die Einstellung, `serverName`, `disabled`), `status`
    (`MCP_SERVER_STATUS_PENDING`, `_READY`, `_ERROR`, `_DISABLED_BY_ADMIN`), `error` (lesbar, z. B.
    „"x" is not installed or not on PATH“), `tools[]`, `serverInfo`, bei Bedarf `authUrl`. Nur Server aus
    den Dateien, nicht die aus `session/new` (Nexas eigener). `RefreshMcpServers { serverName }` startet
    einen Server neu (antwortet `{}`); Nexa nutzt es für „Neu verbinden“. Keine dokumentierte
    Schnittstelle: Schlägt etwas fehl, zeigt Nexa die Dateien.
  - `disabled: true` startet den Server trotzdem, das Modell bekommt seine Werkzeuge aber nicht.
  - Ein Server lässt sich nicht für eine einzelne Sitzung abschalten: Ein Eintrag gleichen Namens mit
    `disabled: true` in `.agents/mcp_config.json` schaltet den des Nutzers nicht ab (der zuerst gestartete
    behält den Namen), ein Server gleichen Namens in `mcpServers` von `session/new` ersetzt ihn nicht, und
    `agy acp` hat kein `--settings`. Nexas eigener Schalter je Projekt (`Project.mcpOff`) wirkt hier also
    nicht; der Schalter im „+“-Menü setzt `disabled` in der Datei, in der der Server steht
    (`AgentProvider.setMcpEnabled`). Für Server des Nutzers gilt er damit in allen Projekten und im
    Terminal, das Menü sagt das. Laufende Chats mit dem Account starten danach neu.

### Globale MCP-Server

Ein Server, den Nexa auf der Ebene Nutzer jedes Accounts jeder installierten CLI einträgt und gleich hält
(`services/global-mcp.ts`). Was die drei CLIs gemeinsam haben, bestimmt, was global sein kann:

| | Claude Code | Codex | Antigravity CLI |
| --- | --- | --- | --- |
| Arten | stdio, HTTP, SSE | stdio, HTTP | stdio, HTTP |
| Token aus einer Variable | – | `bearer_token_env_var` | – |
| Ausschalten | – (nur im Prozess, `mcp_toggle`) | `enabled = false` | `disabled: true` |

- Global geht also nur stdio und HTTP ohne Token-Variable (`globalMcpProblem`); ein Token gehört dann als
  Header `Authorization` in den Eintrag.
- Gleich heißt: gleicher Befehl mit Argumenten und Variablen bzw. gleiche Adresse mit Headern, mit Werten
  (`mcpFingerprint`). Der Schalter zählt nicht und bleibt je CLI, ebenso Schlüssel, die Nexa nicht
  bearbeitet (Zeitgrenzen, Werkzeugfilter, `cwd`): Das Schreiben übernimmt sie wie jede Änderung aus dem
  Eintrag, der schon dasteht.
- Die Server stehen nur in den Dateien der CLIs, mit ihren Secrets. `global-mcp.json` im Datenordner von
  Nexa hält nur Namen und Quelle (CLI und Account, deren Fassung gilt); fehlt der Server dort, nimmt Nexa
  den ersten Account, der ihn hat.

## Antigravity CLI (`agy acp`)

Abgelesen an Antigravity CLI 1.5.16 unter Windows. Antigravity CLI ersetzt in Nexa die Gemini CLI, die
Google für private Konten eingestellt hat. Mit `agy acp` spricht es das Agent Client Protocol (ACP,
`protocolVersion: 1`) wie zuvor Gemini CLI: JSON-RPC 2.0 als NDJSON über stdio, in beide Richtungen
(`providers/acp/acp-connection.ts`). Ein Prozess je Chat (`AntigravityRun`), gestartet im Ordner des Chats
mit der Umgebung des Accounts und:

- `--gemini-dir <ordner>` für einen Account mit eigenem Ordner. Keine Umgebungsvariable verlegt den Ordner.
- `--add-dir <ordner>` je weiterem Ordner des Chats.
- `--dangerously-skip-permissions` im Modus „Volle Rechte“ (siehe Modi).
- dahinter die Argumente des Accounts und des Chats (`nx -- …`).

**Methoden** (Client → Antigravity): `initialize { protocolVersion, clientCapabilities }` (`fs` und
`terminal` sind `false`: Antigravity liest, schreibt und führt selbst aus), `session/new { cwd, mcpServers,
_meta }`, `session/resume { sessionId, cwd, mcpServers, _meta }`, `session/load` (dasselbe, spielt aber den
Verlauf ab), `session/prompt { sessionId, prompt: ContentBlock[] }`, `session/set_mode { modeId }`,
`session/set_config_option { configId, value }`, `session/cancel` (Benachrichtigung), `session/list` (siehe
„Sitzungen und Dateien“). Die Antwort von
`initialize` nennt `agentCapabilities` mit `loadSession`, `sessionCapabilities.resume` und
`_meta.antigravity.systemPrompt.append`.

- **Systemprompt**: Anders als Gemini CLI nimmt Antigravity Text für den Systemprompt an:
  `_meta: { antigravity: { systemPrompt: { append: <anweisungen> } } }` in `session/new`, `session/resume`
  und `session/load`. Nexas Anweisungen (mit den Ordner-Prompts) gehen so mit, nicht mehr vor dem ersten
  Prompt. Fehlt die Fähigkeit, stellt Nexa sie wie früher als `<nexa-instructions>` vor den ersten Prompt.
- **Fortsetzen**: `session/resume` setzt eine Unterhaltung fort, ohne sie erneut zu schicken; ohne
  `sessionCapabilities.resume` nimmt Nexa `session/load` und blendet die Wiedergabe aus.
- **Antwort von `session/new`**: `sessionId`, `modes` (`default`, `accept-edits`, `auto`, `plan`),
  `models.availableModels` (je Modell und Denkstufe: `<modell>-low|medium|high|xhigh`), `configOptions`
  (`model`, `thought_level`, `mode`, je mit `currentValue` und `options`) und
  `_meta.antigravity.tier { id, name }`, den Plan des Logins („Antigravity Starter Quota“). Nexa nimmt die
  Modelle aus `configOptions.model` und die Denkstufen aus den Endungen; Modell und Stufe setzt es mit
  `session/set_config_option` (`model`, `thought_level`). Ohne laufenden Chat startet Nexa eine Sitzung
  ohne Prompt, um die Modelle zu erfahren (30 s, sonst eine feste Liste). Seit 1.5.17 legt Antigravity
  auch für sie `conversations/<id>.db` an (knapp 400 KB); Nexa löscht sie danach samt `-wal`/`-shm`.
- **MCP-Server von Nexa**: `mcpServers: [{ type: 'http', name: 'nexa', url, headers: [{ name:
  'Authorization', value: 'Bearer <token>' }] }]`. Antigravity nennt MCP-Werkzeuge `<server>_<werkzeug>`,
  je nach Herkunft mit `mcp_` davor. Anders als bei Gemini CLI kommen Name und Argumente mit dem Aufruf
  (dazu ein eigenes `toolSummary`); das Protokoll der Aufrufe (`McpCallLog`) leert Nexa nur noch.
- **Modi**: `ask` → `default`, `edits` → `accept-edits`, `plan` → `plan`, `auto` → `auto` (Antigravity
  entscheidet selbst, was es fragt). `full` hat keinen eigenen Modus: Der Prozess startet mit
  `--dangerously-skip-permissions`, läuft in `auto`, und Fragen, die trotzdem kommen, erlaubt Nexa selbst.
  Ein Wechsel zu „Volle Rechte“ oder davon weg startet den Prozess neu und setzt die Sitzung fort.
- **Prompt**: Nexa hält Prompts in einer eigenen Warteschlange und schickt den nächsten, wenn der Turn
  endet. Die Antwort von `session/prompt` beendet ihn: `{ stopReason: end_turn | cancelled, usage {
  inputTokens, outputTokens } }`. „Jetzt senden“ an einem wartenden Prompt schickt `session/cancel`;
  nach `cancelled` geht der nächste aus der Warteschlange raus.
- **Vorschläge für die Antwort**: ACP gibt keine weiter. Die Engine kennt einen Schritt
  `CortexStepSuggestedResponses { suggestions[] }` (Werkzeug `suggested_response`, abschaltbar über
  `SuggestedResponseConfig.force_disable`), in 1.5.17 nur in der Binärdatei gesehen; ob agy ihn nutzt
  und der lokale Server ihn zeigt, ist ungeprüft.
- **Fehler als Text**: Scheitert eine Anfrage an das Modell, endet der Turn mit `end_turn`, der Fehler steht
  als Antworttext da („⚠ agent executor error: …“). Nexa beendet den Turn dann als Fehler mit diesem Text.
  Nennt er das Kontingent („You have exhausted your quota on this model.“, „individual quota reached“,
  `RESOURCE_EXHAUSTED`, „Your AI credits balance is too low to continue.“), ohne von Kapazität zu reden,
  markiert Nexa den Turn als Limit (`isQuotaError`) und liest die Kontingente sofort neu. Diese Texte stammen
  aus den Strings von agy 1.5.17; einen echten Fehler dieser Art hat Nexa noch nicht gesehen. Kurze Limits
  je Minute wiederholt Antigravity selbst (bis 4 Minuten), sie enden nicht im Turn.
- **Abbrechen**: `session/cancel`. Offene Fragen beantwortet Nexa vorher mit `cancelled`, sonst wartet
  Antigravity auf sie. Der Prompt endet mit `stopReason: cancelled` (Nexa: „Abgebrochen“).

**`session/update`** (Antigravity → Client, Benachrichtigung) mit `update.sessionUpdate`:

- `agent_message_chunk`, `agent_thought_chunk` (ein ganzer Gedanke, mit Leerzeilen danach).
- `tool_call` und `tool_call_update` mit `toolCallId`, `name`, `args`, `title`, `kind`, `status` und
  `locations`. Updates wiederholen Name und Argumente. Pfade schreibt Antigravity unter Windows als
  `/F:/ordner/datei`, Links in Antworten als `file:///F:/…` (Nexas Markdown lässt `file:`-Links zu).
  Eigene Werkzeuge: `run_command`, `command_status`, `send_command_input`, `read_file`/`view_file`,
  `view_file_outline`, `write_file`/`write_to_file`, `edit_file`/`replace_file_content`/
  `multi_replace_file_content`, `list_dir`, `find_by_name`, `grep_search`, `codebase_search`, `search_web`,
  `read_url_content`, `update_steps`.
- **Diffs**: `content: [{ type: 'diff', path, oldText, newText }]`, sonst `{ type: 'content', content: {
  type: 'text', text } }`. Die Ausgabe eines Befehls trägt einen Kopf („Created At …“, „Command exited with
  code 0.“, „Command output:“); Nexa nimmt ihn ab und liest den Exit-Code daraus.
- `update_steps` ist die Aufgabenliste (die Schritte in den Argumenten); Nexa zeigt sie als To-dos.
- `usage_update { used, size }`: Tokens im Kontext und Größe des Fensters.
- `available_commands_update`, `config_option_update`.
- `session_info_update { title }`: der Name der Unterhaltung, den Antigravity selbst vergibt, schon früh im
  ersten Turn, vor dem Text der Antwort (geprüft mit 1.5.17: „Antwort Mit Hallo“). Nexa nimmt ihn als Titel
  des Chats wie die Titel von Claude Code (`AntigravityRun.title`, bis 60 s nach dem ersten Prompt); die
  Wiedergabe von `session/load` zählt nicht.

**`session/request_permission`** (Antigravity → Client, Anfrage) `{ sessionId, toolCall { toolCallId, name,
args, … }, options: [{ optionId, name, kind }] }` mit `kind` `allow_once`, `allow_always`, `reject_once`.
Antwort: `{ outcome: { outcome: 'selected', optionId } }` oder `{ outcome: { outcome: 'cancelled' } }`.
Nexa bietet „Erlauben“, „Für diese Session erlauben“ und „Ablehnen“; Nexas eigene Werkzeuge, die keine
Rückfrage brauchen (`tool-grant.ts`), erlaubt `AntigravityRun` selbst.

- **Plan**: Im Modus `plan` schreibt Antigravity den Plan als Artefakt `implementation_plan.md` (Argumente
  mit `ArtifactMetadata.RequestFeedback: true`) und beendet den Turn mit einer Frage in Worten, nicht mit
  einer Anfrage. Nexa zeigt den Plan nach dem Turn zur Freigabe. Freigeben setzt den gewählten Modus und
  schickt „Der Plan ist freigegeben. Setze ihn jetzt um.“, Wünsche gehen als „Überarbeite den Plan: …“.
  Ein anderer Prompt statt einer Antwort beantwortet den Plan mit.

**Fehler**: `-32000` heißt „Authentication required“ (Nexa: den Account in den Einstellungen anmelden); andere mit
`message`, die Nexa über `errorText` zeigt.

### Sitzungen und Dateien

- **Ordner**: `<.gemini>/antigravity-cli/` mit `settings.json`, `conversations/<id>.db` (SQLite, eine
  Unterhaltung je Datei) und `brain/<id>/` (ihre Artefakte: Plan, `walkthrough.md` …), dazu
  `conversation_summaries.db` (die Liste für `session/list`), `GEMINI.md` und `config/` in `<.gemini>`.
  Beim Löschen legt Nexa die Datei samt `-wal`/`-shm` und den Ordner der Unterhaltung in den Papierkorb
  (`antigravitySessionFiles`).
- **Fortsetzen** geht nur, wenn es `conversations/<id>.db` gibt (`antigravityResumable`); bis 1.5.16 legte
  Antigravity eine Sitzung ohne Prompt nicht ab, 1.5.17 schon. Sonst beginnt der Chat neu mit seinem
  Verlauf als `<nexa-context>`.
- **Die Datenbank einer Unterhaltung** (`antigravity-conversations.ts`) läuft im WAL-Modus: Was seit dem
  letzten Checkpoint kam, steht in `<id>.db-wal`, die Zeit der letzten Änderung ist die jüngere der
  beiden Dateien. Tabellen: `trajectory_meta` (`trajectory_id`, `cascade_id` = die ID der
  Unterhaltung), `steps` (`idx`, `step_type`, `metadata` und weitere Blobs, Protobuf ohne
  veröffentlichtes Schema), `gen_metadata` (je Antwort des Modells, Feld 2: die Schritte, die sie
  machte), `executor_metadata` (je Turn, Feld 3: sein letzter Schritt), `trajectory_metadata_blob`
  (u. a. der Systemprompt). `step_type` 14 ist ein Prompt (auch die, die Nexa selbst schickt), 15 eine
  Antwort, 132 ein Werkzeug, 101 und 17 kommen dazwischen. Feld 1 der `metadata` ist die Zeit des
  Schritts (`google.protobuf.Timestamp`), Feld 20 nennt Trajectory, Index und Unterhaltung. Nexa liest
  nur Art und Zeit der Schritte (`node:sqlite`, nur lesend).
- **Verlauf lesen** (Import, Abgleich): `session/load` spielt die Unterhaltung samt Prompts ab
  (`user_message_chunk`), ohne Zeiten und ohne IDs; die Datei ändert sich dabei nicht. `AntigravityRun.replay`
  macht daraus Chat-Elemente wie in einem Turn, je Prompt ein Turn; die Zeiten kommen aus den Schritten
  (Prompt = Zeit seines Schritts, Turn-Ende = Zeit des letzten Schritts davor). Passen Prompts und
  Schritte nicht zusammen, zählt Nexa von der letzten Zeit zurück und nimmt beim Abgleich nichts.
  `<nexa-instructions>` und `<nexa-context>` vor einem Prompt nimmt Nexa ab. `session/load` braucht den
  Ordner der Unterhaltung: aus `session/list`.
- **`session/list`** (`{ cursor? }`) → `{ sessions: [{ sessionId, cwd, title, updatedAt }], nextCursor? }`,
  aus `conversation_summaries.db`: `cwd` als `/F:/ordner`, `title` ist der letzte Prompt (gekürzt mit
  „...“), `updatedAt` ISO-Zeit. Die Liste behält Unterhaltungen, deren Datenbank gelöscht ist; Nexa lässt
  die aus. Eine Kopie unter neuer ID listet Antigravity, sobald es sie einmal geladen hat.
- **Übernehmen** (Einstellungen › Import, `nx -r <id>`): die Unterhaltungen aus `session/list` jedes
  Accounts, deren ID Nexa nicht kennt, mit dem Verlauf aus `session/load` beim ersten Öffnen.
- **Abgleich**: Nach jedem Turn in Nexa merkt sich der Chat die Zeit (`CliLink.synced`). Ist die
  Datenbank danach geändert und gibt es Prompts, die nach dieser Zeit gemacht wurden, kamen sie von
  außerhalb (`agy` im Terminal): Nexa liest ihre Turns über `session/load` und nimmt sie unter „Außerhalb
  von Nexa weitergeführt“ auf. Wo die Unterhaltung sonst offen ist, sagt Antigravity nicht.
- **Abzweigen, Bearbeiten**: ACP kennt kein Abzweigen und kein Kürzen (intern hat Antigravity
  `ForkConversation` und `RevertToCascadeStep`, aber nur in seinem eigenen Language Server, nicht über
  ACP und nicht als Befehl). Nexa kopiert die Datenbank deshalb vor dem nächsten Start unter einer neuen
  ID (`copyConversation`): `VACUUM INTO` (eine stimmige Kopie, auch während Antigravity schreibt), die
  alte ID der Unterhaltung und der Trajectory in allen Blobs ersetzt (gleich lang, Protobuf bleibt
  gültig), `trajectory_meta` neu, `brain/<id>/` mit. `CliLink.fork.at` ist eine Zeit: Die Kopie endet
  vor dem ersten Prompt, der dann oder später kam (beim Abzweigen der Zeitpunkt des Abzweigens, beim
  Bearbeiten der des Prompts), mit den Einträgen in `gen_metadata` und `executor_metadata`, die zu den
  weggelassenen Schritten gehören. Geprüft mit 1.5.16: `session/resume` der Kopie geht, das Modell kennt
  nur die Prompts davor. Bleibt nichts übrig oder ist eine Zeit unlesbar, beginnt der Chat neu mit
  `<nexa-context>`.
- **Accountwechsel**: dieselbe Kopie unter derselben ID in den Ordner des anderen Accounts (ein API-Key
  hat einen eigenen, der Google-Login nutzt `~/.gemini`); ein altes `-wal` am Ziel löscht Nexa vorher.

### Accounts und Login

Abgelesen an 1.5.17 (Antigravity aktualisiert sich selbst) unter Windows, aus dem Verhalten, den Logs
und den Zeichenketten der Binärdatei.

- **Google-Login im Schlüsselbund**: Ohne weitere Angabe einer je Benutzer des Rechners, über
  go-keyring mit Dienst `gemini` und Benutzer `antigravity`. Unter Windows der Eintrag `gemini:antigravity`
  (`cmdkey /list:gemini:antigravity`), unter macOS `security find-generic-password -s gemini -a antigravity`
  (ohne `-w`, die Schlüsselbundverwaltung fragt dann nicht), unter Linux der Secret Service (Suche per
  `gdbus … org.freedesktop.Secret.Service.SearchItems {'service': 'gemini', 'username': 'antigravity'}`;
  `secret-tool search` würde das Geheimnis ausgeben). Nexa liest nur, ob es ihn gibt. `--gemini-dir`
  trennt ihn nicht. Das ist der System-Account. Die Abfragen für macOS und Linux folgen den Konventionen
  von go-keyring und sind dort nicht ausprobiert.
- **Google-Login in einem Ordner**: Mit `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true` (getrimmt, Groß- und
  Kleinschreibung egal) lässt Antigravity den Schlüsselbund aus und hält den Token als JSON in
  `<gemini-dir>/antigravity-cli/antigravity-oauth-token` (Log: „Using file-based token storage because
  AGY_CLI_FORCE_FILE_TOKEN_STORAGE is set“). Damit trennt `--gemini-dir` die Logins: Jeder weitere
  Google-Account in Nexa (Art `oauth`) hat so seinen eigenen. Dieselbe Datei nimmt Antigravity auch ohne
  die Variable, wenn es keinen Schlüsselbund gibt (Linux ohne D-Bus-Sitzung); Nexa liest sie deshalb bei
  jedem Account zuerst. Felder `expiry` und `refresh_token` wie bei einem Go-`oauth2.Token` (angenommen,
  ein echter Token lag nicht vor); was Nexa nicht lesen kann, gilt als angemeldet.
- **Eigenes Update**: Liegt die letzte Prüfung (`antigravity-cli/last_check.timestamp`) länger zurück,
  startet jeder Aufruf von agy einen eigenen Update-Prozess (Log: „auto_updater.go … Spawned background
  update process with PID …“, Ergebnis in `antigravity-cli/updater/update_status.json`). Unter Windows
  bekommt dieser Prozess eine neue Konsole. Ist Windows Terminal das Standardterminal, geht dabei kurz
  ein Terminalfenster auf, auch wenn Nexa agy versteckt startet; meist beim Start von Nexa, das
  `agy -p /usage` aufruft. `AGY_CLI_DISABLE_AUTO_UPDATE=true` schaltet das ab (nur `true`, `1` wirkt
  nicht; Log: „Auto-update disabled via environment variable AGY_CLI_DISABLE_AUTO_UPDATE“). Nexa setzt
  die Variable für jede CLI, die es startet (`cliEnv`). Im Terminal und mit `agy update` aktualisiert
  sich agy weiter selbst.
- **Nicht dafür**: `AGY_ACCOUNT` wählt eines der verbundenen Konten (etwa GitHub) für Befehle in der
  Sandbox („AGY_ACCOUNT=account-2 gh api user“); `ANTIGRAVITY_CREDENTIAL_SCOPE` (sonst
  `%APPDATA%\antigravity\credential-user-scope`) trennt die Zugangsdaten von Plugins und MCP-Servern.
- **Anmelden**: `agy acp --login` (mit `--gemini-dir` und der Umgebung des Accounts) schreibt „Open this
  link in a browser to log in with Google:“, die Adresse (`accounts.google.com/o/oauth2/auth?…`,
  `redirect_uri=https://antigravity.google/oauth-callback`) und „Then paste the authorization code, or the
  full URL of the page you land on, and press Enter:“, öffnet den Browser selbst (Windows: `rundll32
  url.dll,FileProtocolHandler <url>`) und liest dann den Code von stdin. Danach speichert es den Token und
  endet. Nexa startet das als Login wie bei Claude Code: Der Dialog zeigt die Adresse und nimmt den Code
  (oder die ganze Adresse der Seite) an. Ausprobiert bis zur Adresse und zur Frage nach dem Code, nicht
  mit einer echten Anmeldung. `initialize` nennt als `authMethods` `oauth-personal`, `oauth-business`,
  `gemini-api-key` und `agent-platform` (`terminal-login` laut Doku nur für Clients mit Terminal); Nexa
  nimmt `--login` statt `authenticate`, weil es die Adresse und die Frage nach dem Code verlässlich auf
  stdout schreibt.
- **Abmelden**: ACP-Methode `logout {}` (Antwort `{}`, angekündigt mit `agentCapabilities.auth.logout`)
  löscht den Login dort, wo der Prozess ihn hält: mit der Variable die Token-Datei des Ordners (geprüft, der
  Schlüsselbund blieb), sonst den Eintrag im Schlüsselbund (nicht ausprobiert, um den echten Login nicht zu
  löschen). Das gilt dann auch für `agy` im Terminal; Nexa sagt das vor dem Abmelden des System-Accounts.
- **Wer angemeldet ist**: Der Token nennt keine Person. Jeder Start von `agy acp` schreibt sie in sein Log
  `<gemini-dir>/antigravity-cli/log/acp-server-*.log` („OAuth: authenticated successfully as <mail>“,
  „applyAuthResult: email=<mail>, authMethod=consumer“). Nexa nimmt die Adresse aus den fünf neuesten
  Logs, den Plan aus `session/new`.
- **Installation unter macOS und Linux** (laut `install.sh`, nicht ausgeführt): `agy` nach
  `~/.local/bin` (mit `--dir` woanders hin), Zwischenstand in `~/.cache/antigravity/staging`. Nexa sucht
  dort und im `PATH`.
- **API-Key**: aus Google AI Studio, als `GEMINI_API_KEY` in der Umgebung des Prozesses, mit eigenem Ordner
  (`--gemini-dir`). Ohne `modelProvider: "gemini"` in `antigravity-cli/settings.json` fragt Antigravity
  trotzdem nach dem Google-Login; Nexa schreibt den Schlüssel beim Anlegen und vor jedem Start.
- **Kontingente**: ACP nennt nur den Plan (`tier`). `agy -p "/usage" --output-format json` beantwortet den
  Befehl ohne Turn, ohne Kontingent und ohne Unterhaltung (~2,5 s; `/quota` ist dasselbe). Im JSON steht unter
  `command.data.groups[]` je Modellgruppe (`name`: „Gemini Models“, „Claude and GPT models“) eine Liste
  `buckets[]` mit `id` (`gemini-weekly`, `3p-5h`, `3p-weekly`), `name`, `window` (`weekly`, `5h`),
  `remaining_fraction` (0–1) und `reset_time` (UTC; `1970-01-01T00:00:00Z`, solange niemand den Bucket
  angebrochen hat). Ein abgeschalteter Bucket trägt `disabled`. Nexa macht daraus Fenster „Gemini · Woche“,
  „Claude/GPT · 5 Stunden“ … (`usageOfQuota`), die Titelleiste zeigt die Gruppe mit. Die Modelle einer
  Gruppe nennt ihre `description` („Models within this group: Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS
  120B“), Nexa hängt sie als `models` an ihre Fenster. Titelleiste und Account-Menü zeigen nur die Fenster
  der Gruppe des Modells, das gerade gilt (`windowsOfModel`): das des offenen Chats, sonst das für neue
  Chats. Verglichen wird ohne Klammerzusatz und unabhängig von der Schreibweise, „Claude Sonnet 4.6
  (Thinking)“ und `claude-sonnet-4-6` passen beide zu „Claude Sonnet 4.6“. Print-Mode kennt kein
  `--gemini-dir` (nur `acp`; `agy -p … --gemini-dir` zeigt nur die Hilfe) und liest `<home>/.gemini`. Für
  einen Account mit eigenem Ordner setzt Nexa deshalb `USERPROFILE`/`HOME` auf einen eigenen Ordner
  (`<tmp>/nexa-agy-home/<account>`), dessen `.gemini` ein Link (Junction) auf den Ordner des Accounts ist,
  sonst läse es den Login des Standard-Accounts. Ohne Login fragt Nexa nicht: Print-Mode wartet dann auf
  eine Anmeldung im Browser. Mit API-Key gibt es kein Kontingent (agy endet mit Code 2), Nexa fragt dann
  auch nicht. Gelesen wird beim Start, auf
  „Aktualisieren“, alle 5 Minuten nur, solange ein Chat des Accounts läuft, nach einem Turn höchstens einmal
  je Minute und nach einem Limit sofort. Geprüft mit 1.5.17.
- **Titel**: Antigravitys eigener (`session_info_update`, siehe oben); bis er kommt, die erste Zeile des
  ersten Prompts.

### Unterschiede zu Gemini CLI (bis Nexa 0.x)

- Befehl `agy acp` statt `gemini --acp`; Daten unter `<.gemini>/antigravity-cli/`, Einstellungen in
  getrennten Dateien statt einer `settings.json`.
- Systemprompt über `_meta`, Fortsetzen ohne Wiedergabe (`session/resume`), Modell und Denkstufe als
  `configOptions`, Werkzeugname und Argumente im Aufruf, Aufgabenliste über `update_steps`, Modus `auto`.
- Der Google-Login liegt im Schlüsselbund und gilt für alle Ordner; weitere Google-Logins trennt erst
  `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true` mit eigenem `--gemini-dir`.
- Gemini-Daten aus Nexa 0.x: Accounts von Gemini CLI fallen weg, Chats mit Gemini CLI wechseln zur
  Standard-CLI (ihr Verlauf bleibt), eine Standard-CLI „Gemini“ wird zu Claude Code
  (`provider-migration.ts`).

## MCP Apps

Erweiterung `io.modelcontextprotocol/ui` (SEP-1865, Spezifikation 2026-01-26): Ein Werkzeug nennt in
`_meta.ui.resourceUri` (älter: `_meta["ui/resourceUri"]`) eine `ui://`-Ressource, eine HTML-Seite
(`text/html;profile=mcp-app`), die der Host in einem Frame zeigt. `_meta.ui.visibility` sagt, wer das
Werkzeug aufrufen darf: `model`, `app` oder beide (ohne Angabe beide). Das `_meta.ui` der Ressource nennt
`csp` (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`), `permissions` und
`prefersBorder`. Wie Nexa sie zeigt: `ARCHITECTURE.md`, „MCP Apps“.

- **Seite ↔ Host**: JSON-RPC 2.0 über `postMessage`. Die Seite fragt `ui/initialize` (Antwort:
  `protocolVersion`, `hostInfo`, `hostCapabilities`, `hostContext` mit `theme`, `styles.variables`,
  `displayMode`, `containerDimensions`, `locale`, `timeZone`, `platform` …) und meldet
  `ui/notifications/initialized`; vorher schickt der Host nichts. Danach `ui/notifications/tool-input
  { arguments }` (einmal), dann `tool-result` (ein `CallToolResult`) oder `tool-cancelled { reason }`,
  bei Änderungen `host-context-changed`, zum Schluss die Anfrage `ui/resource-teardown`. Die Seite fragt
  `tools/call`, `resources/read`, `ping`, `ui/open-link { url }`, `ui/message { role: 'user', content }`,
  `ui/request-display-mode { mode }`, `ui/update-model-context` und meldet
  `ui/notifications/size-changed { width, height }` und `notifications/message`. Der Host muss
  `tools/call` für Werkzeuge ohne `app` in der `visibility` ablehnen und die CSP durchsetzen (ohne
  Angabe keine Verbindungen).
- **Claude Code** (geprüft mit 2.1.331, ohne Prompt über Steueranfragen): Mit
  `CLAUDE_CODE_MCP_APPS_HOST=1` in der Umgebung meldet es den Servern beim `initialize`
  `extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [...] } }`; Server, die darauf achten,
  bieten ihre Seiten erst dann an. Nexa setzt die Variable für Chats und für den Prozess, der ohne
  laufenden Chat liest (`CLAUDE_MCP_APPS_ENV`). `mcp_status` nennt die Werkzeuge samt `_meta`.
  `mcp_read_resource { serverName, uri }` (der Name wie in `mcp_status`, nur `ui://`) antwortet mit
  `{ contents: [{ uri, mimeType, text, _meta }] }`. `mcp_call { tool: "mcp__<server>__<werkzeug>",
  arguments, soft_error_result? }` (der Server wie in Werkzeugnamen: alles außer Buchstaben, Ziffern,
  `_` und `-` wird `_`) antwortet mit `{ content, structuredContent, _meta }`, `content` als Text für
  das Modell; die `visibility` prüft es nicht, das tut Nexa. Im Stream steht das Ergebnis eines
  MCP-Werkzeugs vollständig in `tool_use_result` (`content`, `structuredContent`, `_meta`,
  `resourceLinks`, bei zu großem Inhalt `structuredContentOmitted`). Ohne Login, mit leerem
  `CLAUDE_CONFIG_DIR`, gehen alle drei.
- **Codex** (geprüft mit 0.169): `mcpServerStatus/list` nennt die Werkzeuge mit `_meta`. Das Item
  `mcpToolCall` hat `mcpAppUi { resourceUri, preferredModelDisplayMode }` (älter `mcpAppResourceUri`),
  `appContext` und `result { content, structuredContent, _meta }`. `mcpServer/resource/read { threadId?,
  server, uri, originCallId? }` → `{ contents, originCallId }`; `mcpServer/tool/call { threadId, server,
  tool, arguments }` → `{ content[], structuredContent, _meta }`, nur mit Thread (ohne laufenden Chat
  ruft Nexa keine Werkzeuge der Seite auf). Den Servern meldet Codex die Erweiterung nicht: Server, die
  darauf achten, geben Codex keine Seite.
- **Antigravity CLI**: ACP kennt keine Seiten von Werkzeugen; Nexa zeigt dort keine.

## Checkpoints (Nexa)

Keine CLI gibt Nexa, was es für „Änderungen je Prompt“ braucht: Claude Code sichert in `-p` nichts
(„Checkpoints“ oben), Codex' `thread/revert` lässt die Dateien, ACP kennt nichts dergleichen. Nexa hält die
Ordner eines Chats deshalb selbst fest, für jede CLI gleich (`src/main/files/checkpoints.ts`):

- **Schatten-Repository** je Ordner unter `<Datenordner>/checkpoints/repos/<sha1 des Ordners>`, mit
  `GIT_DIR` dorthin und `GIT_WORK_TREE` auf den Ordner. Das Repository des Projekts bleibt unberührt (kein
  Index, keine Refs, kein Stash). Jeder Aufruf setzt `core.autocrlf=false`, `core.fsmonitor=false`,
  `gc.auto=0` und weitere Schalter selbst, ohne die `GIT_*`-Variablen der Umgebung; `info/attributes`
  (`* -text -filter -ident -working-tree-encoding`) steht über den `.gitattributes` des Projekts, so kommt
  eine Datei Byte für Byte zurück, auch unter LFS.
- **Stand** (`snapshot`): `ls-files --others --exclude-standard` und `--modified`, die Dateien per
  `update-index --add --remove`, dann `write-tree`. Unveränderte erkennt git am Index (wie `git status`),
  ab dem zweiten Stand dauert das nur so lange, wie sich etwas geändert hat. Weggelassen: was die
  `.gitignore` des Ordners ausschließt, `node_modules/`, `.venv/` u. a., die Regeln ohne Pfad aus
  `.gitignore`-Dateien darüber und das `info/exclude` des Projekts (auch eines Worktrees, über
  `commondir`), Dateien über 5 MB und Verknüpfungen (beide als „nicht gesichert“ mit Größe und Zeit, damit
  sich zeigt, wenn sie sich änderten), eingebettete Repositories. Der erste Stand eines Ordners mit über
  30 000 Dateien oder 500 MB unterbleibt (zehn Minuten lang nicht neu versucht), ebenso Laufwerke, der
  Benutzerordner und seine großen Ordner (Desktop, Dokumente, Downloads …).
- **Je Prompt** (`<Datenordner>/checkpoints/sessions/<Chat>.json`): vor einem Prompt, der einen Turn
  beginnt (nicht einem, der in einen laufenden geht), der Stand aller Ordner des Chats (Arbeitsordner und
  hinzugefügte, verschachtelte nur einmal); der Prompt wartet darauf höchstens 5 s. Am Ende des Turns der
  Stand danach und was sich geändert hat (`diff-tree --name-status` und `--numstat`), als `fileChanges` am
  Turn. Wartet ein Prompt auf den nächsten Turn, beginnt sein Stand, wo der letzte endet. Ein Stand, dessen
  Turn nie endete (CLI beendet), endet mit dem nächsten Prompt.
- **Zurückspulen** auf vor Prompt N: die Dateien, die der Agent in den Turns ab N änderte und die heute
  anders sind als vor N, als Vorschau (gegen einen frischen Stand); was seit dem letzten Turn auch
  außerhalb geändert wurde, ist markiert. Dann schreibt Nexa ihren Inhalt vor N selbst (`cat-file
  --batch`), löscht, was es vor N nicht gab (mit leer gewordenen Ordnern), und hält den Stand davor für
  „Zurücknehmen“ fest. Der Chat bleibt; die CLI erfährt es mit dem nächsten Prompt (`<nexa-rewind>`).
- **Aufräumen**: Abzweigen kopiert die Checkpoints, Bearbeiten eines Prompts streicht die der
  wegfallenden Prompts, Löschen des Chats seine. Ein Schatten-Repository, von dem kein Chat mehr
  Checkpoints hat, geht ganz; gc läuft sonst nie (keine Ref hält die Bäume).

## Nexa-MCP-Server

Streamable HTTP auf `127.0.0.1:<port>/mcp`, Bearer-Token. Jeder Run bekommt ein eigenes Token, das seinen
Chat nennt (`McpCaller.sessionId`): Claude über `--mcp-config`, Codex über `http_headers` des Threads,
Antigravity CLI über `mcpServers` in `session/new` (siehe oben). Werkzeuge: `render_chart`, `render_diagram`, `render_table`, `render_stats`, `render_callout`.
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

### Nachrichten zwischen Chats (`chat_*`)

Mit der Einstellung „Nachrichten zwischen Chats“ (`tools.chatTools`, aus bis der Nutzer sie einschaltet)
erreichen die Agents die anderen Chats, unabhängig von der CLI (`mcp/chat-tools.ts`), und durchsuchen sie
(`sessions_search` reicht wie `chat_read` in andere Chats und hängt deshalb am selben Schalter). Den
Absender kennt der Server am Token.

- `chat_list { query?, archived?, limit? }`: die anderen Chats, die neuesten zuerst, mit Titel, CLI,
  Projekt, Zustand und ID.
- `chat_read { chat, last? }`: die letzten Prompts und Antworten des Hauptstrangs (ohne Zwischentexte von
  Codex, ohne Subagents).
- `sessions_search { query, project?, limit? }`: frühere Chats, archivierte eingeschlossen, deren Titel oder
  deren Prompts und Antworten alle Wörter enthalten (Groß-/Kleinschreibung und Akzente egal,
  Anführungszeichen um die Wörter zählen nicht), die neuesten zuerst: Titel, CLI, Projekt, zuletzt aktiv
  (relativ und Datum), ID und ein Ausschnitt um den Treffer (`SessionService.search`, dieselbe Suche wie die
  Schnellsuche, mit ihrem Zwischenspeicher). `project` grenzt auf Projektname oder Ordner ein; 10 Treffer,
  höchstens 50. Gelesen wird ein Treffer mit `chat_read`.
- `chat_send { to, text }`: geht über `SessionService.sendFromChat` wie ein Prompt hinein (in den
  laufenden Turn oder mit Start der CLI) und steht im Chat mit `UserItem.from`.
- `chat_new { cli, text, title? }`: ein neuer Chat im Projekt und Ordner des Absenders, mit Account,
  Modell und Freigaben der Vorgaben; die Nachricht ist sein erster Prompt.

Ein Chat ist gemeint durch seine ID oder seinen Titel, wie er jetzt in der Sidebar steht (`resolveChat`:
ganz, am Anfang, als Teil, alle Wörter; Groß-/Kleinschreibung, Akzente und Anführungszeichen egal;
archivierte nur, wenn sonst keiner passt). Passen mehrere, gewinnt der im Projekt des Absenders, sonst
bekommt der Agent die Kandidaten. Die CLI bekommt die Nachricht als
`<nexa-message from-chat="…" chat-id="…" cli="…">…</nexa-message>` mit dem Hinweis, dass sie nicht vom
Nutzer ist, keine Freigaben ersetzt und mit `chat_send` an `chat-id` beantwortet wird
(`instructions.ts`, `chatMessage`). Grenzen: 20 Nachrichten und neue Chats je Chat in 10 Minuten
(`RATE_LIMIT`), 10 Nachrichten zwischen Chats in Folge, ohne dass der Nutzer in einem davon schrieb
(`MAX_CHAT_CHAIN`, `SessionState.chatChain`).

**Über Geräte hinweg** (`remote/remote-chats.ts`, `shared/remote-chats.ts`): Die Werkzeuge reichen auch in
die Chats der gekoppelten, bestätigten Geräte (`LinkedDevice.trusted`), über Remote Control (`chats.*`, siehe
„Remote Control“), Ende-zu-Ende verschlüsselt für die beiden Geräte.

- **Namen**: Ein Chat eines anderen Geräts heißt für den Agent „Gerät › Titel“ (`Laptop › Server-Umbau`) und
  hat die ID `<Instanz>:<Session>` (`remoteChatId`); ein Doppelpunkt steht in keiner Instanz- und keiner
  Session-ID, mit einer ID dieses Geräts verwechselt wird sie also nicht.
- **Auflisten und Suchen**: `chat_list` zeigt nach den eigenen Chats die jedes anderen Geräts, `limit` je
  Gerät, `query` trifft auch den Namen des Geräts. `sessions_search` lässt jedes Gerät selbst suchen
  (`findChats`) und mischt die Treffer nach letzter Aktivität. Ein Gerät, das nicht antwortet, nicht
  verbunden ist oder ablehnt, steht als eigene Zeile darunter; die übrigen Ergebnisse kommen trotzdem.
- **Auflösen** (`chat_read`, `chat_send`): erst wie bisher unter den eigenen Chats (`resolveChat`). Nur ein
  Name, der hier keinen trifft, meint einen anderswo: als ID, als „Gerät › Titel“ (auch mit `>`, `/`, `:` oder
  nur einem Leerzeichen, längster Gerätename zuerst; `splitDevice`), sonst als Titel unter den Chats aller
  Geräte, die antworten.
- **`chat_new { …, device?, project? }`**: legt den Chat auf dem genannten Gerät an (Name, Anfang des Namens
  oder Instanz; der eigene Name heißt hier), im Projekt `project` (ganzer Name, sonst Teil von Name oder
  Ordner), ohne es in dem, das heißt wie das des Absenders; sonst bekommt der Agent die Projekte dort.
- **Nicht erreichbar**: Ein Gerät, das der Server nicht als verbunden führt, wird nicht gefragt. Auflisten,
  Lesen und Suchen warten 10 Sekunden (`LOOK_TIMEOUT_MS`), Senden und Anlegen die 30 von Remote Control
  (danach: „kam vielleicht an, `chat_read` zeigt es“). Der Agent bekommt jeden Fehler und jede Ablehnung als
  englischen Satz mit dem Namen des Geräts (`DeviceChats`, `explain`).

Ob eine Nachricht ankommt, entscheidet das empfangende Gerät (`RemoteChatsHost`): nur von einem bestätigten
Mitglied, nur mit seiner eigenen Einstellung „Nachrichten zwischen Chats“ und nur so weit, wie die Stufe reicht,
die es dem Absender gibt (`read` zum Auflisten, Lesen und Suchen, `prompt` zum Senden und Anlegen; aus,
solange seine Fernsteuerung aus ist). Die Grenze der Kette gilt über Geräte hinweg: Der Absender schickt die
Stelle der Nachricht mit (`SessionService.chatOrigin`, abgelehnt schon dort über `MAX_CHAT_CHAIN`), der
Empfänger lehnt darüber ebenfalls ab und merkt sich die Stelle im Chat, sodass dessen Antwort weiterzählt;
der Prompt des Nutzers setzt sie wie bisher zurück. Dazu nimmt er je sendendem Chat 20 und je Gerät 60
Nachrichten in 10 Minuten. Die Nachricht steht mit `UserItem.from.device` im Chat, mit dem Namen, unter dem
der Empfänger das Gerät kennt (nicht dem, den der Absender nennt): „Nachricht von „Titel“ auf Laptop“. Die
CLI bekommt sie als `<nexa-message from-chat="…" device="…" chat-id="<Instanz>:<Session>" cli="…">`, sodass
`chat_send` an `chat-id` zum Chat auf dem anderen Gerät zurückfindet; `chat_read` nennt solche Nachrichten
„Message from the chat "…" on the device "…"“.

### Limits (`limits`)

`limits {}` (`mcp/limits-tool.ts`, aus dem Claude Manager) antwortet mit Text: CLI und Account, mit denen
der Chat läuft (`SessionService.chatAccount`: der der laufenden CLI, sonst der des nächsten Prompts), mit
Plan, je Limit-Fenster Verbrauch, Reset und Prognose (`ProviderService.usage()`, Fenster auf Englisch:
„5 hours“, „week“, „week, Opus“; ein Fenster, dessen Reset vorbei ist, zählt als leer), eine gescheiterte
Messung, ob die CLI das Limit meldete und bis wann Nexa den Account sperrt (`availability`, mit den
Sperren von `AutoSwitch`). Darunter die anderen sichtbaren Accounts der eingeschalteten CLIs in Kurzform
(API-Keys: ohne Plan-Limits; abgemeldet) und ob der automatische Wechsel am Limit an ist. Zeiten lokal mit
Zeitzone und Abstand („in 2 h“).

Das Werkzeug hat keinen eigenen Schalter: Es kommt mit dem Server, sobald einer der Schalter unter
„Nexa-Werkzeuge“ an ist (`nexaToolsOn`), und läuft ohne Rückfrage (`NexaToolGrant`, `app`). Es liest nur, und nur Zahlen des Nutzers, die die
Titelleiste ohnehin zeigt; es erreicht weder Chats noch Dateien noch das Netz.

### Rückfrage mit Formular (`ask_user`)

`ask_user { title, description?, fields: [{ key, label, type, description?, options?, default?, required? }],
submitLabel? }` (`mcp/ask-tool.ts`) zeigt im Chat des Aufrufers ein Formular und wartet auf die Antwort.
Typen: `text`, `textarea`, `number`, `boolean`, `select` und `multiselect` (mit `options`), `path`
(Ordner oder Datei, mit Auswahldialog). `formRequest` prüft die Felder (Titel, mindestens ein und höchstens
20 Felder, eindeutige Schlüssel, Optionen für Auswahlen) und verwirft Vorgaben, die nicht zum Feld passen.
Das Ergebnis ist JSON mit den Werten (leere Felder fehlen, Zahlen als Zahlen), bei „Ablehnen“ ein Satz, dass
der Nutzer abgelehnt hat; unbeantwortet (Turn angehalten, Run beendet) ein Fehler.

Im Chat ist es eine `InteractionItem` mit `request.type: 'form'` (Id `ask:<uuid>`), die Nexa selbst
beantwortet (`SessionService.ask`/`respond`), nicht die CLI. Solange sie offen ist, steht der Chat auf
„wartet“, mit Meldung wie bei den Fragen der CLIs. Bricht die CLI den Aufruf ab (die Verbindung schließt vor
der Antwort, `McpServerSpec.callTool` bekommt ein `AbortSignal`), verfällt das Formular. Codex wartet höchstens
`tool_timeout_sec` (900 s). Wie `limits` hat es keinen eigenen Schalter und läuft ohne Rückfrage; es kommt
nur für Verbindungen, die zu einem Chat gehören.

### Benachrichtigung (`notify`)

`notify { title, message?, actions?, waitMinutes? }` (`mcp/notify-tool.ts`) schickt dem Nutzer eine
Benachrichtigung über Nexa (`NotificationService.fromAgent`): ist ein Fenster von Nexa vorn, als Toast
darin, sonst als Meldung des Systems. Ein Klick öffnet den Chat des Aufrufers. `title` höchstens 120
Zeichen auf einer Zeile, `message` höchstens 600 (Klartext, Zeilenumbrüche bleiben), `actions` höchstens 3
Knöpfe mit je 40 Zeichen (doppelte fallen weg).

- **Ohne `actions`** kommt sofort zurück, dass sie gezeigt wurde und ein Klick den Chat öffnet.
- **Mit `actions`** wartet der Aufruf auf die Wahl: `The user picked "<Knopf>".`, `The user dismissed the
  notification without picking an action.` (Toast geschlossen, Systemmeldung weggeklickt mit
  `reason: 'userCanceled'`; ins Info-Center gerutscht, `timedOut`, lässt sie sich dort noch beantworten)
  oder nach `waitMinutes` (Vorgabe 10, höchstens 14: unter den 900 s, die Codex einem Aufruf lässt), dass
  niemand gewählt hat. Eine neuere Benachrichtigung desselben Chats (je Chat nur eine) beendet das Warten
  mit einem Hinweis darauf, ein angehaltener Turn (`AbortSignal`) oder gelöschter Chat mit einem Fehler.
- Knöpfe der Systemmeldung sind Electrons `actions: [{ type: 'button', text }]` (Windows: Toast-XML), das
  Ereignis `action` nennt `actionIndex`. Kommt ein Fenster nach vorn, während der Agent noch wartet, zeigt
  es die Knöpfe zusätzlich als Toast (`windowFocused`); was zuerst antwortet, gilt, und alle Toasts gehen
  weg (`event:agent-notification-done`). Antworten aus dem Fenster gehen über `notifications:answer`.
- Aus mit Einstellungen › Benachrichtigungen › „Von den Agents“ (`notifications.fromAgents`) oder mit
  Benachrichtigungen insgesamt; der Agent erfährt dann, dass nichts gezeigt wurde, und sagt es im Chat.

Wie `limits` und `ask_user` ohne eigenen Schalter beim Server und ohne Rückfrage (`NexaToolGrant`,
`app`), nur für Verbindungen eines Chats. Chats geplanter Aufgaben bekommen im Systemprompt den Hinweis,
dass niemand zusieht und `notify` der Weg zum Nutzer ist.

## nexa-server (Geräte)

Was der Server spricht (HTTP, WebSocket, Anmeldung, Relay, Schließcodes), steht im Repo nexa-server unter
`docs/PROTOCOL.md`; `src/shared/nexa-server/protocol.ts` und `auth.ts` sind Kopien seiner Dateien. Hier
steht, was die Geräte untereinander vereinbaren: Der Server reicht `body` nur weiter und gilt für Inhalte
als nicht vertrauenswürdig.

### Kopplungscode

`nexa1:` + base64url von `{ u, c, k, g }`: Adresse, Einladung, Schlüssel des Namespace (32 Byte) und
seine Generation. `g` ist Nexas Zusatz; das Protokoll lässt Clients Felder ergänzen, und ohne `g` ließe
sich der Schlüssel aus dem Code nicht gegen einen späteren ordnen (fehlt es, gilt 0). Das erste Gerät
eines Namespace macht den Schlüssel selbst (Generation 1).

### Nachrichten

`body` jeder `send`:

```json
{ "v": 1, "k": "<Id des Schlüssels oder pair>", "n": "<IV, 12 Byte>", "c": "<AES-256-GCM>" }
```

- `k`: die Id eines Schlüssels des Namespace (SHA-256 über `nexa/key-id/v1:` und den Schlüssel, die
  ersten 12 Byte, base64url) oder `pair` für den Schlüssel nur zweier Geräte: ECDH ihrer `dhKey`, durch
  HKDF-SHA-256 mit `nexa/pair/v1:<kleinere Id>:<größere Id>`.
- Associated Data: UTF-8 von `["nexa/msg/v1", from, to, kind, id, k]` (JSON). Ein Body, den der Server
  einer anderen Nachricht, einem anderen Absender oder einer anderen Art unterschiebt, geht nicht auf.
- Klartext: 64 Byte ECDSA-Signatur (P-256, SHA-256, IEEE P1363) mit dem Schlüssel, mit dem sich das Gerät
  anmeldet, dann UTF-8-JSON `{ at, d }`. Signiert sind die Associated Data und dieses JSON; den Schlüssel
  des Namespace kennen alle Geräte, erst die Signatur sagt, wer schrieb. `at` ist die Uhr des Absenders.
- Jede Nachricht hat eine zufällige `id` (12 Byte). Ein Gerät nimmt `(from, id)` nur einmal und nichts,
  dessen `at` mehr als 5 Minuten von seiner Uhr abweicht (`ReplayGuard`). Die gesehenen Ids hält es nur
  im Speicher: Kurz nach einem Neustart ginge eine Wiederholung aus dem Fenster davor noch durch.

### Mitglieder und Schlüssel

- **`member.hello`** (`{ instance, signKey, dhKey, reply? }`, mit dem Schlüssel des Namespace): nach
  jedem `ready` an alle. Wer ihn öffnen kann, dessen Signatur stimmt und dessen Schlüssel denen in der
  Liste des Servers gleichen, wird Mitglied; neue Mitglieder nur unter dem neuesten Schlüssel und nicht,
  solange nach einer Entfernung ein neuer aussteht. Auf jeden angenommenen Hello antwortet ein Gerät mit
  einem eigenen an den Absender, mit `reply: true`; einen solchen beantwortet es nicht, sonst ginge es hin
  und her. Die Schlüssel eines Mitglieds ändern sich nie; ein Hello mit anderen unter seiner Id gilt nicht.
- **Erneut fragen**: Ein Gerät, das der Server als verbunden führt und das noch kein Mitglied ist, bekommt
  nach 30 Sekunden einen eigenen Hello (ohne `reply`), danach jedes Mal nach doppelt so langer Zeit, bis
  höchstens alle 15 Minuten; nach jedem `ready` und wenn es neu online kommt, wieder ab 30 Sekunden. So
  finden zwei Geräte zusammen, wenn der erste Hello verloren ging oder verworfen wurde. Einen Hello unter
  einem Schlüssel, den es nicht hat, beantwortet ein Gerät nur, wenn er an alle ging und von einem
  Mitglied kommt: Ob er selbst eine Antwort war, lässt sich nicht lesen, und zwei Geräte mit einander
  fremden Schlüsseln antworteten sich sonst endlos.
- **Uhr**: Ein Hello, dessen `at` mehr als 5 Minuten abweicht, verwirft das Gerät und merkt sich die
  Abweichung (geprüft erst nach der Signatur, die Zeit ist also die des Absenders). Bei `ready` steht in
  der Liste des Servers `lastSeen` dieses Geräts, gestempelt beim Anmelden; daraus schätzt Nexa die
  eigene Abweichung zur Uhr des Servers. Beides zeigt Nexa nur an (Einstellungen › Geräte), es entscheidet
  nichts, denn der Server könnte bei seiner Zeit lügen. Ab 1 Minute Abweichung warnt die Karte
  „Verbindung“; ist die Uhr wieder richtig, fragt Nexa die übrigen Geräte gleich erneut.
- **`key.share`** (`{ key, members }`, mit dem Schlüssel `pair`): ein Schlüssel des Namespace und die
  Mitglieder, wie der Absender sie kennt. Nur von Mitgliedern, nur direkt, nur wenn der Empfänger und der
  Absender in `members` stehen. Ist der Schlüssel neuer (höhere Generation, bei gleicher die kleinere Id),
  wird er der aktuelle und `members` ersetzt die eigene Liste: So erfährt ein Gerät, das weg war, auch von
  Entfernungen. Ältere Schlüssel behält es (die letzten 4), um Geräte zu verstehen, die noch mit ihnen
  schreiben.
- **Sagt ein Mitglied Hallo mit einem älteren Schlüssel**, schickt ihm ein Gerät mit dem neueren einen
  `key.share`, vor dem eigenen Hello, der schon den neuen Schlüssel nutzt.
- **Nach `removed`** (oder fehlt ein Mitglied in der Liste von `ready`) macht das Mitglied mit der
  kleinsten Id unter den verbundenen einen neuen Schlüssel und schickt ihn jedem übrigen Mitglied als
  `key.share`. Die anderen warten 20 bis 30 Sekunden und machen ihn selbst, wenn keiner kam; ändern zwei
  ihn zugleich, setzt sich der mit der kleineren Id durch.
- **Grenzen**: Arbeitet der Server mit einem entfernten Gerät zusammen und war ein Gerät während der
  Entfernung weg, kann er ihm den neuen Schlüssel vorenthalten; es schreibt dann weiter mit dem alten. Ein
  Gerät, das der Server allein in die Liste setzt, sieht man in Einstellungen › Geräte als „Nicht
  bestätigt“.

### Remote Control (`rc.*`)

Zwischen zwei Mitgliedern, mit dem Schlüssel `pair` (nur diese beiden lesen mit). Die Steuerung ruft die
Fenster-API des Hosts auf, als wäre sie eins seiner Fenster: Seitenleiste, Chatfenster und Dock sind
dieselben Komponenten, nur auf Stores dieses Geräts (`scopedStore`, `apiOf` in
`src/renderer/src/stores/device.ts`). Der Host prüft jeden Aufruf selbst gegen die Stufe, die er dem
fragenden Gerät gibt; was die andere Seite glaubt, zählt nicht. Typen, Liste der Kanäle und Prüfungen in
`src/shared/remote.ts`, Host und Steuerung in `src/main/remote`.

- **Stufen** je Gerät, beim Host eingestellt (Einstellungen › Geräte › Fernsteuerung, gespeichert in
  `nexa-server.json` unter `remote`): `off`, `read` (Chats, Verlauf, Einstellungen, CLIs und Konten
  lesen, beobachten), `prompt` (dazu Prompts senden, bearbeiten, abbrechen, Chats anlegen, umbenennen,
  anheften, verschieben, Projekte und Trenner ordnen), `full` (alles, was das Fenster am Gerät selbst darf:
  Modell, CLI, Konto, Effort und Modus im Dock, Rückfragen, Freigaben und Pläne, Shell-Befehle, MCP-Server,
  Plugins, Einstellungen, Löschen). Jede Stufe schließt die davor ein. Ohne Eintrag gilt `read`; solange
  die Fernsteuerung aus ist, `off` für alle.
- **`rc.request`** `{ m, p }`, beantwortet mit **`rc.response`** `{ re, r }` oder `{ re, e: { code, message } }`;
  `re` ist die `id` der Anfrage. `code` (vom Host): `disabled`, `forbidden`, `not-found`, `bad-request`,
  `too-large`, `failed` (`message` sagt dann warum, auf Deutsch).

| `m` | `p` | Antwort | Stufe |
|---|---|---|---|
| `hello` | – | `{ name, enabled, level, version }`: wer der Host ist und wie weit er das fragende Gerät lässt | jede |
| `watch` | `{ ids, fresh? }` | `{ name, enabled, level, version, renewed }`: welche Chats das Gerät offen hat, ersetzt die letzte Wahl | `read` |
| `unwatch` | – | `null` | jede |
| `invoke` | `{ ch, args }` | was der Handler des Kanals im Fenster liefert | je Kanal |
| `chats.list` | – | `{ chats }`: die Chats des Hosts, die neuesten zuerst, archivierte eingeschlossen (höchstens 500) | `read` |
| `chats.read` | `{ id, last }` | `{ chat, transcript }`: die letzten Prompts und Antworten als Text (`chatTranscript`, `last` höchstens 30) | `read` |
| `chats.search` | `{ query, project? }` | `{ found: [{ chat, hit? }], total }` (höchstens 50) | `read` |
| `chats.send` | `{ from, chain, to, text }` | `{ chat }`, wie er vor der Nachricht war | `prompt` |
| `chats.new` | `{ from, chain, provider, text, title?, project?, near? }` | `{ id, title, project }` | `prompt` |

- **`chats.*`**: die Werkzeuge der Agents (`chat_*`, „Nachrichten zwischen Chats“), mit Absicht getrennt von
  `invoke`. Nach der Stufe prüft der Host (`RemoteChatsHost`), ob das Gerät bestätigt ist, ob seine Einstellung
  `tools.chatTools` an ist, die Kette (`chain` über `MAX_CHAT_CHAIN`: `failed`) und wie viel der Chat und das
  Gerät schon schickten (`forbidden`). `from` ist `{ sessionId, title, provider }` des sendenden Chats; das
  Gerät dazu nimmt der Host aus seiner eigenen Liste. Texte höchstens 100 000 Zeichen; `near` ist der Name des
  Projekts des Absenders. `message` von Ablehnungen und Fehlern ist hier Englisch, für den Agent;
  `forbidden` der Stufe sagt `needs level <Stufe>`.
- **`invoke`**: `ch` ist ein IPC-Kanal (`sessions:send`, `settings:get` …), `args` seine Argumente (höchstens
  8). Der Host führt ihn mit dem Handler aus, den seine Fenster nutzen (`invokeHandler` in
  `src/main/ipc.ts`, mit einem Absender `{ sender: null, remote: true, device }`, den `remoteCaller`
  erkennt). Nur Kanäle in `CHANNELS` (`channelLevel`) gehen, jeder mit seiner Stufe; was mit den Fenstern,
  Dialogen, Terminals oder dem Browser des Hosts arbeitet, nicht, Dateien nur in den Ordnern seiner Chats
  (siehe „Dateien“). Manche hängen von den Argumenten ab: `sessions:update` braucht
  `full`, sobald es Felder des Agents ändert (`provider`, `account`, `model`, `effort`, `ultracode`,
  `permissionMode`, `dirs` …), sonst `prompt`; `sessions:create` braucht `full` mit `cliArgs` oder einem
  Modus außer `ask` und `plan`.
- **Bilder** eines Prompts liegen auf dem steuernden Gerät: Es liest sie selbst (`remote:upload-image`,
  höchstens 20 MB, png/jpg/gif/webp) und schickt sie als `invoke` von `app:save-image` mit den Bytes als
  base64; der Host legt sie zu seinen Anhängen und gibt den Pfad zurück, der dann im Prompt steht. Im
  Verlauf bleiben die Pfade des Hosts; das Fenster lädt sie über `nexa-file://device?instance=…&session=…&path=…`,
  main holt sie mit `invoke` von `sessions:image { id, path }` (`read`): `{ type, data }` mit den Bytes als
  base64, nur für ein Bild, das ein Prompt dieses Chats hat (sonst `null`), höchstens 20 MB. main hält
  zuletzt gezeigte bis 64 MB.
- **MCP Apps** eines Chats des Hosts: `mcp-apps:page { id, itemId }` (`read`) gibt die Seite (`html`,
  `meta`) und das Ergebnis des Werkzeugs (`result`, das `slimItem` aus dem Item lässt). Das steuernde Gerät
  prüft die Seite wie eine eigene (`appPageOf`) und stellt sie unter seiner eigenen Adresse
  (`nexa-app://<token>/`) mit ihrer CSP bereit. Was die Seite von ihrem Server will, geht an den Host:
  `mcp-apps:read-resource` (`read`), `mcp-apps:call-tool` (`full`, ein Werkzeug handelt wie der Agent).
- **Checkpoints**: `sessions:changes`, `sessions:change-diff` und `sessions:rewind-preview` mit `read`,
  `sessions:rewind` und `sessions:rewind-undo` (schreiben Dateien des Hosts) mit `full`.
- **Dateien** (Dateibaum, Änderungen, Branch eines Chats des Hosts): `files:list`, `files:status`,
  `files:search-list`, `files:watch`, `files:diff`, `files:review-base`, `files:grep`, `files:history`,
  `git:branch`, `git:watch`, `git:web-url` und `git:main-worktree` mit `read`; `files:create`,
  `files:rename`, `files:trash`, `files:stage`, `files:unstage`, `files:discard` und `files:hunk` mit
  `full`. Jeder Pfad muss absolut sein und in einem Ordner der Chats des Hosts liegen (Projektordner,
  Arbeitsordner, Worktree, zusätzliche Ordner), sonst `failed` „Der Ordner gehört zu keinem Chat auf
  diesem Gerät.“. Geprüft wird der Pfad selbst (nach `path.resolve`, `..` führt nicht hinaus); wohin
  eine Verknüpfung in einem solchen Ordner zeigt, prüft der Host nicht. `files:watch` und `git:watch` nimmt der Host nur von einem Gerät, das beobachtet (sonst
  `null` ohne Wirkung); die Listen ersetzen jeweils die letzte des Geräts und gelten getrennt von denen
  der eigenen Fenster, bis die Beobachtung endet. Danach (auch nach `fresh: true`) meldet die Steuerung
  ihre Ordner neu. `git:worktree-check` bleibt beim Host.
- **Beobachten**: Mit `watch` nennt das Gerät die Chats, die es geöffnet hat (höchstens 32); `sessions:open`
  über `invoke` nimmt den Chat sofort dazu. Eine Wahl gilt 90 Sekunden, die Steuerung erneuert sie alle
  30 Sekunden. `renewed: false` heißt, der Host kannte keine (Neustart, abgelaufen) oder das Gerät bat mit
  `fresh: true` um einen neuen Anfang: Was dazwischen geschah, kam nicht an, die Steuerung liest alles neu.
  Geht das Gerät offline oder sinkt seine Stufe unter `read`, endet die Beobachtung sofort.
- **`rc.events`** `{ events }`: die Fenster-Ereignisse des Hosts, jedes als `{ ch, args }` (`REMOTE_EVENTS`):
  Einstellungen, CLIs, Nutzung, Konten, Projekte, Trenner, die Liste der Chats und `session:event`; davon
  `item`, `delta` und `truncated` nur für die beobachteten Chats, `runtime` für alle. Dazu die des
  Dateibaums: `event:files-changed` und `event:git-branch-changed` nur für Ordner, die das Gerät mit
  `files:watch` bzw. `git:watch` überwacht, `event:files-touched` nur für seine beobachteten Chats; wartende Änderungen
  desselben Ordners fasst der Host zusammen (Ordner vereint, `git`/`repo` verodert). Die Listen
  (`LIST_EVENTS`: Konten, Projekte, Trenner, Chats) gehen als `{ ch, diff: { ids, changed } }`: die Ids in
  ihrer Reihenfolge und die Einträge, die sich gegenüber dem letzten Stand dieses Geräts geändert haben.
  Die Steuerung setzt daraus die ganze Liste zusammen (`applyDiff`); fehlt ihr ein Eintrag, beginnt sie mit
  `watch` und `fresh: true` neu. Gebündelt alle 100 ms (bei einem Server, der wenige Nachrichten je Sekunde
  erlaubt, seltener: Bündel nehmen höchstens ein Viertel seiner `rateLimit`); Deltas desselben Items hängt
  der Host aneinander, ein neuer Stand eines Items, Laufzustands oder einer Liste ersetzt den wartenden.
  Kommt ein Bündel nicht an (der Server meldet `busy` oder `unreachable`), endet die Beobachtung dieses
  Geräts: Mit der nächsten Erneuerung bekommt es `renewed: false` und liest neu, statt mit einer Lücke
  weiterzumachen.
- **Was nicht mitgeht**: lange Texte über die Textgrenze (64 KB) in Items, die der Host nach UTF-8-Bytes
  kürzt (`slimItem`): Prompts und Antworten bei der vierfachen Grenze, Ausgaben von Werkzeugen von vorn
  (das Ende zählt); die Ergebnisse der Werkzeuge mit Seite (`appResult`), die mit der Seite kommen.
- **Lange Chats in Seiten**: `sessions:open` bringt nur die neuesten Items, etwa 1 MB davon
  (`remoteWindow`, `REMOTE_ITEMS_BYTES`), und in `older` die Zahl der Items davor. Ein Chat mit Tausenden
  Werkzeugaufrufen hat auch gekürzt Dutzende MB, in Teilen über den Server dauerte das länger als die
  30 s einer Anfrage („Das Gerät hat nicht geantwortet“). Die Items davor holt die Steuerung beim
  Hochscrollen mit **`sessions:older`** `[sessionId, itemId]` → `{ items, older }`, Stufe `read`: die
  Items vor diesem, wieder etwa 1 MB. Ein Fenster beginnt nach Möglichkeit mit einem Prompt. So ändern
  sich die Blöcke darüber nicht, wenn die davor kommen; in einem einzelnen langen Turn geht es bis zu
  4 MB zurück zu seinem Prompt. `truncated { length }` zählt alle Items des Chats, auch die noch nicht
  geholten.
- **Reihenfolge**: Nachrichten zwischen zwei Geräten verlassen und erreichen `DeviceChannel` in der
  Reihenfolge, in der sie geschrieben wurden, auch wenn das Verschlüsseln unterschiedlich lange dauert.
  Öffnet ein Gerät einen Chat (`sessions:open`), verwirft der Host die für ihn noch wartenden Ereignisse
  dieses Chats: Sie stecken in der Antwort, und was danach kommt, folgt ihr. Die Steuerung ignoriert
  Ereignisse eines Chats, bis seine Items da sind, wie ein Fenster bei einem lokalen.
- **Größe und Teile**: Der Server nennt in `ready` seine Grenzen (`limits.maxMessageBytes`,
  `limits.rateLimit`); ein Server, der das noch nicht tut, gilt als einer mit den Vorgaben (1 MB, 100 je
  Sekunde). Über `maxMessageBytes` trennt er die ganze Verbindung, deshalb schickt `DeviceChannel` keinen
  versiegelten Body über `maxMessageBytes − 1 KB`. Wie viel JSON dafür in Klartext passt, rechnet
  `payloadLimit`. Eine größere Nachricht (ein langer Verlauf, eine große Liste) geht in Teilen der Art
  **`rc.part`** `{ m, k, i, n, s }`: die Id und Art der ganzen Nachricht, die Nummer des Teils von `n`
  und sein Stück JSON (`splitForJson` teilt so, dass jedes Stück als JSON-String unter die Grenze passt und
  kein Ersatzpaar zerreißt). Höchstens 64 Teile; der Empfänger setzt sie zusammen und öffnet dann die
  ganze Nachricht. Teile, die nicht alle binnen 60 Sekunden kommen, verwirft er; von einem Absender hält er
  höchstens 16 Nachrichten in Teilen zugleich. Lehnt der Server einen Teil ab, gilt das für die ganze
  Nachricht (`messageOf`). Jeder Teil ist eine eigene Nachricht des Servers und zählt für seine
  `rateLimit`; der Server selbst braucht dafür nichts Neues.
- **Abgelehnt vom Server**: `busy` (das Gerät liest nicht schnell genug) wird zu `busy`,
  `unknown-instance` (entfernt) zu `gone`, sonst `unreachable`; jeweils sofort, ohne auf die Zeitgrenze
  von 30 Sekunden zu warten.
