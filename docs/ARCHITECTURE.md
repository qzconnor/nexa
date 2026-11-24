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
| `services/usage-samples.ts` | Messpunkte der Limit-Fenster je Account (`usage-samples.json`) und daraus die Prognose je Fenster (Rechnung in `shared/usage-forecast.ts`) |
| `accounts/account-service.ts` | Accounts (`accounts.json`), Profilordner, Login-Stand aus den Dateien der CLIs |
| `accounts/account-env.ts` | Umgebung, mit der die CLI eines Accounts startet |
| `accounts/account-login.ts` | `claude auth login` / `codex login` ohne Terminal: Link, Code, Ergebnis |
| `accounts/cli-files.ts` | Wo die CLIs Login und Verläufe ablegen, Auslesen von Konto, Plan und Ablauf |
| `accounts/claude-usage.ts` | Claude-Limits über die OAuth-Usage-Schnittstelle |
| `artifacts/artifact-service.ts` | Claudes Artefakte auf claude.ai je Account (Liste, Vorschaubilder als `data:`-URL); Kanäle `artifacts:*` in `artifact-ipc.ts`, Typen und Link-Erkennung in `shared/artifacts.ts` |
| `voice/voice-service.ts` | Spracheingabe: wählt einen Claude-Account mit gültigem Login, streamt die Aufnahme an Claudes Spracherkennung (WebSocket, wie `/voice` in Claude Code) und meldet die Wörter dem Fenster; Kanäle `voice:*` in `voice-ipc.ts`, Typen und Sprachen in `shared/voice.ts` |
| `accounts/session-transfer.ts` | Kopiert die Unterhaltung einer CLI beim Account-Wechsel in den neuen Ordner |
| `accounts/conversation-files.ts` | Die Dateien einer Unterhaltung je Config-Ordner (Claude: Transkript, Subagents, Checkpoints; Codex: Rollouts) und ihre Größe, zum Löschen und Aufräumen |
| `accounts/session-move.ts` | Verschiebt eine Session von Claude Code in den Projektordner eines anderen Arbeitsordners (wie `/cd`, aus dem Claude Manager) |
| `services/project-service.ts` | Projekte (Ordner) und Trenner, ihre Reihenfolge, ausgeschaltete MCP-Server je Projekt; `project-sections.ts` macht ein Projekt zum Trenner |
| `services/folder-prompts.ts` | Prompt eines Projekts oder Trenners (`prompts.md` im Ordner) lesen, schreiben und für den Systemprompt zusammensetzen |
| `providers/mcp-servers.ts` | Antworten der CLIs auf die Frage nach ihren MCP-Servern → `McpServerState` (ohne Nexas eigenen) |
| `providers/titles.ts` | Titel eines Chats vom Modell (`AgentRun.title`): Anweisung für Codex, Prompt gekürzt, Antwort bereinigt (`cleanTitle`) |
| `providers/plugins.ts` | Plugins der CLIs (`claude plugin list --json`, Codex `plugin/installed`) → `PluginInfo`, Antworten auf das Schalten und auf die Anmeldung an MCP-Servern (`McpAuthStart`) |
| `providers/claude/claude-context.ts` | `get_context_usage` von Claude Code → `ContextDetail` (Teile mit deutschen Namen, MCP-Server, Agents, Anweisungsdateien) |
| `import/claude-manager.ts` | Übernahme aus dem Claude Manager: Workspaces → Trenner mit Projekten, Accounts mit denselben Ordnern, Sessions aus deren Transkripten, dazu Prompts, Themes, Namen und Pins (`cm-extras.ts`); Kanäle `import:*` in `import-ipc.ts` |
| `import/cli-import.ts` | Übernahme der Sessions der CLIs selbst: Transkripte von Claude Code und Threads von Codex (`thread/list`) aus allen Accounts, je Ordner ein Projekt; Kanäle `import:cli-*` |
| `import/import-plan.ts` | Was beide Übernahmen teilen: Sessions nach Ordnern auf Projekte verteilen (`planGroups`), Titel, `SessionMeta` einer übernommenen Session |
| `import/claude-sessions.ts` | Transkripte eines Claude-Ordners auflisten, ein Transkript samt Subagents als Chat lesen, oder nur was seit einem Zeitpunkt dazukam |
| `providers/claude/claude-presence.ts` | Ob eine Claude-Code-Sitzung gerade in einem anderen Prozess offen ist (`<config>/sessions/<pid>.json`) und wo |
| `providers/claude/claude-transcript.ts` | Claude-Code-Transkript (`projects/<key>/<id>.jsonl`) → `ChatItem`s wie aus dem Stream, plus Kurzfassung (Ordner, Titel, Zeiten) |
| `services/session-service.ts` | Sessions: Metadaten, Items, Runs starten/stoppen, Wechsel der CLI, Statistik |
| `services/session-search.ts` | Suche in den Prompts und Antworten der Chats (für die Schnellsuche), Ausschnitt um den Treffer |
| `services/transcript-store.ts` | Verlauf je Session als JSONL |
| `services/instructions.ts` | Systemprompt-Zusatz, Übergabe-Kontext beim CLI-Wechsel, `<nexa-shell>` mit den `!`-Befehlen des Nutzers |
| `services/user-shells.ts` | Befehle aus dem Shell-Modus (`!`): welche Shell (`shellLaunch`: PowerShell 7/5.1 mit dem Befehl über stdin, weil `-EncodedCommand` Fehler als CLIXML schreibt; Git Bash, cmd; sonst `$SHELL`), Prozess je Befehl im Ordner des Chats, Ausgabe, Beenden samt Kindprozessen; Zeilen, die nicht UTF-8 sind (Windows-Konsolenprogramme ohne Konsole), liest es in der OEM-Codepage des Systems (`codePageDecoder` in `lib/text-encoding.ts`) |
| `providers/provider.ts` | Schnittstellen `AgentProvider`, `AgentRun`, `RunSink` |
| `providers/claude/*` | Claude Code: Prozess je Session, Stream-JSON, Werkzeug-Abbildung |
| `providers/codex/*` | Codex: ein App-Server je Account für alle seine Sessions, JSON-RPC, Item-Abbildung |
| `lib/secrets.ts` | Ver- und Entschlüsseln von Token und Keys (`safeStorage`) |
| `lib/shell-env.ts` | Linux: übernimmt beim Start die Umgebung der Login-Shell (PATH mit nvm & Co.), damit die CLIs auch beim Start aus dem Anwendungsmenü gefunden werden |
| `lib/linux.ts` | Wie die Linux-Version installiert ist (AppImage, deb, rpm); `cliEnv` nimmt mit `withoutAppImageEnv` die Pfade des AppImage-Mounts aus der Umgebung der CLIs |
| `services/notification-service.ts` | Windows-Meldungen zu Chats, die fertig sind, etwas fragen oder am Limit stehen (`SessionService`-Ereignis `attention`), blinkende Taskleiste; Warnung bei fast verbrauchten Limits (`lib/near-limit.ts`) und abgelaufenem Login, gemerkt in `notifications.json`; Texte in `lib/notification-text.ts` |
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
| `window/tray.ts` | Symbol im Infobereich (Einstellung `general.runInTray`): Schließen blendet das Fenster dann nur aus, das Menü öffnet und beendet |
| `lib/login-item.ts` | Start mit der Anmeldung (`general.launchAtLogin`, Schalter `--autostart`): Windows über den Run-Schlüssel (der Uninstaller in `build/installer.nsh` entfernt ihn), Linux über `~/.config/autostart/nexa.desktop`; mit Infobereich startet das Fenster versteckt |
| `window/browser-*.ts` | Härtung der `<webview>`s (eigene Partition, keine Node-Integration, Berechtigungen, Popups, Navigation, Tastenkürzel), Downloads, HTTP-Logins |

## Datenmodell

Alles, was im Chat steht, ist ein `ChatItem` (`src/shared/chat.ts`):

- `user`, `assistant` (Text, streamt per Delta), `thinking`
- `tool` (Art, Titel, Detail, Eingabe, Ausgabe, Diffs, Status). Aufrufe von Nexas eigenem MCP-Server
  (`mcp__nexa__*`, `nexa.*`) und Claudes `ToolSearch`, das sie lädt, zeigt `ToolRow` als Teil der App:
  mit dem Nexa-Logo und in Worten (`nexaToolView` in `lib/tools.ts`), ohne Server-Badge. Das Laden
  allein lässt sich nicht aufklappen und zählt in der Zusammenfassung einer Gruppe nicht mit.
- `interaction` (Freigabe, Frage, Plan, Formular; offen oder beantwortet)
- `agent` (Subagent mit eigenem Verlauf über `parentId`)
- `todo`, `render` (Element des MCP-Servers), `turn` (Dauer, Tokens, Kosten; die Kosten, die die CLIs
  melden, sind ein API-Preis und werden nicht angezeigt)
- `notice` (Hinweis, Warnung, Fehler). Mit `compaction` ist es ein Zusammenfassen des Kontexts und
  erscheint als Trenner quer über den Chat (`compactionNotice` in `shared/chat.ts`). Solange die CLI
  zusammenfasst, steht `compactingSince` in der Laufzeit der Session, und unter dem Chat steht
  „Kontext wird zusammengefasst …“.

Provider liefern Items über `RunSink.item()` (neu oder ersetzt) und `RunSink.delta()` (Text anhängen). Der
`SessionService` speichert, nummeriert und sendet sie als `SessionEvent` an die Fenster.

## Projekte und Unterordner

Ein Projekt ist ein Ordner. Eine Session arbeitet in ihm oder in einem Ordner darin (`SessionMeta.cwd`,
fehlt für den Projektordner selbst); dort startet ihre CLI, und Dateibaum, Titelleiste und Browser
nehmen diesen Ordner. Die Sidebar zeigt unter dem Projekt jede Ebene bis zum Ordner einer Session als
eigenen, einklappbaren Ordner (`lib/session-tree.ts`), wie der Claude Manager die Projekte eines
Workspaces; ein Ordner, der nur einen Ordner enthält, wird mit ihm zu einer Zeile (`cm/packages/core`).
Neue Chats in einem Unterordner: „+“ am Ordner oder „Neuer Chat in Unterordner …“ am Projekt.

Ein Chat zieht in ein anderes Projekt oder einen Ordner darin über „Verschieben nach“
(`SessionMoveMenu`: die Projekte unter ihren Trennern oder „Anderer Ordner …“) oder per Drag & Drop
auf ein Projekt, einen Ordner oder die Überschrift eines Trenners mit eigenem Ordner (`useSessionDrag`).
`SessionService.move` stellt die Session dann wie `/cd` in Claude Code um: Ihre CLI startet beim
nächsten Prompt im neuen Ordner und setzt die Unterhaltung fort. Claude Code findet eine Session nur
im Projektordner ihres Arbeitsordners, deshalb verschiebt `accounts/session-move.ts` das Transkript mit
dem Ordner daneben und hängt einen `relocated`-Eintrag an. Codex bekommt den Ordner bei jedem
`thread/resume`. Während die CLI arbeitet (Turn, Rückfrage, Shell oder Agent im Hintergrund), bleibt der
Chat, wo er ist. Ein Ordner außerhalb aller Projekte bekommt ein eigenes Projekt.

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

Projekte und Trenner mit Ordner haben einen Prompt („Prompt …“ im Kontextmenü, `FolderPromptDialog`),
gespeichert als `prompts.md` im Ordner. Beim Start einer CLI setzt `SessionService` die Prompts der
Ordner, in denen der Chat liegt, an den Systemprompt (`promptFolders`: die Trenner um das Projekt, der
äußerste zuerst, dann das Projekt). Nur Ordner, die Nexa kennt, zählen: eine `prompts.md` aus einem
geklonten Repository in einem Unterordner bleibt draußen.

## Übernahme aus dem Claude Manager

Der Claude Manager hat keine eigenen Sessions: Er listet die Transkripte von Claude Code in den Ordnern
seiner Accounts und ordnet sie seinen Workspaces zu (`workspaces.json`: Ordner, deren Unterordner
Projekte sind; der innerste gewinnt). `ClaudeManagerImport` liest dessen Daten (`%APPDATA%\Claude
Manager`, sonst `Signalbox`) nur:

- Workspaces werden Trenner, ihre Unterordner der ersten Ebene mit Sessions Projekte darunter. Hat Nexa
  schon ein Projekt für den Workspace-Ordner, wird es zum Trenner gemacht. Sessions außerhalb aller
  Workspaces werden je Ordner ein Projekt unter „Projekte“.
- `oauth`-Accounts werden Nexa-Accounts mit demselben Ordner (Login und Unterhaltungen bleiben, wo sie
  sind); der Standard-Account ist Nexas Standard. Hat Nexa denselben Login schon in einem anderen Ordner
  (oder bringt ihn ein Account davor in der Liste mit), kommt kein zweiter dazu (`planAccounts`): Die
  Sessions laufen mit dem vorhandenen weiter, ihr Transkript wird beim ersten Prompt kopiert. Token und API-Keys sind mit `safeStorage` für den
  Claude Manager verschlüsselt und lassen sich nicht übernehmen; ihre Sessions laufen mit dem
  Vorgabe-Account weiter (das Transkript wird beim ersten Prompt kopiert).
- Jede Session wird ein `SessionMeta` mit `cli.claude` (Sitzung, Account, Ordner) und `importedFrom`.
  Den Chat liest `SessionService` erst beim ersten Öffnen aus dem Transkript (`claude-transcript.ts`)
  und speichert ihn dann wie jeden anderen. Namen und Anheften kommen aus `session-names.json` und
  `session-marks.json`; schon übernommene Sessions (gleiche Sitzungs-ID) werden übersprungen.
- „Weiteres“ (`cm-extras.ts`, einzeln abwählbar): Workspace-Prompts (`cm_prompts.md` im Ordner wird
  `prompts.md`, nie über einen Prompt, den Nexa dort schon hat), eigene Themes (`themes/*.json`, über
  `ThemeService.importFrom`, gleicher Name gilt als vorhanden) sowie Namen und Pins für Chats, die Nexa
  schon hat (ein in Nexa vergebener Name bleibt).

Die Übernahme steht in der Einrichtung beim ersten Start und unter Einstellungen › Accounts. Erneut
gelesen bietet sie nur an, was Nexa noch fehlt: neue Sessions und Workspaces ebenso wie Weiteres, das im
Claude Manager dazukam oder beim ersten Mal abgewählt war.

Was Nexa vom Claude Manager zeigt, hängt an `useClaudeManager`: der Import (Einrichtung, Einstellungen ›
Accounts, Suche, Hinweis bei den Themes) nur, solange seine Daten da sind (`detect`); Hinweise auf ihn
(Terminal-Farben im Theme-Editor, „wie die Workspaces“ beim Trenner) nur, solange er installiert ist
(`installed`: Windows sein Eintrag unter `…\CurrentVersion\Uninstall`, den sein Deinstallationsprogramm
entfernt; Linux `claude-manager.desktop`). Die Einstellungen fragen bei jedem Öffnen neu.

Die Profilordner der übernommenen Accounts bleiben in `%APPDATA%\Claude Manager\profiles`: Logins und
Transkripte liegen dort. Den Claude Manager zu deinstallieren lässt sie stehen (der Installer löscht keine
App-Daten), den Ordner von Hand zu löschen nimmt Nexa diese Accounts und die Verläufe ihrer Chats.

## Übernahme der Sessions der CLIs

Ohne Claude Manager holt `CliSessionImport` (`CliSessionsImport.vue`, in der Einrichtung, unter
Einstellungen › Accounts und in der Befehlsliste) die Sessions, die die CLIs selbst gespeichert haben:

- Claude Code: die Transkripte unter `projects/` im Ordner jedes Claude-Accounts (`listTranscripts`,
  Kurzfassung aus `claude-transcript.ts`).
- Codex: `thread/list` über den App-Server jedes Codex-Accounts (`AgentProvider.sessions`). Ein Account,
  dessen Server nicht antwortet, steht in der Vorschau als „Nicht gelesen“.

Nur eingeschaltete, installierte CLIs zählen, Accounts mit demselben Ordner nur einmal. Sessions, die
Nexa schon kennt (`knownCliSessions`), bleiben draußen; liegt dieselbe Session in mehreren Ordnern
(nach einem Account-Wechsel), gilt die zuletzt geänderte Kopie. `planGroups` (`import-plan.ts`, auch für
den Claude Manager) ordnet jede Session dem innersten Projekt über ihrem Ordner zu; ohne eines wird ihr
Ordner ein neues Projekt unter „Projekte“. In der Vorschau wählt man die Gruppen aus.

Wie beim Claude Manager liest `SessionService` den Chat erst beim ersten Öffnen: Claude aus dem
Transkript in `importedFrom`, Codex mit `thread/read` über den App-Server des Accounts in `cli.codex`
(`AgentProvider.history`, `codexThreadItems`). Die Suche liest so auch noch nie geöffnete Chats. Gibt
die CLI keinen Verlauf heraus, steht eine Warnung im Chat; er geht trotzdem in derselben Session weiter.

## Abgleich mit Claude Code

Ein Chat mit `cli.claude` kann außerhalb von Nexa weitergehen (`claude --resume` im Terminal, Claude
Desktop); das Transkript wächst dann ohne Nexa. `SessionService.syncCli` liest, was nach `CliLink.synced`
dazukam (`transcriptSince`, `readClaudeChatSince`), nur fertige Turns, und hängt es mit einer Notiz
„Außerhalb von Nexa weitergeführt“ an den Chat; folgen mehrere Turns von dort ohne etwas aus Nexa
dazwischen, zählt dieselbe Notiz weiter. Läuft Nexas eigene CLI des Chats untätig, endet sie: Sie kennt
die neuen Turns nicht, der nächste Prompt setzt mit `--resume` auf dem ganzen Transkript fort. Während ein
Turn in Nexa läuft, wird nichts übernommen.

Anlässe: `open()` (der Chat wird geladen), im Renderer der Wechsel in einen schon geladenen Chat, der Fokus
des Fensters (`ChatView`, höchstens alle 2 s) und „Mit Claude Code abgleichen“ im Menü des Chats
(`sessions:sync`, mit „Nichts Neues“ als Toast). Bei jedem Abgleich prüft `claude-presence.ts`, ob ein
anderer Prozess die Sitzung offen hat (`SessionRuntime.openElsewhere`); solange, steht ein Hinweis über der
Eingabe und der Chat gleicht alle 5 s ab. Codex fehlt noch (Roadmap).

## Wechsel der CLI

Jede Session merkt sich je CLI die Sitzungs-ID der CLI und welche Items diese schon kennt
(`CliLink.seenItems`). Schreibt man nach einem Wechsel, bekommt die übernehmende CLI die Items, die sie
nicht kennt, zusammengefasst als `<nexa-context>` vor der Nachricht. Danach läuft sie mit eigener
Sitzung weiter (`--resume` bzw. `thread/resume`).

`/clear` leert den Kontext im selben Chat (`SessionService.clear`), damit Name, Pin und Platz in der
Sidebar bleiben: Die CLI endet, die Links aller CLIs wandern nach `SessionMeta.earlierCli`, eine Notiz
`cleared` steht als Trenner im Verlauf, und `SessionMeta.contextFrom` zeigt auf das Item danach. Der
nächste Prompt startet bei jeder CLI eine neue Unterhaltung; was vor `contextFrom` steht, bleibt
gespeichert und durchsuchbar, geht aber auch beim Wechsel der CLI nicht mehr als `<nexa-context>` mit.
`MessageList` klappt alles über dem letzten solchen Trenner ein, bis man es öffnet (die Suche im Chat
öffnet es mit „Alle laden“). Hat der Chat einen Titel vom Modell (`titleSource: 'auto'`), benennt ihn
der erste Prompt nach `contextFrom` neu; einen eigenen Namen (`'user'`) lässt das stehen. `/new` legt
stattdessen einen neuen Chat mit denselben Einstellungen an.

Einen Prompt bearbeiten (Stift links neben dem Prompt, `UserMessage`) geht im selben Chat ab dem Prompt
neu weiter (`SessionService.edit`): Der Chat wird vor ihm gekürzt (Ereignis `truncated` an den
Renderer), jede CLI zweigt ihre Unterhaltung wie beim Abzweigen an ihrer letzten Antwort davor ab
(`CliLink.fork`, `editPoint`: bei Codex der letzte Turn davor, bei Claude Code `forkPoint` bis zur
Nachricht der letzten Antwort davor, deren `msg_…` in der ID des Items steht), und der neue Text geht
mit `send` hinaus. Die alte Unterhaltung kommt nach `earlierCli` und geht so mit dem Chat in den
Papierkorb. Hat eine CLI vor dem Prompt nicht geantwortet, beginnt sie neu, mit dem Chat davor als
`<nexa-context>`. Bearbeiten lassen sich Prompts des Hauptstrangs unter dem letzten `/clear`, solange
der Chat ruht; was die Agents an Dateien geändert haben, bleibt.

### Shell-Modus (`!`)

`!` am Anfang des Eingabefelds schaltet in den Shell-Modus wie in Claude Code (pinker Rahmen,
`--tool-shell`; Esc oder Rücktaste am Anfang schaltet zurück). Die Zeile führt nicht die CLI aus,
sondern Nexa (`SessionService.runShell` → `UserShells`), im Ordner des Chats und in der Shell aus
`settings.chat.shell`; auf der Startseite (`HomeView`) legt der Befehl wie ein erster Prompt einen neuen
Chat im gewählten Projekt an und läuft darin. Daraus wird ein `ToolItem` mit `byUser`, das `UserShellBlock` zeigt (Befehl nach
einem pinken `!`, Ausgabe darunter, Beenden über `sessions.stopShell`). Befehl und Ausgabe laufen durch
`redactSecrets` (`shared/redact.ts`: Token-Formate, `password=…`, `--token …`, Zugangsdaten in URLs,
`Authorization`-Header, private Schlüssel, lange zufällige Zeichenfolgen) und stehen nur so im Chat und
auf der Platte (die Agents können Nexas Dateien lesen); die Oberfläche sagt dazu nichts. Während der Befehl
läuft, geht die Ausgabe nur an das Fenster; gespeichert wird sie (ihr Ende, 100 000 Zeichen), wenn er
endet. Der nächste Prompt bekommt alle `!`-Befehle seit dem letzten Prompt als `<nexa-shell>`
(`userShellContext`) vorangestellt; beim Wechsel der CLI stehen ältere als eine Zeile im `<nexa-context>`.

### Spracheingabe

Das Mikrofon neben dem Senden-Knopf (oder Strg+M im Eingabefeld) diktiert in die Eingabe, für jede CLI:
erkannt wird immer mit Claudes Spracherkennung, der Text landet wie getippt im Feld (Protokoll in
`PROTOCOLS.md`, „Spracheingabe“). Ohne angemeldeten Claude-Account oder mit ausgeschaltetem Claude Code
gibt es kein Mikrofon (`voiceAvailable` in `shared/voice.ts`); Codex' eigenes `/voice` ist ein
Sprachgespräch und taugt nicht zum Diktat (`PROTOCOLS.md`, Codex, „Sprache“).

`useVoiceInput` öffnet das Mikrofon (`getUserMedia`; das Hauptfenster darf nur Audio, `main-window.ts`),
das unter `settings.chat.voiceMicrophone` steht, gemerkt mit seinem Namen statt der pro Profil gesalzenen
Geräte-ID (`lib/microphones.ts`); ist es nicht angeschlossen, das des Systems. Aufgenommen wird in einem
`AudioContext` mit 16 kHz; das Worklet `lib/voice-worklet.ts`
macht daraus 16-Bit-PCM in Stücken von 64 ms samt Lautstärke für den Pegel (`VoiceMeter`). Die Stücke
gehen über `voice:audio` an `VoiceService`, der sie bis zur stehenden Verbindung puffert. Die Wörter
kommen als `voice:event` zurück; `Composer` schreibt sie an die Stelle des Cursors beim Start
(`lib/voice-text.ts`), solange die Aufnahme läuft ist das Feld schreibgeschützt. Ein erneuter Klick, Esc
oder Strg+M beendet die Aufnahme und wartet auf die letzten Wörter; Enter beendet sie und sendet danach.
Mit `settings.chat.voiceAutoStop` endet sie auch von selbst: Jedes Stück prüft `pauseOver`
(`lib/voice-text.ts`), gezählt ab den letzten neuen Wörtern (2 s, vor dem ersten 8 s), solange der Pegel
keine Sprache zeigt. Mit `settings.chat.voiceAutoSend` geht die Nachricht ab, wenn eine Aufnahme mit
Wörtern endet (Klick, Strg+M, Pause), nicht nach Esc oder einem Fehler. Der Account: `settings.chat.voiceAccount`, sonst der des Chats, wenn er ein Claude-Account ist, sonst der
erste mit gültigem Login (`voiceCandidates`); die Sprache `settings.chat.voiceLanguage`, sonst die des
Systems (`app.getLocale()`).

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

Ein Chat nimmt beim Löschen (`SessionService.remove`, mehrere auf einmal) seine Unterhaltungen mit,
solange `chat.deleteCliConversations` an ist: Die CLI endet zuerst, dann gehen ihre Dateien
(`conversation-files.ts`) aus dem Ordner, in dem sie entstanden, und aus den Ordnern aller Accounts
derselben CLI in den Papierkorb (`shell.trashItem`), auch die von vor einem `/clear` (`earlierCli`;
ein Abzweig übernimmt sie nicht). Es bleiben die Unterhaltung eines Abzweigs, der
noch nicht lief (`CliLink.fork`: sie gehört dem anderen Chat), eine, mit der ein anderer Chat
weitermacht, und eine Sitzung, die Claude Code außerhalb von Nexa offen hat. Der Renderer blendet die
Chats sofort aus und löscht erst, wenn der Toast mit „Rückgängig“ nach 8 s geht (`useChatRemoval.ts`);
`ChatCleanupDialog.vue` filtert nach Projekt, Alter, Größe (`SessionService.storage`) und Archiv.

Derselbe Login in zwei Ordnern (gleiche E-Mail und Organisation, `sameLogin`) ist ein Account zu viel:
Der jüngere zeigt in den Einstellungen „Gleicher Login wie …“ (`duplicateOf`) und lässt sich in den
älteren zusammenführen (`account-merge.ts`). Seine Chats laufen mit dem anderen weiter
(`SessionService.reassignAccount`, die Unterhaltung kopiert der nächste Prompt), die Vorgabe geht mit,
der Ordner bleibt auf der Platte.

## Renderer

- `App.vue`: Titelleiste, Sidebar, Inhalt als Panel (`main`, `bg-surface`, runde Ecke). Darüber die
  Dialoge: Einstellungen (`components/settings/SettingsDialog.vue`, `ui.settingsOpen`), Theme-Editor
  (`ui.themeEditorRequest`), Account-Formular (`accounts.formRequest`), Browser-Login
  (`accounts.loginId`) und Rückfragen (`ui.confirm()`).
- **Skalierung** (`appearance.zoom`, Stufen in `shared/zoom.ts`): Main setzt sie als Zoom des Fensters
  (`webPreferences.zoomFactor` beim Start, danach `setWindowZoom` in `window/main-window.ts`). Mit ihr
  wachsen die Höhe des Window Controls Overlay (sonst säßen die Fensterknöpfe neben einer höheren
  Titelleiste) und die Mindestgröße des Fensters. Die Breite der Knöpfe liest das CSS aus
  `env(titlebar-area-*)`, das schon in Seitenpixeln rechnet. Seiten im Browser übernehmen den Zoom des
  Fensters (Electron), ihr Strg+0 geht dorthin zurück. Strg+Plus/Minus/0 sind `matchAppShortcut`
  (`useShortcuts`, mit Hinweis), in einer Seite `matchBrowserShortcut`; beide über `zoomKey`.
- **Schnellsuche** (`components/palette/*`, aus dem Claude Manager): das Suchfeld in der Mitte der
  Titelleiste (`TitleBarSearch`) öffnet `CommandPalette` (`ui.openPalette()`, Strg+Umschalt+A; mit `>`
  Strg+Umschalt+P). Was getippt ist, bestimmt den Modus: ohne Präfix Chats und Projekte (`ChatSearchList`),
  `>` Befehle (`PaletteCommands`: Aktionen, der offene Chat, jede Einstellung, neuer Chat je Projekt), `?`
  die Präfixe. Chats findet sie über Titel, Vorschau, Projekt und Ordner sofort, über ihre Prompts und
  Antworten kurz nach dem Tippen: `sessions.search` (`SessionService.search`, `services/session-search.ts`)
  liest den Verlauf jedes Chats einmal (importierte, noch nie geöffnete aus dem Verlauf ihrer CLI)
  und hält ihn, bis sich der Chat ändert. Treffer färbt `useMatchHighlight` über die CSS Custom Highlight
  API. Eine Einstellung öffnet den Dialog an ihrer Karte oder Zeile (`ui.settingsAnchor`). Die Textsuche
  (Groß-/Kleinschreibung und Akzente egal) liegt in `shared/search.ts`, für Main und Renderer.
- `stores/accounts.ts`: Accounts, laufende Logins, Vorgabe je CLI, Account eines Chats (`sessionAccount`).
- **Artefakte** (`views/ArtifactsView.vue`, `ui.view = 'artifacts'`, Eintrag unter „Neuer Chat“): Claudes
  Artefakte des gewählten Accounts als Karten mit Vorschaubild, Suche und Filtern (`lib/artifacts.ts`).
  `stores/artifacts.ts` hält Listen und Bilder, solange die App läuft, und fragt
  `SessionService.artifactChats` nach dem Chat jedes Artefakts (liest jeden gespeicherten Chat einmal, bis
  er sich ändert). Ein Klick öffnet den Chat und das Artefakt in dessen Browser-Panel (ein Tab, der es
  schon zeigt, wird wiederverwendet), ohne Chat im Standardbrowser.
- Themes: eingebaute in `shared/themes/builtin.ts`, eigene als JSON-Dateien im Ordner `themes` der
  App-Daten (Format des Claude Managers, `ThemeService` überwacht den Ordner). `themes/apply.ts` setzt
  die Tokens, `themes/color-info.ts` beschreibt jede Farbe für den Editor.
- `stores/sessions.ts`: Metadaten aller Sessions, geöffnete Chats (`chats`), Laufzustand. Events, die
  ankommen, während eine Session lädt, stecken schon im Snapshot und werden ignoriert.
- `lib/tools.ts`: `chatBlocks()` gruppiert Items zu Blöcken (Werkzeuggruppen, Agents, Rückfragen).
- `components/chat/ChatView.vue` stellt den Projektordner bereit (`useProjectPath`), damit Pfade relativ
  erscheinen.
- **Dateien und Aktivität** (`components/files/*`, aus dem Claude Manager): `FileTreePanel` links im Chat,
  `DiffView`/`ChangesView` über dem ganzen Verlauf samt Eingabefeld (das nur unsichtbar wird, sein Entwurf
  bleibt). Zurück zum Chat geht es mit „Schließen“ (`ViewCloseButton`) oder Esc; Text, der ins Eingabefeld
  kommt (Erwähnung aus dem Baum, Review-Kommentare), schließt die Ansicht ebenfalls. Die Auswahl im Baum
  folgt der gezeigten Datei und geht mit ihr. `stores/file-tree.ts` hält je Ordner einen Baum (geteilt von
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
- `stores/composer.ts`: Entwürfe je Chat, Text, den andere Teile in die Eingabe setzen (`@`-Erwähnung
  aus dem Baum, Review-Kommentare aus `stores/review.ts`), und die Dateien eines Projekts für `@`.
- **Eingabefeld** (`Composer`): `ComposerSuggest` vervollständigt an der Schreibmarke
  (`lib/composer-suggest.ts`): `/` am Anfang Befehle, Skills und MCP-Prompts der CLI
  (`providers.commands`; Main fragt Claude Code über `claude-probe.ts`, Codex über `skills/list`), `$` die
  Skills von Codex, `@` Dateien und Ordner des Projekts (`composer.filesOf`, die Liste der Dateisuche).
  Hinter dem Zahnrad (`ComposerSettings`) liegen Modell, Denkaufwand als Schieberegler (`EffortSlider`,
  Namen und Farben in `lib/effort.ts`, „Standard“ von der CLI über `providers.modelDefaults`), Ultracode
  (Claude) und Freigaben; CLI und Account bleiben in der Leiste (`ComposerControls`).
  Das „+“ (`ComposerAddMenu`) hängt Dateien an (Bilder als Anhang, andere als `@`-Erwähnung), gibt dem
  Chat weitere Ordner (`SessionMeta.dirs`, Chips über der Eingabe) und schaltet unter „Konnektoren“ die
  MCP-Server des Projekts (`Project.mcpOff`; Claude Code im laufenden Prozess, sonst ab dem nächsten
  Start). Ein fehlgeschlagener Server lässt sich dort neu verbinden, ein abgemeldeter anmelden
  (`sessions.reconnectMcp`, `sessions.authenticateMcp`: im laufenden Prozess des Chats, sonst über den
  Provider; die Seite öffnet der Browser des Systems), „Konnektoren verwalten“ führt zu claude.ai bzw. zur
  `config.toml` von Codex. „Plugins ›“ (`ComposerPluginsMenu`) zeigt die installierten Plugins der CLI
  für den Ordner und schaltet sie in den Einstellungen der CLI (`SessionService.setPluginEnabled`):
  laufende Claude-Chats desselben Accounts laden die Plugins neu (`AgentRun.reloadPlugins`), Codex-Chats
  ab dem nächsten Prompt. Läuft eine Antwort, geht Text in sie hinein (`UserItem.steer`): Er wartet in
  `SessionRuntime.queued` unter dem Chat, bis die CLI ihn aufnimmt (`RunSink.taken`: Claude Code meldet
  `command_lifecycle`, Codex nimmt ihn mit `turn/steer` sofort), und steht dann an dieser Stelle im
  Verlauf. Endet die CLI vorher, kommt er so in den Verlauf, wie er geschrieben wurde.
- **Kontext** (`ContextCard`): Beim Hover über den Ring holt `sessions.context` die Aufschlüsselung der
  laufenden CLI (`AgentRun.contextDetail`, nur Claude Code); den Ring selbst speist `runtime.context`.
- **Am Ende bleiben** (`useStickToBottom`): Der Chat folgt dem Neuen, bis der Nutzer nach oben scrollt
  (Mausrad nach oben, oder die Ansicht steht beim Scroll-Ereignis höher als zuvor, ohne dass der Inhalt
  schrumpfte). Wo die Ansicht beim Ereignis steht, entscheidet nicht: Bis es kommt, kann schon mehr
  dazugekommen sein.
- **Lange Chats** (`MessageList`): Gezeigt werden die neuesten 40 Blöcke, beim Hochscrollen je 40 ältere
  (ein `IntersectionObserver` am oberen Ende, 1200 px voraus), ohne dass der sichtbare Inhalt springt. Das
  Fenster hängt am ältesten gezeigten Block, neue kommen dazu. Unter dem Verlauf eines Agents bleibt der
  Hauptchat versteckt stehen, zurück ist er so, wie er war.
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
