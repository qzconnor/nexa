# Architektur

## Prozesse

```
Renderer (Vue)  ──IPC──>  Main (Electron)  ──stdio JSON──>  claude -p … / codex app-server
      ^                      │    │
      └── Events ────────────┘    ├── Nexa-MCP-Server (HTTP, 127.0.0.1) <── Agenten rufen render_* und browser_* auf
                                  └── Lokale API (HTTP + SSE, 127.0.0.1) <── nx, Stream Deck, Skripte
```

- **Main** hält den gesamten Zustand: Projekte, Sessions, laufende CLI-Prozesse, Usage. Der Renderer
  zeigt an und schickt Aktionen; er bekommt einen Snapshot beim Öffnen einer Session und danach Events.
- **Renderer** hat keinen Node-Zugriff (Sandbox, contextIsolation). Bilder lokaler Dateien kommen über
  das Protokoll `nexa-file://image?path=…`, das nur Bildformate ausliefert.

## Main

| Datei | Aufgabe |
| --- | --- |
| `index.ts` | Start, Single-Instance, `nx`-Weiterleitung, Verdrahtung der Services |
| `ipc.ts` | Alle IPC-Kanäle, Event-Weiterleitung an die Fenster |
| `launch.ts` | Liest `--nx=<base64>` und die `nx`-Argumente |
| `services/settings-service.ts` | `settings.json`, Defaults aus `shared/defaults.ts` |
| `services/theme-service.ts` | Themes (aus dem Claude Manager übernommen) |
| `services/provider-service.ts` | Registriert Provider, Erkennung, Usage je Account (Abfrage, Polling), Browser-Logins |
| `accounts/account-service.ts` | Accounts (`accounts.json`), Profilordner, Login-Stand aus den Dateien der CLIs |
| `accounts/account-env.ts` | Umgebung, mit der die CLI eines Accounts startet |
| `accounts/account-login.ts` | `claude auth login` / `codex login` ohne Terminal: Link, Code, Ergebnis |
| `accounts/cli-files.ts` | Wo die CLIs Login und Verläufe ablegen, Auslesen von Konto, Plan und Ablauf |
| `accounts/claude-usage.ts` | Claude-Limits über die OAuth-Usage-Schnittstelle |
| `accounts/session-transfer.ts` | Kopiert die Unterhaltung einer CLI beim Account-Wechsel in den neuen Ordner |
| `services/project-service.ts` | Projekte (Ordner) und Trenner, ihre Reihenfolge; `project-sections.ts` macht ein Projekt zum Trenner |
| `import/claude-manager.ts` | Übernahme aus dem Claude Manager: Workspaces → Trenner mit Projekten, Accounts mit denselben Ordnern, Sessions aus deren Transkripten; Kanäle `import:*` in `import-ipc.ts` |
| `import/claude-sessions.ts` | Transkripte eines Claude-Ordners auflisten, ein Transkript samt Subagents als Chat lesen |
| `providers/claude/claude-transcript.ts` | Claude-Code-Transkript (`projects/<key>/<id>.jsonl`) → `ChatItem`s wie aus dem Stream, plus Kurzfassung (Ordner, Titel, Zeiten) |
| `services/session-service.ts` | Sessions: Metadaten, Items, Runs starten/stoppen, Wechsel der CLI, Statistik |
| `services/transcript-store.ts` | Verlauf je Session als JSONL |
| `services/instructions.ts` | Systemprompt-Zusatz und Übergabe-Kontext beim CLI-Wechsel |
| `providers/provider.ts` | Schnittstellen `AgentProvider`, `AgentRun`, `RunSink` |
| `providers/claude/*` | Claude Code: Prozess je Session, Stream-JSON, Werkzeug-Abbildung |
| `providers/codex/*` | Codex: ein App-Server je Account für alle seine Sessions, JSON-RPC, Item-Abbildung |
| `lib/secrets.ts` | Ver- und Entschlüsseln von Token und Keys (`safeStorage`) |
| `lib/shell-env.ts` | Linux: übernimmt beim Start die Umgebung der Login-Shell (PATH mit nvm & Co.), damit die CLIs auch beim Start aus dem Anwendungsmenü gefunden werden |
| `lib/linux.ts` | Wie die Linux-Version installiert ist (AppImage, deb, rpm); `cliEnv` nimmt mit `withoutAppImageEnv` die Pfade des AppImage-Mounts aus der Umgebung der CLIs |
| `services/update-service.ts` | Updates aus den GitHub-Releases (electron-updater, Suche nach 10 s und alle 4 h), Versionshinweise über die GitHub-API bzw. den Atom-Feed; Kanäle `updates:*` in `updates-ipc.ts` |
| `mcp/*` | Nexa-MCP-Server (Streamable HTTP): `render_*` und `browser_*` (`nexa-tools.ts`), ein Token je Run nennt den Chat (`McpCaller`); `tool-grant.ts` legt fest, welche Werkzeuge die CLIs ohne Rückfrage nutzen |
| `browser/browser-tabs.ts` | Tabs der Browser je Chat (`browser-tabs.json`): welche Seiten, welche gezeigt, wer sie geöffnet hat |
| `browser/browser-control.ts` | Aus dem Claude Manager: steuert die Seiten für die Agents über das DevTools-Protokoll (`page-driver.ts`, Frames, Netzwerk, Routen, Dialoge, Emulation), Protokoll, Übernehmen |
| `browser/browser-tools/*` | Die `browser_*`-Werkzeuge (aus dem Claude Manager), `BROWSER_INSTRUCTIONS` für den Server |
| `browser/browser-ipc.ts` | Kanäle `browser:*` (Tabs, Seiten, Downloads, Logins, Übernehmen) |
| `browser/browser-frames.ts` | Live-Bilder der Seiten für die Browser-Karten im Chat (`beginFrameSubscription`, JPEG, gedrosselt), solange ein Fenster zusieht |
| `api/api-server.ts` | Lokale REST-API mit Token |
| `files/file-tree-service.ts` | Dateibaum aus dem Claude Manager: Ordner lesen und überwachen, Git-Status, Diffs, Suche, Vormerken/Verwerfen, angefasste Dateien (`touched`) |
| `files/git-service.ts` | Branch, Checkouts, Web-Adresse und Hauptordner eines Repositorys |
| `files/activity-tracker.ts` | Leitet aus den Werkzeug-Items der Sessions ab, was der Agent mit Dateien tut (live und aus dem Verlauf) |
| `files/file-activity.ts`, `files/shell-files.ts` | Shell-Befehle: welche Dateien sie nennen, schreiben, ob sie committen |
| `files/files-ipc.ts` | Kanäle `files:*` und `git:*` mit Prüfung der Pfade |
| `window/*` | Hauptfenster, Fensterzustand, Material (Mica/Acryl), Datei-Protokoll |
| `window/browser-*.ts` | Härtung der `<webview>`s (eigene Partition, keine Node-Integration, Berechtigungen, Popups, Navigation, Tastenkürzel), Downloads, HTTP-Logins |

## Datenmodell

Alles, was im Chat steht, ist ein `ChatItem` (`src/shared/chat.ts`):

- `user`, `assistant` (Text, streamt per Delta), `thinking`
- `tool` (Art, Titel, Detail, Eingabe, Ausgabe, Diffs, Status)
- `interaction` (Freigabe, Frage, Plan, Formular; offen oder beantwortet)
- `agent` (Subagent mit eigenem Verlauf über `parentId`)
- `todo`, `render` (Element des MCP-Servers), `notice`, `turn` (Dauer, Tokens, Kosten)

Provider liefern Items über `RunSink.item()` (neu oder ersetzt) und `RunSink.delta()` (Text anhängen). Der
`SessionService` speichert, nummeriert und sendet sie als `SessionEvent` an die Fenster.

## Projekte und Unterordner

Ein Projekt ist ein Ordner. Eine Session arbeitet in ihm oder in einem Ordner darin (`SessionMeta.cwd`,
fehlt für den Projektordner selbst); dort startet ihre CLI, und Dateibaum, Titelleiste und Browser
nehmen diesen Ordner. Die Sidebar zeigt unter dem Projekt jede Ebene bis zum Ordner einer Session als
eigenen, einklappbaren Ordner (`lib/session-tree.ts`), wie der Claude Manager die Projekte eines
Workspaces; ein Ordner, der nur einen Ordner enthält, wird mit ihm zu einer Zeile (`cm/packages/core`).
Neue Chats in einem Unterordner: „+“ am Ordner oder „Neuer Chat in Unterordner …“ am Projekt.

## Trenner

Projekte stehen unter Trennern (`ProjectSection`, `shared/sections.ts`), wie die Workspaces im Claude
Manager. „Projekte“ (`DEFAULT_SECTION_ID`) ist immer da; ein Projekt ohne (gültige) `sectionId` steht
dort. `projects.json` (Version 2) hält Trenner und Projekte in der Reihenfolge, in die der Nutzer sie
gezogen hat; `arrange()` nimmt nach einem Drag & Drop die ganze Reihenfolge (`SectionLayout`).

Ein Trenner kann für einen Ordner stehen (`path`, ein Workspace): Neue Projekte in diesem Ordner kommen
unter ihn, und die Chats des Ordners selbst (sein „Wurzelprojekt“) stehen direkt unter der Überschrift.
„Zum Trenner machen“ (`projectToSection`) macht aus einem Projekt so einen Trenner: Chats in seinen
Unterordnern kommen in Projekte je Unterordner der ersten Ebene, jeder arbeitet weiter im selben Ordner
(`SessionService.relocate`). Bis Version 1 sortierte die Sidebar selbst (Angeheftete zuerst, dann die
neuesten); diese Reihenfolge wird beim ersten Laden übernommen.

## Übernahme aus dem Claude Manager

Der Claude Manager hat keine eigenen Sessions: Er listet die Transkripte von Claude Code in den Ordnern
seiner Accounts und ordnet sie seinen Workspaces zu (`workspaces.json`: Ordner, deren Unterordner
Projekte sind; der innerste gewinnt). `ClaudeManagerImport` liest dessen Daten (`%APPDATA%\Claude
Manager`, sonst `Signalbox`) nur:

- Workspaces werden Trenner, ihre Unterordner der ersten Ebene mit Sessions Projekte darunter. Hat Nexa
  schon ein Projekt für den Workspace-Ordner, wird es zum Trenner gemacht. Sessions außerhalb aller
  Workspaces werden je Ordner ein Projekt unter „Projekte“.
- `oauth`-Accounts werden Nexa-Accounts mit demselben Ordner (Login und Unterhaltungen bleiben, wo sie
  sind); der Standard-Account ist Nexas Standard. Token und API-Keys sind mit `safeStorage` für den
  Claude Manager verschlüsselt und lassen sich nicht übernehmen; ihre Sessions laufen mit dem
  Vorgabe-Account weiter (das Transkript wird beim ersten Prompt kopiert).
- Jede Session wird ein `SessionMeta` mit `cli.claude` (Sitzung, Account, Ordner) und `importedFrom`.
  Den Chat liest `SessionService` erst beim ersten Öffnen aus dem Transkript (`claude-transcript.ts`)
  und speichert ihn dann wie jeden anderen. Namen und Anheften kommen aus `session-names.json` und
  `session-marks.json`; schon übernommene Sessions (gleiche Sitzungs-ID) werden übersprungen.

Die Übernahme steht in der Einrichtung beim ersten Start und unter Einstellungen › Accounts.

## Wechsel der CLI

Jede Session merkt sich je CLI die Sitzungs-ID der CLI und welche Items diese schon kennt
(`CliLink.seenItems`). Schreibt man nach einem Wechsel, bekommt die übernehmende CLI die Items, die sie
nicht kennt, zusammengefasst als `<nexa-context>` vor der Nachricht. Danach läuft sie mit eigener
Sitzung weiter (`--resume` bzw. `thread/resume`).

## Accounts

Ein Account ist ein Konfigurationsordner einer CLI (`src/shared/accounts.ts`):

- `system` / `system-codex`: der eigene Ordner der CLI (`~/.claude` bzw. `CLAUDE_CONFIG_DIR` der
  Umgebung, `~/.codex`). Immer da, nicht entfernbar; Nexa ändert die Umgebung dafür nicht.
- `oauth`: eigener Ordner `profiles/<id>` in den App-Daten, Browser-Login. Neue Codex-Ordner bekommen
  `cli_auth_credentials_store = "file"`, damit jeder Account sein eigenes `auth.json` hat statt eines
  gemeinsamen Eintrags im Schlüsselbund.
- `token` / `apiKey` (nur Claude): Secret verschlüsselt in `accounts.json`, beim Start als
  `CLAUDE_CODE_OAUTH_TOKEN` bzw. `ANTHROPIC_API_KEY`. Entschlüsselt nur im Speicher von Main.

`AccountService` liest alle 15 s die Login-Dateien (Konto, Plan, Ablauf) und meldet Änderungen.
`accountEnv()` baut die Umgebung: `CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME` setzen und die Anmelde-Variablen
der Umgebung entfernen, damit kein fremder Login durchschlägt.

Die Session merkt sich je CLI den gewählten Account (`SessionMeta.accounts`) und je `CliLink`, mit
welchem Account die Sitzung der CLI entstand. Weichen beide ab, kopiert `session-transfer.ts` die
Unterhaltung (Claude: Transkript, Unterordner, `file-history`; Codex: Rollout unter `sessions/`) in den
neuen Ordner und setzt sie dort fort (Codex mit `thread/resume { path }`). Klappt das nicht, verfällt
der Link und die CLI bekommt den ganzen Verlauf als `<nexa-context>`.

## Renderer

- `App.vue`: Titelleiste, Sidebar, Inhalt als Panel (`main`, `bg-surface`, runde Ecke). Darüber die
  Dialoge: Einstellungen (`components/settings/SettingsDialog.vue`, `ui.settingsOpen`), Theme-Editor
  (`ui.themeEditorRequest`), Account-Formular (`accounts.formRequest`), Browser-Login
  (`accounts.loginId`) und Rückfragen (`ui.confirm()`).
- `stores/accounts.ts`: Accounts, laufende Logins, Vorgabe je CLI, Account eines Chats (`sessionAccount`).
- Themes: eingebaute in `shared/themes/builtin.ts`, eigene als JSON-Dateien im Ordner `themes` der
  App-Daten (Format des Claude Managers, `ThemeService` überwacht den Ordner). `themes/apply.ts` setzt
  die Tokens, `themes/color-info.ts` beschreibt jede Farbe für den Editor.
- `stores/sessions.ts`: Metadaten aller Sessions, geöffnete Chats (`chats`), Laufzustand. Events, die
  ankommen, während eine Session lädt, stecken schon im Snapshot und werden ignoriert.
- `lib/tools.ts`: `chatBlocks()` gruppiert Items zu Blöcken (Werkzeuggruppen, Agents, Rückfragen).
- `components/chat/ChatView.vue` stellt den Projektordner bereit (`useProjectPath`), damit Pfade relativ
  erscheinen.
- **Dateien und Aktivität** (`components/files/*`, aus dem Claude Manager): `FileTreePanel` links im Chat,
  `DiffView`/`ChangesView` über dem Verlauf. `stores/file-tree.ts` hält je Ordner einen Baum (geteilt von
  allen Chats des Projekts) und je Session die Aktivität: live über `files.onTouched`, beim ersten
  Anzeigen ergänzt um `files.history(sessionId)`. Main leitet beides aus den `tool`-Items ab
  (`SessionService` meldet `tool` und `turnEnded`, `FileActivityTracker` wertet sie aus,
  `shared/file-touches.ts` liest Pfade aus Items). Shell-Befehle schreiben, was sich in ihrem Ordner
  ändert, solange sie laufen.
- **Browser** (`components/browser/*`, aus dem Claude Manager): `BrowserPanel` rechts im Chat (Tabs, Breite,
  Platz für die Seite), `BrowserToggle` im Chat-Kopf. Die Seiten selbst (`BrowserPane` mit `<webview>`)
  liegen in `BrowserLayer` in `App.vue` über dem Inhalt: ein `<webview>` lädt neu, wenn es den Parent
  wechselt, deshalb bleiben alle in der Reihenfolge ihrer Tabs dort und das Panel meldet nur, wo die
  gezeigte Seite hin soll (`browsers.slot`). Seiten, die ein Agent gerade bedient, werden unsichtbar in
  ihrer letzten Größe weiter gezeichnet (sonst keine Screenshots und Klicks). Tabs aus dem letzten Lauf
  laden erst, wenn sie gezeigt oder bedient werden (`browsers.awake`). `stores/browsers.ts` hält Tabs
  (von Main), Panel offen je Chat und Breite (localStorage), Steuerung, Protokoll und Markierungen der
  Agents, Downloads und Logins.
  Im Chat zeigt `BrowserCard` (ein Block aus `chatBlocks()` für Browser-Werkzeuge in Folge) ein Live-Bild
  der Seite aus `browser-frames.ts`; nur die neueste Karte ist live, ältere behalten ihr letztes Bild
  (`browsers.stills`). Zum Bedienen öffnet sie den Tab im Panel oder im Vollbild (`browsers.fullscreen`,
  das Panel liegt dann über dem ganzen Chat); solange pausiert ihr Bild. Ohne Tab bleibt das Panel zu.
- **Shells** (`ShellPanel`, `lib/shells.ts`): laufende Befehle aus den `tool`-Items (`ToolItem.shell`
  hält Task-ID und Zustand des Prozesses). Die Ausgabe holt `sessions.shellOutput` von der CLI (Claude:
  `get_task_output`), `sessions.stopShell` beendet sie (`stop_task`). Solange eine im Hintergrund läuft,
  steht `ShellDock` (`dockShells()`) über dem Eingabefeld, neben dem `AgentDock`. `ShellPanel` zeigt nur,
  was läuft: Endet die gezeigte Shell, wechselt es zu einer anderen laufenden oder schließt sich. Fertige
  öffnen sich nur aus dem Chat (die „Hintergrund“-Marke am Befehl).
- **Subagents** (`AgentDock`, `AgentThread`): Ein Klick im Dock oder auf die Agent-Karte zeigt den Verlauf
  des Agents an Stelle des Hauptchats (`ui.agentId`), wie die Agent-Liste der Claude-CLI; zurück geht es über
  „Hauptchat“ im Dock, die Pfadleiste im Kopf oder Esc. Ist der gezeigte Agent fertig, kehrt der Chat zu
  dem Verlauf zurück, aus dem er kam.
- `stores/composer.ts`: Entwürfe je Chat und Text, den andere Teile in die Eingabe setzen (`@`-Erwähnung
  aus dem Baum, Review-Kommentare aus `stores/review.ts`).
- **Updates** (`components/settings/SettingsUpdates.vue`, `components/updates/*`, `stores/updates.ts`): Zustand
  des Updaters, Herunterladen und Neustart (mit Rückfrage, wenn noch Antworten laufen), Versionshinweise der
  Releases mit den PR-Beschreibungen als „Details“. Ein Punkt am Einstellungen-Knopf der Sidebar zeigt ein
  wartendes Update oder ungelesene Neuerungen nach einem Update.

## Releases

semantic-release (`release.config.mjs`, `.github/workflows/release.yml`) bestimmt bei jedem Push auf `main`
die Version aus den Conventional Commits; Windows- und Linux-Runner bauen mit `electron-builder.yml`
Installer, AppImage, deb und rpm, dann erscheint alles als GitHub-Release. `shared/release-notes.ts` macht
aus den Zeilen unter `## Versionshinweise` einer PR-Beschreibung je einen Punkt der Versionshinweise (in
Node für `release.config.mjs`, daher nur Typen, die sich wegstreichen lassen). `build/installer.nsh`
registriert `nx` beim Installieren.
