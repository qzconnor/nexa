# Ideen

Gesammelt am 25.11.2026 aus dem Code von Nexa und im Vergleich mit dem Claude Manager (CM,
`F:\Projekte\Apps\claude-manager`). Nichts davon steht auf der Roadmap. Wer eine Idee angeht, trägt sie in
`ROADMAP.md` ein und streicht sie hier.

- **Kennungen**: P Performance, M MCP, E Einstellungen, U Oberfläche, R Render-Werkzeuge,
  W Werkzeugaufrufe der CLIs, N Nachrichten.
- **Aufwand**: S (Stunden), M (ein, zwei Tage), L (mehr).
- **Pfade**: `main/…` = `src/main/…`, `renderer/…` = `src/renderer/src/…`, `shared/…` = `src/shared/…`.
- **Messwerte**: an den echten Chats auf diesem Rechner, nur gelesen, mit den Bibliotheken des Projekts in
  Node gemessen, nicht in der laufenden App.
- **Ungeprüft**: Was nur aus Doku oder Zeichenketten der CLIs stammt, ist markiert.

## Zuerst

Die zehn Ideen, die hier standen (P1, P2, P4, P9, U2, U4, N1, W1, M1, E2), sind umgesetzt und in
`ROADMAP.md` abgehakt. Was von P2 und W1 offen ist, steht unten.

## Performance

| | Idee | Nutzen | Aufwand |
|---|---|---|---|
| P2 | Markdown blockweise rendern | mittel | M |
| P3 | Schnellsuche ohne komplettes Einlesen aller Verläufe | hoch | M |
| P5 | Geöffnete Chats wieder aus dem Speicher nehmen | hoch | M |
| P6 | Deltas bündeln, nur an Fenster mit dem Chat | mittel–hoch | M |
| P7 | Beim Öffnen nicht den ganzen Verlauf übertragen | hoch bei großen Chats | S / L |
| P8 | Chat-DOM begrenzen, Inline-Diffs kürzen | mittel | S |
| P10 | Claude-Probes aus dem laufenden Chat bedienen | mittel | S–M |
| P11 | Session-Liste als Delta statt ganz | gering–mittel | S / M |
| P12 | Abgleich liest nur das Ende des Transkripts | gering–mittel | S–M |
| P13 | Login-Dateien nur bei Änderung lesen | gering | S |
| P14 | xterm mit WebGL, Ausgabe nur an ein Fenster | gering–mittel | S |

**P2 – Markdown blockweise rendern**
- Beim Streamen rendert `Markdown.vue` höchstens alle 80 ms und ohne Hervorhebung, die kommt am Ende.
  Jedes Rendern parst aber noch den ganzen Text und ersetzt das ganze DOM der Antwort.
- Vorschlag: den stabilen Teil bis zur letzten Leerzeile außerhalb eines Codeblocks cachen und nur den
  Rest neu rendern.

**P3 – Schnellsuche ohne komplettes Einlesen aller Verläufe**
- Beim Öffnen der Schnellsuche liest `SessionService.search` alle nie geöffneten importierten Chats.
  `readClaudeChat` lädt dabei jedes Transkript ganz als String und parst es synchron im Main-Thread.
- Hier sind das 228 Sessions mit 1,5 GB, die größte hat 184 MB. Das blockiert Main für Sekunden: CLI-Streams
  und IPC stehen still. Behalten wird davon etwa 0,6 %.
- Dasselbe gilt für `artifactChats` und `stats`.
- Vorschlag: zeilenweise lesen und Zeilen ohne `user`/`assistant` vor `JSON.parse` verwerfen. Ein Index je
  Datei (mtime, Größe) auf der Platte, in einem Worker gebaut, gemeinsam für Suche, Artefakte und Turns.

**P5 – Geöffnete Chats wieder aus dem Speicher nehmen**
- Der Renderer gibt einen Chat nur beim Löschen frei, Main nie (`s.items`). Jedes Chat-Fenster hält eine
  eigene Kopie.
- `searchCache` hält Prompts und Antworten doppelt, `browsers.stills` ein JPEG je Browser-Karte, beides ohne
  Grenze.
- Der größte Chat hat 27 MB Items, der Renderer belegte 844 MB Working Set.
- Vorschlag: LRU im Renderer (aktiver Chat, laufende Chats, die letzten 2–3), in Main `items` freigeben für
  Chats ohne Run und Fenster, beide Caches begrenzen.

**P6 – Deltas bündeln, nur an Fenster mit dem Chat**
- Jeder Chunk der CLI ist eine eigene IPC-Nachricht. `main/ipc.ts` schickt alle Ereignisse aller Chats an
  alle Fenster, auch ganze Werkzeug-Items (hier bis 87 KB).
- Terminals bündeln schon alle 8 ms, `!`-Befehle alle 250 ms.
- Vorschlag: Deltas je Item 16–33 ms sammeln; `item`, `delta` und `truncated` nur an Fenster, die den Chat
  offen haben; `runtime` weiter an alle.

**P7 – Beim Öffnen nicht den ganzen Verlauf übertragen**
- `SessionService.open` gibt alle Items zurück. Beim größten Chat: 80 ms Parsen und 39 MB, davon 15 MB
  Ausgaben von Werkzeugen. Gezeigt werden 40 Blöcke und Ausgaben bis 20 000 Zeichen. Die Eingabe von
  Edit/Write erscheint nie, wenn es `changes` gibt.
- Schritt 1 (S): Ausgaben vor dem Senden auf das Gezeigte kürzen, den Rest auf Anfrage holen. `input`
  weglassen, wenn es `changes` gibt.
- Schritt 2 (L): Items seitenweise holen, passend zu den Seiten der `MessageList`.

**P8 – Chat-DOM begrenzen, Inline-Diffs kürzen**
- Die `MessageList` hängt neue Blöcke an, kürzt oben aber nie.
- Diffs sind ab Werk offen, auch in gefalteten Gruppen. `chat/DiffView.vue` legt jede Zeile als `<tr>` an:
  Eine neue Datei mit 659 Zeilen ergibt 659 Zeilen DOM. `changeLines` läuft doppelt.
- Vorschlag: Folgt der Chat unten, den Anker nachziehen, sodass höchstens etwa zwei Seiten im DOM sind.
  `content-visibility: auto` je Block; das ungenutzte `MessageScrollerItem.vue` kann das schon.
  Inline-Diffs ab etwa 200 Zeilen mit „Alle Zeilen“, `changeLines` per WeakMap cachen.

**P10 – Claude-Probes aus dem laufenden Chat bedienen**
- `commands()` und `models()` starten je Account und Ordner alle 5 Minuten einen `claude`-Prozess, der
  samt MCP-Servern 20 s lebt.
- Dabei schickt der laufende Chat selbst `initialize` und verwirft die Antwort, die genau `commands` und
  `models` enthält.
- Vorschlag: `initialize` und `commands_changed` des Chats in `commandCache`/`modelCache` schreiben.

**P11 – Session-Liste als Delta statt ganz**
- Jede Änderung schickt `list()` an alle Fenster, sortiert dabei alle Sessions (hier 248, 253 KB).
- `sessionExists` nutzt `list().find`, also eine Sortierung je Prüfung. `chatWindows.keepSessions` prüft
  bis zu 100-mal je Änderung.
- Vorschlag: `has(id)` in O(1), später Ereignisse `upsert`/`removed`.

**P12 – Abgleich liest nur das Ende des Transkripts**
- Läuft eine Sitzung auch woanders, liest `readClaudeChatSince` bei Fokus und alle 5 s die ganze Datei
  (bis 184 MB), sobald sich die mtime ändert.
- Vorschlag: den Offset merken und nur ab dort lesen.

**P13 – Login-Dateien nur bei Änderung lesen**
- Alle 15 s und bei jedem Aufruf von `ProviderService.context` liest Nexa `.credentials.json` und
  `.claude.json` synchron (hier bis 370 KB). Bei Antigravity kommen `readdirSync`/`statSync` aller Logs dazu.
- Vorschlag: asynchron lesen, nur bei neuer mtime parsen, `context` aus dem Snapshot bedienen.

**P14 – xterm mit WebGL, Ausgabe nur an ein Fenster**
- Das Terminal zeichnet mit dem DOM-Renderer, und Main schickt die Ausgabe an alle Fenster.
- Vorschlag: `@xterm/addon-webgl` mit Rückfall bei Kontextverlust; Ausgabe nur an das Fenster mit dem
  Terminal.

Schon gut gelöst:
- Dateibaum und Datei-Diffs sind virtualisiert.
- Transkripte sind append-only JSONL, Streaming-Text wird erst am Ende geschrieben, `sessions.json` nach
  400 ms gebündelt.
- Mermaid, Charts und Sprachen von highlight.js laden erst bei Bedarf.
- Datei-Watcher bündeln und filtern, Browser-Bilder sind gedrosselt.
- Main macht vor dem ersten Fenster wenig.

## Neue Features: MCP

| | Idee | Aufwand |
|---|---|---|
| M2 | Startbefehle und Terminal für den Agenten | M |
| M3 | Werkzeuge je MCP-Server einzeln an und aus | M |
| M4 | Zustand, Fehler und Logs der Server in den Einstellungen | M |
| M5 | Server übernehmen aus Claude Desktop, Cursor, VS Code, Windsurf; „JSON einfügen“ | M (JSON: S) |
| M6 | Meldung vom Agenten (`notify_user`) | S |
| M7 | Katalog: Plugins und Server aus den Marktplätzen der CLIs | M |
| M8 | Nexa-Werkzeuge umschalten ohne Neustart des Chats | M |
| M9 | Themes über MCP | S |
| M10 | Dem Nutzer etwas in Nexa zeigen (`show_file`, `show_changes`) | S–M |
| M11 | Server-Dialog: Anmelden, Zeitgrenzen, Arbeitsordner | S |

**M2 – Startbefehle und Terminal für den Agenten**
- Der Agent liest die Ausgabe des Dev-Servers aus den Startbefehlen und startet ihn neu. Er kann eine
  sichtbare Shell öffnen, hineinschreiben (auch Strg+C) und auf „ready“ warten.
- CM: `shell_open/input/output/list/close` (`main/browser/app-tools/shells.ts`), mit eigenem Schalter, ab
  Werk aus. In Nexa gibt es `StartCommands` und `Terminals` schon, nur nicht über MCP.
- Wo: neu `main/mcp/shell-tools.ts`, `services/start-commands.ts`, `services/terminals.ts`, `tool-grant.ts`.

**M3 – Werkzeuge je MCP-Server einzeln an und aus**
- Unter jedem Server die Liste seiner Werkzeuge mit Schalter, in der CLI-Konfiguration und im „+“-Menü.
  Spart Kontext und sperrt heikle Werkzeuge.
- Antigravity: `enabledTools`/`disabledTools`. Codex: `enabled_tools`/`disabled_tools` (laut Doku,
  ungeprüft). Claude: `permissions.deny` mit `mcp__<server>__<werkzeug>`.
- Die Namen liefern `mcp_status`, `mcpServerStatus/list` und `GetMcpServerStates` schon;
  `McpServerInfo.tools` ist heute nur eine Zahl.
- Wo: `shared/cli-config.ts`, `shared/types.ts`, `providers/*/…-config.ts`, `providers/mcp-servers.ts`,
  `CliConfigMcp.vue`, `McpServerDialog.vue`, `ComposerAddMenu`.

**M4 – Zustand, Fehler und Logs der Server in den Einstellungen**
- In der CLI-Konfiguration an jedem Server „Verbunden“, „Fehler“ oder „Anmelden nötig“ mit Fehlertext, dazu
  „Testen“ und „Log anzeigen“. Heute gibt es den Zustand nur im „+“-Menü eines Chats.
- Claude Code schreibt je Server ein JSONL-Log nach
  `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<projekt>\mcp-logs-<server>\`. Antigravity liefert `error` in
  `GetMcpServerStates`, Claude in `mcp_status`.
- Wo: `services/cli-config-service.ts`, neu `providers/claude/claude-mcp-logs.ts`, `CliConfigMcp.vue`,
  `CliConfigOverview.vue`.

**M5 – Server übernehmen aus Claude Desktop, Cursor, VS Code, Windsurf; „JSON einfügen“**
- Nexa liest die Server dieser Apps, zeigt sie zur Auswahl und trägt sie in eine CLI ein oder macht sie
  global.
- Dazu „JSON einfügen“ für einen `{"mcpServers": …}`-Block aus einer README.
- Quellen: `%APPDATA%\Claude\claude_desktop_config.json`, `~/.cursor/mcp.json`,
  `%APPDATA%\Code\User\mcp.json` bzw. `.vscode/mcp.json` (`servers`, `inputs`),
  `~/.codeium/windsurf/mcp_config.json`. `claude mcp add-from-claude-desktop` gibt es unter Windows nicht.
- Wo: neu `main/import/mcp-import.ts`, `services/global-mcp.ts`, `McpServerDialog.vue`.

**M6 – Meldung vom Agenten (`notify_user`)**
- Der Agent meldet sich mitten in der Arbeit, etwa „Dev-Server läuft, bitte prüfen“. Ein Klick öffnet den
  Chat.
- Heute gibt es Meldungen nur bei „fertig“, Rückfrage, Limit und Login. Die Einstellungen (an/aus, nur im
  Hintergrund, Ton) gelten weiter.
- Wo: neu `main/mcp/notify-tool.ts`, `services/notification-service.ts`.

**M7 – Katalog: Plugins und Server aus den Marktplätzen der CLIs**
- Eine Seite mit den nicht installierten Plugins (Beschreibung, Logo), installieren per Klick.
- Codex liefert sie in `plugin/list` und installiert über `plugin/install`. Claude Code hat
  `claude plugin install` und Marktplätze. Nexa kann heute nur ein- und ausschalten.
- Wo: `providers/plugins.ts`, `ComposerPluginsMenu`, eigener Tab der CLI-Konfiguration.

**M8 – Nexa-Werkzeuge umschalten ohne Neustart des Chats**
- Der Server meldet `tools: { listChanged: false }` und beantwortet GET mit 405, kann also keine Änderung
  melden.
- Claude Code verarbeitet `notifications/tools/list_changed`; Codex und Antigravity ungeprüft.
- Wo: `main/mcp/mcp-protocol.ts`, `mcp-server.ts` (GET-SSE je Token), `services/settings-service.ts`.

**M9 – Themes über MCP**
- `themes_list`, `theme_create`, `theme_update`, `theme_apply`, mit Hinweis auf zu wenig Kontrast.
- CM hat das in `main/browser/app-tools/themes.ts`, und Nexa nutzt dasselbe Theme-Format.
- Wo: neu `main/mcp/theme-tools.ts`, `services/theme-service.ts`.

**M10 – Dem Nutzer etwas in Nexa zeigen (`show_file`, `show_changes`)**
- Der Agent öffnet eine Datei an einer Zeile in der Dateiansicht oder „Alle Änderungen“, statt Pfade zu
  nennen. Für den Browser gibt es das mit `browser_navigate` schon.
- Wo: neu `main/mcp/view-tools.ts`, Ereignis in `shared/ipc.ts`/`preload`, `stores/file-tree.ts`,
  `stores/ui.ts`.

**M11 – Server-Dialog: Anmelden, Zeitgrenzen, Arbeitsordner**
- „Anmelden“ auch in der CLI-Konfiguration, nicht nur im „+“-Menü; `authenticateMcp` gibt es schon.
- Felder für Zeitgrenzen (Codex `startup_timeout_sec`/`tool_timeout_sec`, Antigravity `timeoutSeconds`) und
  `cwd`; Nexa lässt sie heute unbearbeitet stehen.
- Wo: `McpServerDialog.vue`, `CliConfigMcp.vue`, `shared/cli-config.ts`, `*-config.ts`.

## Neue Features: Einstellungen

| | Idee | Aufwand |
|---|---|---|
| E1 | Vorgaben je Projekt (CLI, Account, Modell, Aufwand, Freigaben) | M |
| E3 | Nexa-Werkzeuge einzeln schalten, Freigabestufen für den Browser | S |
| E4 | Prompt-Vorlagen mit Platzhaltern | M |
| E5 | Umgebungsvariablen je CLI und Account (Proxy, Telemetrie) | S–M |
| E6 | Einstellungen fürs Terminal | M |
| E7 | Prompt für alle Chats; Nexas eigener Teil abschaltbar | S |
| E8 | Tastenkürzel anpassen | M |
| E9 | Token und API-Key vor Befehlen verbergen | S |
| E10 | „Zurücksetzen“ je Karte | S |
| E11 | Terminals beim Start wiederherstellen | M |
| E12 | Kleinere: Abfrage-Intervall der Limits, Ordner für neue Projekte, Seite des Dateibaums | S |

**E1 – Vorgaben je Projekt**
- Jedes Projekt bekommt eigene Vorgaben für neue Chats, etwa „Kundenprojekt startet mit Account B und
  ‚Fragen‘“. Gelten auch für `chat_new` und `nx`.
- `Project` hat heute nur `mcpOff` und `startCommands`, Vorgaben gibt es nur global.
- Wo: `shared/types.ts`, `services/project-service.ts`, `SessionService.create`, `mcp/chat-tools.ts`,
  `launch.ts`, Dialog im Kontextmenü des Projekts.

**E3 – Nexa-Werkzeuge einzeln schalten, Freigabestufen für den Browser**
- Eigene Schalter für „Limits lesen“ und „Frühere Chats durchsuchen“. Für den Browser „ohne Nachfrage
  bedienen“ und „auch heikle Werkzeuge ohne Nachfrage“.
- Heute hängt `sessions_search` am Schalter „Nachrichten zwischen Chats“, `limits` ist immer an, und heikle
  Browser-Werkzeuge fragen immer.
- CM: `limitsTool`, `sessionsTool`, `browserToolsAllowed`, `browserSensitiveAllowed`
  (`shared/defaults.ts`).

**E4 – Prompt-Vorlagen mit Platzhaltern**
- Textbausteine global oder je Projekt, mit `{{datei}}`, `{{branch}}`, `{{auswahl}}`. Sie stehen in der
  `/`-Vervollständigung und im „+“-Menü und gehen in jeder CLI gleich; `/` zeigt heute nur Befehle der CLIs.
- Wo: `snippets.json`, `lib/composer-suggest.ts`, `ComposerAddMenu`, neue Seite der Einstellungen.

**E5 – Umgebungsvariablen je CLI und Account**
- Mit Vorlagen: `HTTPS_PROXY`/`NO_PROXY`, `DISABLE_TELEMETRY`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `MCP_TIMEOUT`, `ANTHROPIC_BASE_URL`. Geheime Werte
  verschlüsselt.
- `ProviderSettings` kennt heute nur `extraArgs`. Nexas eigene Abfragen bräuchten zusätzlich
  `session.setProxy`.
- Wo: `shared/accounts.ts`, `accounts/account-env.ts`, `lib/secrets.ts`, `SettingsProviders.vue`.

**E6 – Einstellungen fürs Terminal**
- Schriftgröße, Zeilenhöhe, Cursor, Scrollback, „Beim Markieren kopieren“, Rechtsklick fügt ein, Warnung
  vor mehrzeiligem Einfügen.
- Heute fest in `lib/terminal-session.ts`. CM: `SettingsTerminal.vue`, `lib/paste-guard.ts`.

**E7 – Prompt für alle Chats; Nexas eigener Teil abschaltbar**
- Eine Anweisung für jeden Chat jeder CLI, als äußerste Ebene vor Trenner und Projekt. Dazu ein Schalter
  für Nexas Teil des Systemprompts, um Tokens zu sparen.
- CM: `claude.appContext`. Nexa: nur je Projekt und Trenner (`folder-prompts.ts`), `sessionInstructions`
  hängt immer an.

**E8 – Tastenkürzel anpassen**
- Eigene Belegung für die Kürzel aus `shared/shortcuts.ts`, die heute fest verdrahtet sind. Die Übersicht
  selbst ist U7.

**E9 – Token und API-Key vor Befehlen verbergen**
- Ein Token, das Nexa an Claude Code gibt, sehen Bash, Hooks und MCP-Server nicht.
- CM: `claude.hideSecretsFromCommands` über `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`. Laut CM startet Claude Code
  dann immer im Standardmodus; das muss die Einstellung sagen.

**E10 – „Zurücksetzen“ je Karte**
- Ein Knopf im Kopf jeder Karte der Einstellungen setzt sie auf die Vorgabe zurück, mit Rückfrage und
  „Rückgängig“ im Toast.
- CM: `components/settings/SettingsSection.vue` mit `lib/settings-reset.ts`, an 7 Karten.

**E11 – Terminals beim Start wiederherstellen**
- Offene Terminals der Chats kommen nach einem Neustart wieder, wahlweise erst, wenn man sie ansieht.
- CM: `general.restoreTerminals`, `restoreAsleep` (`services/terminal-restore.ts`).

**E12 – Kleinere Einstellungen**
- Abfrage-Intervall der Limits (heute fest 5 min in `provider-service.ts`; CM `usageRefreshMinutes`).
- Ordner für neue Projekte (`defaults.projectsFolder` hat keine Zeile).
- Seite des Dateibaums (CM `appearance.fileTreeSide`).

## Oberfläche

| | Idee | Aufwand |
|---|---|---|
| U1 | Schmales Fenster: dem Chat bleibt Platz | M |
| U3 | Drag & Drop ins Eingabefeld für alle Dateien | S–M |
| U5 | Abbrüche der CLI als Karte mit Aktionen | S–M |
| U6 | Archivieren mit Rückweg | S–M |
| U7 | Tastenkürzel sichtbar machen | S–M |
| U8 | Chat-Zeilen der Seitenleiste per Tastatur | S |
| U9 | Tooltips vereinheitlichen | S |
| U10 | Barrierefreiheit | S |
| U11 | Startseite und Laden eines Chats | S |
| U12 | Einheitliche Menüs, Knöpfe und Texte | S |
| U13 | Schriftgrößen als Tokens | M |

**U1 – Schmales Fenster: dem Chat bleibt Platz**
- Die Seitenleiste ist fest 17rem breit und klappt nie ein. Es gibt keine Breakpoints.
- Terminal und Browser halten je für sich 360 px frei, zusammen nicht. Bei 1366 px mit Seitenleiste und
  beiden Panels schrumpft der Chat auf 0; bei 1100 px wird der Browser rechts abgeschnitten.
- Vorschlag: Panels gemeinsam begrenzen (Chat mindestens 360 px) oder als Tabs in ein rechtes Panel legen.
  Unter etwa 1000 px die Seitenleiste als Overlay. Strg+B für die Seitenleiste, Breite ziehbar
  (`lib/separator-keys.ts`).

**U3 – Drag & Drop ins Eingabefeld für alle Dateien**
- Heute gehen nur Bilder. Eine PDF, eine `.ts`-Datei oder ein Ordner aus dem Explorer verschwindet ohne
  Rückmeldung.
- Der Rahmen flackert, weil `dragleave` an jedem Kind feuert. Auch ein Chat aus der Seitenleiste wird als
  Ablage angenommen.
- Vorschlag wie CM `TerminalPane.vue`: `dragDepth` zählen, nur `Files` und Dateibaum annehmen, ein Overlay
  „Loslassen hängt Bilder an und erwähnt Dateien“, der ganze Chat als Ablage. Andere Dateien werden zur
  `@`-Erwähnung, Ordner zu „Ordner hinzufügen“.

**U5 – Abbrüche der CLI als Karte mit Aktionen**
- Heute steht roher stderr-Text als rote Fläche unter dem Chat: ohne Überschrift, ungekürzt, ohne Aktion.
- Vorschlag wie die Leiste „Prozess beendet“ in CM `TerminalPane.vue`: eine Zeile („Claude Code wurde mit
  einem Fehler beendet“), Details zum Aufklappen, „Chat neu starten“, „Letzten Prompt erneut senden“,
  „Kopieren“.

**U6 – Archivieren mit Rückweg**
- „Archivieren“ lässt den Chat sofort verschwinden, ohne Toast und ohne Fehlerbehandlung. Es gibt keine
  Archiv-Ansicht; zurückholen geht nur bei offenem Chat über die Befehlsliste.
- Vorschlag: Toast mit „Rückgängig“ wie beim Löschen. Dazu „Archiv (n)“ am Ende der Seitenleiste oder als
  Filter der Schnellsuche, und „Aus dem Archiv holen“ im Kontextmenü.

**U7 – Tastenkürzel sichtbar machen**
- Viele Kürzel (Strg+Umschalt+T, Strg+Tab, Strg+1–9, Strg+Umschalt+E, F3, Strg+M …) sieht man nirgends:
  „Neuer Chat“ und der Knopf der Seitenleiste haben keinen Tooltip, „Einstellungen“ zeigt nie „Strg+,“.
  Der Befehlsliste fehlen Kürzel, für Dateien und Browser sogar die Befehle.
- Vorschlag: Tooltips mit Kürzel wie CM `NavRail.vue`, `CommandShortcut` an allen Befehlen, eine Seite
  „Tastenkürzel“ im `?`-Modus der Schnellsuche, erzeugt aus `shared/shortcuts.ts`.

**U8 – Chat-Zeilen der Seitenleiste per Tastatur**
- Umbenennen und Löschen gehen nur per Rechtsklick; F2 und Entf tun nichts, obwohl `lib/tab-keys.ts` das
  kann. Gekürzte Titel haben keinen Tooltip, und der Zustand ist nur an der Farbe zu erkennen.
- Vorschlag wie CM `SessionListItem.vue`: F2, Entf, Strg+Enter, Kürzel im Kontextmenü, Tooltip mit vollem
  Titel und Zustand in Worten („Wartet auf dich“), Zustand auch als Text für Screenreader.

**U9 – Tooltips vereinheitlichen**
- 31 Icon-Knöpfe haben nur ein `aria-label`, unter anderem in ChatView, Composer, TitleBar,
  Einstellungen, Accounts, Artefakte und CLI-Konfiguration. `BrowserLog.vue` hat nicht einmal das.
- Rund 25 native `title`-Attribute stehen da, obwohl `lib/tooltip.ts` sie ersetzen soll; in `ChatView.vue`
  erscheinen deshalb zwei Tooltips. Dass ein Doppelklick den Chattitel umbenennt, sagt nichts.
- Vorschlag: überall `v-tooltip`, mit Kürzel; ein Test, der Icon-Knöpfe ohne Tooltip meldet.

**U10 – Barrierefreiheit**
- Englische Texte in den Grundbausteinen: `Spinner.vue` („Loading“, rund 75-mal), `DialogContent.vue`
  („Close“).
- `text-muted-foreground/70` bei 0,7rem in der Seitenleiste erreicht in mehreren Themes nur 3,1–4,1 : 1.
- Das X an angehängten Bildern erscheint nur beim Hover, nicht bei Tastaturfokus.
- Vorschlag: „Lädt …“, „Schließen“, `/70` weglassen, `focus-visible:opacity-100`.

**U11 – Startseite und Laden eines Chats**
- Die Startseite zeigt nur Logo, Projektwahl und Eingabe. Ein Chat lädt mit einem einzelnen Spinner, dann
  springt der Verlauf herein.
- Vorschlag wie CM `TerminalEmptyState.vue`: zuletzt genutzte Projekte, eine Zeile mit Kürzeln; beim Laden
  Skeletons.

**U12 – Einheitliche Menüs, Knöpfe und Texte**
- Die vier wichtigsten „Löschen“ sind per Klasse rot statt `variant="destructive"`, beim Hover verliert sich
  das Rot.
- Senden ist rund, Anhalten an derselben Stelle eckig.
- Die Auslassungspunkte sind uneinheitlich („Chat umbenennen…“ neben „Startbefehle …“).
- Manche Meldungen sagen „Session“ statt „Chat“. Der Slider-Daumen hat `bg-white`.

**U13 – Schriftgrößen als Tokens**
- 20 feste Größen an rund 240 Stellen (`text-[0.8rem]`, `text-[11px]`, `text-[0.78rem]` …), viele weniger
  als einen halben Pixel auseinander. CM kommt mit fast nur `text-[11px]` aus.
- Vorschlag: zwei, drei Zwischenstufen als Tokens in `@theme` (`main.css`), die festen Werte darauf
  umstellen.

Schon in Ordnung: Umlaute und Anführungszeichen in sichtbaren Texten, Theme-Tokens fast überall, Fokus-Ringe,
Trenngriffe per Tastatur, einheitlicher Aufbau der Dialoge.

## Chat: neue Render-Werkzeuge

Ein statisches Werkzeug ist S: Spec in `shared/chat.ts`, Prüfung in `shared/render.ts`, Definition in
`main/mcp/render-tools.ts`, Name in `lib/tools.ts`, Zweig in `RenderBlock.vue`, ein Satz in den
Anweisungen. Was antwortet oder sich aktualisiert, braucht Zustand und ist M. Die Rückfrage mit Formular
(`ask_user`) gibt es schon.

| | Idee | Aufwand |
|---|---|---|
| R1 | Vorgeschlagene nächste Schritte (`suggest_next_steps`) | S |
| R2 | Live-Fortschritt (`render_progress`) und `id` für alle `render_*` | M |
| R3 | Bildergalerie und Vorher/Nachher (`render_images`) | S / M |
| R4 | HTML-Vorschau (`render_html`) | M |
| R5 | Änderung zeigen, ohne sie zu schreiben (`render_diff`) | S / M |
| R6 | Datei- und Datenbaum (`render_tree`) | M |
| R7 | `render_code` freischalten oder entfernen | S |

**R1 – Vorgeschlagene nächste Schritte**
- 2–4 Knöpfe unter der Antwort. Ein Klick setzt den Prompt in die Eingabe, Umschalt+Klick sendet ihn. Nach
  dem nächsten Prompt werden sie grau.
- Parameter: `{ actions: [{ label, prompt, icon? }] }`.
- Der Weg in die Eingabe (`composer.insert`) existiert, MCP Apps und Review-Kommentare nutzen ihn.
- Claude Code schlägt den nächsten Prompt schon selbst vor (`SessionRuntime.suggestion`, grau im
  Eingabefeld). R1 wäre der Weg für Codex und Antigravity, die keinen eigenen haben.

**R2 – Live-Fortschritt und `id` für alle `render_*`**
- Eine Liste, die ein weiterer Aufruf mit derselben `id` an Ort und Stelle aktualisiert. Mit derselben `id`
  wachsen auch Charts und Tabellen mit, etwa bei Benchmarks oder einer Migration über viele Dateien.
- Parameter: `{ id, title, percent?, items: [{ label, status: 'pending'|'running'|'done'|'error', detail? }] }`.
- Heute ist jedes Render-Item unveränderlich. Die To-do-Liste gibt es nur einmal je CLI.
- Wo: `chatBlocks` zeigt den neuesten Stand je `id` an der ersten Stelle.

**R3 – Bildergalerie und Vorher/Nachher**
- Ein Raster mit Unterschriften; ein Klick öffnet den Bildbetrachter. Mit `compare: true` zwei Bilder mit
  Schieberegler.
- Hilft bei UI-Arbeit mit dem Browser (Screenshots in mehreren Breiten).
- Parameter: `{ title?, images: [{ path, caption? }], compare? }`. `nexa-file://image` und
  `ImageViewer.vue` gibt es.

**R4 – HTML-Vorschau**
- Mockups, SVG und kleine Widgets laufen im Chat, ohne Netz.
- Parameter: `{ title?, html, height? }`.
- Die Technik steht seit MCP Apps: `McpAppViews` liefert unter `nexa-app://` mit CSP aus, `McpAppBlock.vue`
  rahmt mit Sandbox und passt die Höhe an.
- Anders als Claudes `Artifact` bleibt das lokal und geht mit jeder CLI.

**R5 – Änderung zeigen, ohne sie zu schreiben**
- Ein gefärbter Diff für „so würde es aussehen“ oder zwischen zwei Git-Ständen einer Datei.
- Parameter: `{ title?, path, before?, after?, from?, to? }`. `chat/DiffView.vue` zeichnet das schon.

**R6 – Datei- und Datenbaum**
- Eine Ordnerstruktur mit Symbolen, Notizen und Status je Eintrag; ein Klick öffnet die Datei. Oder JSON als
  aufklappbarer Baum. Ersetzt ASCII-Bäume in Codeblöcken.
- Parameter: `{ kind: 'files', entries: [{ path, note?, status? }] }` bzw. `{ kind: 'json', data }`.
- Bausteine: `lib/file-icons.ts`, `lib/file-tree.ts`, `useOpenFile`.

**R7 – `render_code` freischalten oder entfernen**
- `render_code` steht in `shared/render.ts` und `RENDER_NAMES`, und `RenderBlock` zeichnet es. Die
  Definitionen in `render-tools.ts` bieten es aber nicht an, kein Agent kann es aufrufen.
- Entweder freigeben mit `{ code, language?, path?, startLine?, highlight?, run? }`: Zeilennummern,
  hervorgehobene Zeilen, „Öffnen“, bei Shell-Code „Ausführen“ als `!`-Befehl in die Eingabe. Oder die halbe
  Sache entfernen.

Nicht empfohlen:
- Zeitleiste und Gantt: Das kann `render_diagram` mit Mermaid schon.
- Karte: Kacheln aus dem Netz, für Coding-Agenten selten nützlich.
- Kanban: To-do-Liste und Tabelle reichen.
- Audio und Video: zu selten.

## Chat: Werkzeugaufrufe der CLIs

| | Idee | Aufwand |
|---|---|---|
| W1 | Plan-Modus von Codex mit Freigabe | M |
| W2 | Bilder aus Werkzeugen | S / M |
| W3 | Befehle und Ausgaben wie im Terminal | M |
| W4 | Web-Suche und Web-Abruf als Quellen | M |
| W5 | Lesen und Suchen mit Vorschau | S |
| W6 | Subagenten: Auftrag und Ergebnis an der Karte | S |
| W7 | Pläne und Artefakte bleiben lesbar | S / M |
| W8 | Diffs im Chat wortgenau und kommentierbar | S / M |

**W1 – Plan-Modus von Codex mit Freigabe**
- Nexa zeigt den Plan von Codex (`plan`, `item/plan/delta`) als eigenen Block. Den Plan-Modus selbst
  (`collaborationMode`) nutzt Nexa nicht: Der Modus „Plan“ ist bei Codex nur `read-only`.
- Vorschlag: im Modus „Plan“ den Plan-Modus von Codex nehmen und den Plan wie bei Claude zur Freigabe
  vorlegen.
- Wo: `codex-run.ts`, `codex-overrides.ts`, `PROTOCOLS.md`.

**W2 – Bilder aus Werkzeugen**
- Vorschaubilder unter der Werkzeugzeile, ein Klick öffnet den Bildbetrachter. Betrifft:
  - Claudes `Read` eines Bildes
  - Bilder in MCP-Ergebnissen (Screenshots, Figma)
  - Codex `imageView` und `imageGeneration`
- `resultText` und `mcpResultText` behalten heute nur Text.
- Für Pfade reicht `nexa-file://` (S). Base64 aus MCP müsste Main als Datei ablegen (M).

**W3 – Befehle und Ausgaben wie im Terminal**
- ANSI-Farben mit der Palette des Themes, `\r`-Fortschrittszeilen zusammengefasst.
- Anfang und Ende der Ausgabe statt der ersten 20 000 Zeichen: Heute fehlt das Ende, wo Testergebnisse und
  Fehler stehen. Dazu „Ganze Ausgabe“.
- Den Befehl mit Syntaxfarben zeigen, Kopieren an Befehl und Ausgabe.
- Der Renderer kennt kein ANSI; Codex' `aggregatedOutput` kommt roh.
- Wo: neu `lib/ansi.ts`, `ToolRow.vue`, `ShellOutput.vue`, `UserShellBlock.vue`.

**W4 – Web-Suche und Web-Abruf als Quellen**
- WebSearch als Liste von Quellen (Titel, Domain); ein Klick öffnet sie im Browser des Chats. WebFetch mit
  Status, Größe und „Im Browser öffnen“.
- Claude liefert das strukturiert in `tool_use_result`: WebSearch `{ query, results: [{ content: [{ title,
  url }] }] }`, WebFetch `{ bytes, code, codeText, result, url }`. Nexa zeigt heute JSON.

**W5 – Lesen und Suchen mit Vorschau**
- `Read` mit Syntaxfarben und dem Bereich im Kopf („Zeilen 120–180“).
- Grep, Glob, LS (auch Codex `search`/`listFiles`, Antigravity `grep_search`/`find_by_name`) als klickbare
  Dateiliste mit Symbolen.
- `languageOf`/`highlightText` und `lib/file-icons.ts` gibt es.

**W6 – Subagenten: Auftrag und Ergebnis an der Karte**
- `AgentCard.vue` zeigt nur Zustand, Werkzeugzahl und Dauer; das Ergebnis steht erst in `AgentThread.vue`.
- Vorschlag: Auftrag und Ergebnis (Markdown) an der Karte aufklappen, der Verlauf bleibt per Klick
  erreichbar.

**W7 – Pläne und Artefakte bleiben lesbar**
- Ein angenommener Plan bleibt eingeklappt im Verlauf („Plan anzeigen“), statt auf „Plan angenommen“ zu
  schrumpfen.
- Antigravitys `walkthrough.md` und `task.md` als Dokumentkarte statt als Diff einer neuen Datei.
- Claudes `Artifact`-Aufruf als Karte mit Vorschaubild und „Öffnen“, wie auf der Seite „Artefakte“.

**W8 – Diffs im Chat wortgenau und kommentierbar**
- `lib/word-diff.ts` und `useLineComments` nutzt nur die Dateiansicht, nicht `chat/DiffView.vue`.
- Vorschlag: geänderte Wörter markieren (S). Zeilenkommentare am Diff im Chat, die wie Review-Kommentare
  in die Eingabe gehen (M).

## Chat: Nachrichten

Gibt es schon:
- Bearbeiten und neu senden
- Abzweigen vom Ende
- Suche im Chat (Strg+F)
- Export als Markdown
- Dauer und Tokens je Turn
- angeheftete Chats

| | Idee | Aufwand |
|---|---|---|
| N2 | Zitieren | S |
| N3 | Abzweigen ab jeder Antwort | M |
| N4 | Von Prompt zu Prompt springen | M |
| N5 | Mermaid, Mathe und HTML-Vorschau im Markdown | M |
| N6 | Lange Prompts und eingefügten Text einklappen | S |
| N7 | Lesezeichen für Nachrichten | M |
| N8 | Export als HTML und PDF, vollständigeres Markdown | M |
| N9 | Zusammenfassung des Kontexts lesbar machen | S |
| N10 | Antworten vergleichen | L |

**N2 – Zitieren**
- Text in einer Antwort, einem Gedanken oder einer Ausgabe markieren, dann fügt „Zitieren“ `> …` an der
  Schreibmarke ein. Baut auf `composer.insert` auf.

**N3 – Abzweigen ab jeder Antwort**
- „Ab hier abzweigen“ weiter oben: ein neuer Chat mit dem Verlauf bis dorthin.
- Die Abzweigpunkte berechnet das Bearbeiten schon für jeden Prompt: `forkPoint`, Codex `thread/fork` mit
  `lastTurnId`, `forkAntigravity`.

**N4 – Von Prompt zu Prompt springen**
- Marken der Prompts an der Bildlaufleiste, Strg+↑/↓ zum vorigen und nächsten Prompt, „Zu Prompt …“ in der
  Befehlsliste.
- Da die Liste je 40 Blöcke nachlädt, muss der Sprung bis zum Ziel nachladen. CM: `lib/turn-marks.ts`.

**N5 – Mermaid, Mathe und HTML-Vorschau im Markdown**
- ```` ```mermaid ```` als Diagramm mit Umschalter „Quelltext“, `$…$`/`$$…$$` mit KaTeX, bei ```` ```html ````
  und ```` ```svg ```` ein Knopf „Vorschau“ (wie R4).
- Diagramme gibt es heute nur über `render_diagram`, das Codex, Antigravity und Claude ohne Nexa-Werkzeuge
  nicht nutzen.

**N6 – Lange Prompts und eingefügten Text einklappen**
- Prompts über etwa 600 Zeichen mit „Ganz zeigen“, eingefügte Logs als „Eingefügter Text · N Zeilen“, ein
  Umschalter Markdown/Text.
- `AgentThread.vue` hat das Muster (`LONG_TASK`). CM: `PastedBlock.vue`.

**N7 – Lesezeichen für Nachrichten**
- Nachrichten markieren. Eine Liste im Menü des Chats und in der Schnellsuche, auch über Chats hinweg; ein
  Klick springt hin (wie bei N4).

**N8 – Export als HTML und PDF, vollständigeres Markdown**
- Eigenständiges HTML (Farben des Themes, gefärbter Code, Diagramme als SVG) und PDF über `printToPDF`.
- `chatMarkdown` überspringt heute Render-, Interaktions- und Todo-Items. Ergänzen:
  - Tabellen und Kennzahlen als Markdown-Tabellen
  - Diagramme als ```` ```mermaid ````
  - beantwortete Rückfragen
  - Diffs

**N9 – Zusammenfassung des Kontexts lesbar machen**
- Der Trenner „Kontext zusammengefasst“ klappt die Zusammenfassung auf, die die CLI ab dort kennt.
- Im Claude-Transkript steht sie als eigene Nachricht. Ob der Stream sie liefert, ist ungeprüft.
- CM: `TranscriptMessage.vue`.

**N10 – Antworten vergleichen**
- „Auch Codex/Antigravity fragen“ an einem Prompt: abzweigen, denselben Prompt an die andere CLI schicken,
  beide Antworten nebeneinander.
- Dazu die Versionen eines bearbeiteten Prompts durchblättern („‹ 2/3 ›“). Dafür müsste Nexa die Items
  beim Bearbeiten aufheben statt verwerfen.

## Erwogen und verworfen

- Sicherung aller Chats: Es gibt den Markdown-Export einzelner Chats; der Bedarf ist nicht belegt.
- Oberfläche auf Englisch: Aufwand L, kein Bedarf genannt.
- MCP-Werkzeuge für Zwischenablage und Screenshots: Datenschutz, wenig Nutzen.
- CLI-Fähigkeiten aus `PROTOCOLS.md`, die nicht hierher passen: Claude `get_session_cost`, `set_cwd`,
  `cancel_async_message`, `apply_flag_settings` (vielleicht für Werkzeugsperren ohne Neustart, ungeprüft).
