# Architektur

## Prozesse

```
Renderer (Vue)  ──IPC──>  Main (Electron)  ──stdio JSON──>  claude -p … / codex app-server
      ^                      │    │
      └── Events ────────────┘    ├── Nexa-MCP-Server (HTTP, 127.0.0.1) <── Agenten rufen render_*, browser_*, chat_*, limits, ask_user, notify auf
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
| `launch.ts` | Liest `--nx=<base64>` und die `nx`-Argumente, entscheidet, welcher Chat sich öffnet (`resolveLaunch`) |
| `command-integration.ts` | Befehl `nx` an- und abmelden und sein Zustand, über `nx.exe --nx-register`/`--nx-unregister`/`--nx-status` |
| `services/settings-service.ts` | `settings.json`, Defaults aus `shared/defaults.ts` |
| `services/settings-transfer.ts` | Einstellungen und eigene Themes in eine Datei exportieren und lesen, was eine solche Datei hier ändern würde (Kanäle `settings:export`, `settings:import-preview`), siehe „Einstellungen übertragen“ |
| `services/theme-service.ts` | Themes (aus dem Claude Manager übernommen) |
| `services/provider-service.ts` | Registriert Provider, Erkennung, Usage je Account (Abfrage, Polling), Browser-Logins |
| `services/usage-samples.ts` | Messpunkte der Limit-Fenster je Account (`usage-samples.json`) und daraus die Prognose je Fenster (Rechnung in `shared/usage-forecast.ts`) |
| `accounts/account-service.ts` | Accounts (`accounts.json`), Profilordner, Login-Stand aus den Dateien der CLIs |
| `accounts/account-env.ts` | Umgebung, mit der die CLI eines Accounts startet |
| `accounts/account-login.ts` | `claude auth login` / `codex login` ohne Terminal: Link, Code, Ergebnis; ein Dialog über stdin für ACP-Agents (`LoginDialog`: `initialize`, `authenticate`). Antigravity CLI über `agy acp --login`, der Code aus dem Browser geht nach stdin (`ProviderMeta.loginCode`); Abmelden über `AgentProvider.logout` (ACP `logout`) |
| `accounts/antigravity-account.ts` | Google-Login von Antigravity CLI: Token-Datei des Ordners, sonst der Schlüsselbund (`cmdkey`, `security`, Secret Service; zwischengespeichert), die E-Mail aus den Logs von `agy acp`, `modelProvider: "gemini"` für Accounts mit API-Key |
| `accounts/cli-files.ts` | Wo die CLIs Login und Verläufe ablegen, Auslesen von Konto, Plan und Ablauf |
| `accounts/claude-usage.ts` | Claude-Limits über die OAuth-Usage-Schnittstelle |
| `accounts/claude-renewal.ts` | Erneuert den Access-Token eines Claude-Browser-Logins mit dem Refresh-Token, unter der Sperre von Claude Code (aus dem Claude Manager) |
| `accounts/login-renewal.ts` | Wann Nexa erneuert: abgelaufene Claude-Logins vor dem Abfragen der Limits (`chat.keepLoginsFresh`) und „Jetzt erneuern“, siehe „Logins frisch halten“ |
| `artifacts/artifact-service.ts` | Claudes Artefakte auf claude.ai je Account (Liste, Vorschaubilder als `data:`-URL, umbenennen, löschen, anpinnen); Kanäle `artifacts:*` in `artifact-ipc.ts`, Typen und Link-Erkennung in `shared/artifacts.ts` |
| `scheduled/scheduled-tasks.ts` | Geplante Aufgaben (`scheduled-tasks.json`): Zeitplan, nächster Lauf, Läufe als Chats über `SessionService`; Kanäle `scheduled:*` in `scheduled-ipc.ts`, Typen, Zeitpläne und Prüfung in `shared/scheduled-tasks.ts`, siehe „Geplante Aufgaben“ |
| `mcp-apps/mcp-app-views.ts` | Seiten von MCP-Werkzeugen (MCP Apps): liest die `ui://`-Ressource (`appPageOf`), hält sie unter `nexa-app://<token>/` und liefert sie mit der CSP ihrer Ressource aus; Kanäle `mcp-apps:*` in `mcp-apps-ipc.ts`, siehe „MCP Apps“ |
| `voice/voice-service.ts` | Spracheingabe: wählt einen Claude-Account mit gültigem Login, streamt die Aufnahme an Claudes Spracherkennung (WebSocket, wie `/voice` in Claude Code) und meldet die Wörter dem Fenster; Kanäle `voice:*` in `voice-ipc.ts`, Typen und Sprachen in `shared/voice.ts` |
| `accounts/session-transfer.ts` | Kopiert die Unterhaltung einer CLI beim Account-Wechsel in den neuen Ordner |
| `accounts/conversation-files.ts` | Die Dateien einer Unterhaltung je Config-Ordner (Claude: Transkript, Subagents, Checkpoints; Codex: Rollouts) und ihre Größe, zum Löschen und Aufräumen |
| `accounts/session-move.ts` | Verschiebt eine Session von Claude Code in den Projektordner eines anderen Arbeitsordners (wie `/cd`, aus dem Claude Manager) |
| `services/project-service.ts` | Projekte (Ordner) und Trenner, ihre Reihenfolge, ausgeschaltete MCP-Server je Projekt; `project-sections.ts` macht ein Projekt zum Trenner |
| `services/folder-prompts.ts` | Prompt eines Projekts oder Trenners (`prompts.md` im Ordner) lesen, schreiben und für den Systemprompt zusammensetzen |
| `providers/mcp-servers.ts` | Antworten der CLIs auf die Frage nach ihren MCP-Servern → `McpServerState` (ohne Nexas eigenen) |
| `providers/titles.ts` | Titel eines Chats vom Modell (`AgentRun.title`): Anweisung für Codex, Prompt gekürzt, Antwort bereinigt (`cleanTitle`) |
| `providers/plugins.ts` | Plugins der CLIs (`claude plugin list --json`, Codex `plugin/installed`) → `PluginInfo`, Antworten auf das Schalten und auf die Anmeldung an MCP-Servern (`McpAuthStart`) |
| `providers/cli-config.ts` | Schnittstelle `CliConfigAdapter` für die Einstellungen einer CLI und was die Adapter teilen: JSON-Dateien lesen und atomar ändern, Secrets in Variablen und Headern zurückhalten, Hooks über ihre Herkunft zurückschreiben; siehe „Einstellungen der CLIs“ |
| `providers/claude/claude-config.ts`, `providers/codex/codex-config.ts`, `providers/antigravity/antigravity-config.ts` | Adapter für Claude Code (Dateien, MCP über `claude mcp`), Codex (App-Server `config/*`, `hooks/list`) und Antigravity CLI (`mcp_config.json`, `hooks.json` und `antigravity-cli/settings.json` selbst geschrieben; Projekte ohne Berechtigungen) |
| `services/cli-config-service.ts` | Prüft Ziel (CLI, Account, Ebene, Projektordner) und Eingaben, ruft den Adapter; Kanäle `cli-config:*` in `cli-config-ipc.ts` |
| `services/global-mcp.ts` | Globale MCP-Server: Übersicht aller Accounts, Anlegen, Global machen, Ändern, Angleichen und Entfernen in jedem Account; `global-mcp.json` hält Namen und Quelle |
| `providers/claude/claude-context.ts` | `get_context_usage` von Claude Code → `ContextDetail` (Teile mit deutschen Namen, MCP-Server, Agents, Anweisungsdateien) |
| `import/claude-manager.ts` | Übernahme aus dem Claude Manager: Workspaces → Trenner mit Projekten, Accounts mit denselben Ordnern, Sessions aus deren Transkripten, dazu Prompts, Themes, Namen und Pins (`cm-extras.ts`); Kanäle `import:*` in `import-ipc.ts` |
| `import/cli-import.ts` | Übernahme der Sessions der CLIs selbst: Transkripte von Claude Code, Threads von Codex (`thread/list`) und Unterhaltungen von Antigravity CLI (`session/list`) aus allen Accounts, je Ordner ein Projekt; Kanäle `import:cli-*` |
| `import/import-plan.ts` | Was beide Übernahmen teilen: Sessions nach Ordnern auf Projekte verteilen (`planGroups`), Titel, `SessionMeta` einer übernommenen Session |
| `import/claude-sessions.ts` | Transkripte eines Claude-Ordners auflisten, ein Transkript samt Subagents als Chat lesen, oder nur was seit einem Zeitpunkt dazukam |
| `providers/claude/claude-presence.ts` | Ob eine Claude-Code-Sitzung gerade in einem anderen Prozess offen ist (`<config>/sessions/<pid>.json`) und wo |
| `providers/codex/codex-presence.ts` | Ob ein Prozess einen Codex-Thread geladen hat (`<CODEX_HOME>/thread-writer-locks/<thread>.lock`, unter Windows) |
| `providers/claude/claude-transcript.ts` | Claude-Code-Transkript (`projects/<key>/<id>.jsonl`) → `ChatItem`s wie aus dem Stream, plus Kurzfassung (Ordner, Titel, Zeiten) |
| `services/session-service.ts` | Sessions: Metadaten, Items, Runs starten/stoppen und ohne Prompt neu starten (`restart`: übernimmt Werkzeuge und Prompts, die eine CLI nur beim Start liest), Wechsel der CLI, Statistik |
| `services/session-search.ts` | Suche in den Prompts und Antworten der Chats (für die Schnellsuche), Ausschnitt um den Treffer |
| `services/transcript-store.ts` | Verlauf je Session als JSONL |
| `services/instructions.ts` | Systemprompt-Zusatz, Übergabe-Kontext beim CLI-Wechsel, `<nexa-shell>` mit den `!`-Befehlen des Nutzers |
| `services/user-shells.ts` | Befehle aus dem Shell-Modus (`!`): welche Shell (`shellLaunch`: PowerShell 7/5.1 mit dem Befehl über stdin, weil `-EncodedCommand` Fehler als CLIXML schreibt; Git Bash, cmd; sonst `$SHELL`), Prozess je Befehl im Ordner des Chats, Ausgabe, Beenden samt Kindprozessen; Zeilen, die nicht UTF-8 sind (Windows-Konsolenprogramme ohne Konsole), liest es in der OEM-Codepage des Systems (`codePageDecoder` in `lib/text-encoding.ts`) |
| `providers/provider.ts` | Schnittstellen `AgentProvider`, `AgentRun`, `RunSink` |
| `providers/claude/*` | Claude Code: Prozess je Session, Stream-JSON, Werkzeug-Abbildung |
| `providers/codex/*` | Codex: ein App-Server je Account für alle seine Sessions, JSON-RPC, Item-Abbildung |
| `providers/acp/acp-connection.ts` | Agent Client Protocol über JSON-RPC (NDJSON auf stdio): Anfragen, Antworten, Benachrichtigungen, Fehlertext (`errorText`) |
| `providers/antigravity/*` | Antigravity CLI: ein Prozess je Chat (`agy acp`), Item-Abbildung (`antigravity-items.ts`), Warteschlange der Prompts, Rückfragen und Plan (`antigravity-run.ts`), Zustand der MCP-Server über den lokalen Server des Prozesses (`antigravity-server.ts`). In der CLI-Wahl der Chats, der Vorgabe für neue Chats und auf der Startseite steht Antigravity erst, wenn Nexa es gefunden hat (`ProviderMeta.untilInstalled`, `offeredProviders`); Einstellungen › CLIs zeigt es immer |
| `lib/secrets.ts` | Ver- und Entschlüsseln von Token und Keys (`safeStorage`) |
| `server-link/*` | Kopplung mit einem selbst gehosteten nexa-server (Einstellungen › Geräte, Konzept in `NEXA-SERVER.md`): `server-link-service.ts` koppelt mit Einladung oder Kopplungscode (`POST /v1/join`), hält Zustand und Geräteliste für das Fenster und speichert alles in `nexa-server.json` (`link-store.ts`, die privaten Schlüssel und die Schlüssel des Namespace über `safeStorage`); `connection.ts` ist der WebSocket mit Anmeldung, Anfragen nach `id`, Neuverbindung mit wachsender Pause und den Schließcodes, die nicht neu verbinden (4401, 4403, 4409); `membership.ts` führt die eigene Liste anerkannter Geräte und wechselt den Schlüssel nach einer Entfernung (siehe PROTOCOLS.md, „nexa-server“). Kanäle `server-link:*` in `server-link-ipc.ts`; `fake-server.ts` ist ein kleiner nexa-server nur für die Tests |
| `remote/*` | Remote Control über den nexa-server (PROTOCOLS.md, „Remote Control“): `remote-host.ts` führt die Aufrufe der Fenster-API aus, die andere Geräte machen (`invoke`), mit den Handlern der eigenen Fenster (`invokeHandler` in `ipc.ts`) und nur so weit, wie die Stufe des Geräts und die Liste der Kanäle reichen (`channelLevel`, Einstellungen › Geräte › Fernsteuerung); es schickt den beobachtenden Geräten die Ereignisse der Fenster (`onBroadcast`), gebündelt, Listen als Änderungen. `remote-client.ts` stellt die Aufrufe dieses Geräts, ordnet die Antworten zu, setzt die Listen wieder zusammen und hält die Beobachtung am Leben; `remote.ts` verbindet beide mit `ServerLinkService`, `remote-ipc.ts` mit dem Fenster (Kanäle `remote:*`, Bilder eines Prompts mit `remote:upload-image`). `remote-chats.ts` trägt die Nachrichten zwischen Chats über Geräte hinweg (`chats.*`, Typen und Prüfung in `shared/remote-chats.ts`): `RemoteChatsHost` beantwortet die Werkzeuge der anderen Geräte, nach der Stufe nur bestätigten, nur mit der eigenen Einstellung „Nachrichten zwischen Chats“, mit der Kette (`MAX_CHAT_CHAIN`) und Grenzen je Chat und Gerät; `DeviceChats` stellt die Anfragen der eigenen Werkzeuge über `RemoteClient` und gibt dem Agent in Worten, was nicht ging. Die Nachrichten gehen über `server-link/device-channel.ts`: nur für die beiden Geräte verschlüsselt, signiert, in Reihenfolge, zu große in Teilen (`rc.part`) |
| `shared/nexa-server/*` | Für Desktop und spätere PWA, nur WebCrypto: `protocol.ts` und `auth.ts` aus dem Repo nexa-server kopiert (gleich halten), `server-messages.ts` prüft, was der Server schickt, `envelope.ts` verschlüsselt und signiert die Nachrichten zwischen Geräten, `members.ts` die Regeln für Mitglieder und Schlüssel, `pairing-code.ts` Adresse und Kopplungscode |
| `lib/shell-env.ts` | Linux: übernimmt beim Start die Umgebung der Login-Shell (PATH mit nvm & Co.), damit die CLIs auch beim Start aus dem Anwendungsmenü gefunden werden |
| `lib/linux.ts` | Wie die Linux-Version installiert ist (AppImage, deb, rpm); `cliEnv` nimmt mit `withoutAppImageEnv` die Pfade des AppImage-Mounts aus der Umgebung der CLIs |
| `services/notification-service.ts` | Windows-Meldungen zu Chats, die fertig sind, etwas fragen oder am Limit stehen (`SessionService`-Ereignis `attention`), blinkende Taskleiste; Warnung bei fast verbrauchten Limits (`lib/near-limit.ts`) und abgelaufenem Login, gemerkt in `notifications.json`; Texte in `lib/notification-text.ts`. Dazu die Benachrichtigungen der Agents (`notify`): Toast im Fenster vorn oder Meldung des Systems mit Knöpfen |
| `services/auto-switch.ts` | Am Limit eines Accounts (`attention` `limit`): den verlassenen Account bis zu seinem Reset sperren, mit `chat.autoSwitch` beim nächsten freien Account derselben CLI weitermachen, sonst bis zum ersten Reset warten (`SessionRuntime.resume`); gemerkt in `auto-switch.json`, siehe „Accounts“ |
| `services/update-service.ts` | Updates aus den GitHub-Releases (electron-updater, Suche nach 10 s und alle 4 h), Versionshinweise über die GitHub-API bzw. den Atom-Feed: die neuesten 10 mit jeder Suche (auch ohne Updater, z. B. in der Entwicklung), gemerkt in `release-notes.json`, ältere seitenweise auf Anfrage; Kanäle `updates:*` in `updates-ipc.ts` |
| `mcp/*` | Nexa-MCP-Server (Streamable HTTP): `render_*`, `browser_*`, `chat_*` mit `sessions_search` und `limits` (`nexa-tools.ts`), ein Token je Run nennt den Chat (`McpCaller`); `chat-tools.ts` lässt die Agents andere Chats beim Namen finden, durchsuchen (`SessionService.search`), lesen, anschreiben und anlegen (über `SessionService.sendFromChat`, auch Claude ↔ Codex), auch die der gekoppelten Geräte („Gerät › Titel“, ID `<Instanz>:<Session>`, über `DeviceChatPeers` aus `remote/remote-chats.ts`), wobei ein Name zuerst unter den eigenen Chats gesucht wird; `limits-tool.ts` nennt die Limits des Accounts, mit dem der Chat läuft, und die der anderen Accounts (immer dabei, solange der Server läuft); `ask-tool.ts` zeigt mit `ask_user` ein Formular im Chat des Aufrufers und wartet auf die Antwort (`SessionService.ask`, ebenso immer dabei); `notify-tool.ts` schickt mit `notify` eine Benachrichtigung, die zum Chat führt, auf Wunsch mit Knöpfen, deren Wahl der Agent abwartet (`NotificationService.fromAgent`, ebenso immer dabei); `tool-grant.ts` legt fest, welche Werkzeuge die CLIs ohne Rückfrage nutzen; `call-log.ts` merkt sich die Argumente der Aufrufe eines ACP-Chats für Agents, die sie nicht nennen (Antigravity nennt sie, Nexa leert das Protokoll dort nur) |
| `browser/browser-tabs.ts` | Tabs der Browser je Chat (`browser-tabs.json`): welche Seiten, welche gezeigt, wer sie geöffnet hat |
| `browser/browser-control.ts` | Aus dem Claude Manager: steuert die Seiten für die Agents über das DevTools-Protokoll (`page-driver.ts`, Frames, Netzwerk, Routen, Dialoge, Emulation), Protokoll, Übernehmen |
| `browser/browser-tools/*` | Die `browser_*`-Werkzeuge (aus dem Claude Manager), `BROWSER_INSTRUCTIONS` für den Server |
| `browser/browser-ipc.ts` | Kanäle `browser:*` (Tabs, Seiten, Downloads, Logins, Übernehmen) |
| `browser/browser-frames.ts` | Live-Bilder der Seiten für die Browser-Karten im Chat (`beginFrameSubscription`, JPEG, gedrosselt), solange ein Fenster zusieht |
| `api/api-server.ts` | Lokale REST-API mit Token (nur `127.0.0.1`, kein `Origin`, nur Host `127.0.0.1`/`localhost`); die Handler hängen am Schlüssel der Route (`Record<ApiRouteKey, Handler>`), eine Route ohne Handler oder ein Handler ohne Route fällt schon bei `tsc` auf |
| `api/routes.ts` | Die Routen als Tabelle: Methode, Pfad, Parameter, Body mit Beispiel, Antwort, Fehler; `matchRoute` findet Route und Parameter (405 mit `Allow`) |
| `api/openapi.ts`, `api/docs-page.ts` | Beschreibung der API aus der Tabelle: `GET /openapi.json` (OpenAPI 3.1, Schemas in `API_SCHEMAS`) und `GET /docs` (eigenständiges HTML ohne Skripte und ohne Netz, CSP `default-src 'none'`), beide ohne Token; `openapi.test.ts` prüft, dass jede Route des Servers beschrieben ist und umgekehrt |
| `files/file-tree-service.ts` | Dateibaum aus dem Claude Manager: Ordner lesen und überwachen, Git-Status, Diffs, Suche, Vormerken/Verwerfen, angefasste Dateien (`touched`) |
| `files/git-service.ts` | Branch, Checkouts, Web-Adresse und Hauptordner eines Repositorys; Worktrees der Chats anlegen, betreten und entfernen |
| `files/worktree-setup.ts` | Was ein neuer Worktree mitbekommt: Dateien aus `.worktreeinclude` (Muster, Auswahl, sicheres Kopieren) und `worktree.baseRef` aus den Einstellungen von Claude Code |
| `files/activity-tracker.ts` | Leitet aus den Werkzeug-Items der Sessions ab, was der Agent mit Dateien tut (live und aus dem Verlauf) |
| `files/file-activity.ts`, `files/shell-files.ts` | Shell-Befehle: welche Dateien sie nennen, schreiben, ob sie committen |
| `files/files-ipc.ts` | Kanäle `files:*` und `git:*` mit Prüfung der Pfade; ein anderes Gerät erreicht nur die Ordner der Chats (`files/remote-roots.ts`) |
| `files/checkpoints.ts` | Nexas Checkpoints für alle CLIs: die Ordner eines Chats vor jedem Prompt und am Ende seines Turns in einem Schatten-Repository je Ordner (Datenordner `checkpoints/`), was jeder Prompt geändert hat, Zurückspulen mit Vorschau und Zurücknehmen; siehe „Checkpoints“ und PROTOCOLS.md, „Checkpoints (Nexa)“ |
| `window/*` | Hauptfenster und Fenster der Chats (`createAppWindow`, Art je Fenster: `windowKind`), Fensterzustand, Material (Mica/Acryl), Datei-Protokoll |
| `window/chat-windows.ts` | Chats in eigenen Fenstern: welches Fenster welchen Chat zeigt, Übergabe von Entwurf und Panels, Rückfrage beim Schließen, Lage je Chat und die beim Beenden offenen in `chat-windows.json`; Kanäle `chat-windows:*` in `chat-windows-ipc.ts`, siehe „Chats in eigenen Fenstern“ |
| `window/window-place.ts` | Lage eines Fensters: gemerkte Bounds nur, wenn sie auf einem Bildschirm liegen, das Fenster eines Chats sonst versetzt neben dem Hauptfenster |
| `lib/per-window.ts` | Listen, die jedes Fenster ganz schickt (überwachte Ordner, Git-Ordner): je Fenster gemerkt, zusammen angewandt, beim Schließen eines Fensters ohne dessen Liste |
| `window/tray.ts` | Symbol im Infobereich (Einstellung `general.runInTray`): Schließen blendet das Fenster dann nur aus, das Menü öffnet und beendet. Unter Windows öffnet ein Rechtsklick Nexas eigenes Menü (`tray-menu.ts`), unter macOS und Linux das des Systems |
| `window/tray-menu.ts` | Eigenes Menü des Symbols (Windows): rahmenloses Fenster mit eigenem Preload (`preload/tray.ts`, nur `window.trayMenu`) und eigener Seite (`renderer/tray.html`, `src/tray/TrayMenu.vue`), Theme und Material der Einstellungen, kleine runde Ecken über DWM (`roundSmallCorners` in `material.ts`). Zeigt die Chats, die warten oder arbeiten (`trayChats` in `shared/tray-menu.ts`), „Neuer Chat“, den Schalter der Benachrichtigungen, Öffnen und Beenden. Startet, sobald der Zeiger über dem Symbol ist, öffnet am Zeiger in der Arbeitsfläche (`trayMenuPlace` in `window-place.ts`), schließt bei `blur`, Esc oder einer Wahl und gibt seinen Renderer nach 5 Minuten zu wieder ab. Kein App-Fenster: Broadcasts und `openAppWindows` sehen es nicht, seine Kanäle `tray-menu:*` prüfen mit `handle(…, from)` nur dieses Fenster |
| `lib/fonts.ts` | Installierte Schriften für die Schriftwahl der Einstellungen (Windows über .NET in PowerShell, Linux `fc-list`), einmal pro Sitzung; Kanal `app:list-fonts` |
| `lib/login-item.ts` | Start mit der Anmeldung (`general.launchAtLogin`, Schalter `--autostart`): Windows über den Run-Schlüssel (der Uninstaller in `build/installer.nsh` entfernt ihn), Linux über `~/.config/autostart/nexa.desktop`; mit Infobereich startet das Fenster versteckt |
| `window/browser-*.ts` | Härtung der `<webview>`s (eigene Partition, keine Node-Integration, Berechtigungen, Popups, Navigation, Tastenkürzel), Downloads, HTTP-Logins |

## Datenmodell

Alles, was im Chat steht, ist ein `ChatItem` (`src/shared/chat.ts`):

- `user`, `assistant` (Text, streamt per Delta), `thinking`. Ein `user` mit `from` hat der Agent eines
  anderen Chats geschickt (`chat_send`); `UserMessage` zeigt ihn umrandet mit „Nachricht von …“.
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

## Chats in Worktrees

„Neuer Chat in Worktree …“ (Kontextmenü eines Projekts oder Ordners in der Sidebar, Befehlsliste) öffnet
`WorktreeDialog`: Repository (ein Ordner darin, vorbelegt mit dem des Projekts, Ordners oder Chats), Name
(geprüft für Branch und Ordner, auch Windows' Gerätenamen, `shared/worktree.ts`; vorbelegt mit einem
erfundenen wie `bright-running-fox`, leer erfindet Nexa einen), die vorhandenen Worktrees zum Anklicken und
„Abzweigen von“: „Standard-Branch“ (`origin/main`) oder „Aktueller Stand“ (der HEAD des Ordners), vorbelegt
mit `worktree.baseRef` aus den Einstellungen von Claude Code (`settings.local.json` und `settings.json` des
Hauptordners, dann die des Nutzers), sonst „Standard-Branch“; ohne `origin` gibt es nur den HEAD.
`GitService.worktreeCheck` (Kanal `git:worktree-check`) sagt, ob es geht (Repository mit einem Commit), wovon
ein neuer abzweigen kann (`head`, `fresh`, `baseRef`), welche Worktrees und übrig gebliebenen
`worktree-*`-Branches es gibt, ob git `.claude/worktrees/` ignoriert (sonst ein Hinweis auf die `.gitignore`)
und was `.worktreeinclude` mitbringt (`include`: Zahl, die ersten Namen, Größe bis 2 000 Dateien). Sind es
viele (über 1 000 Dateien oder 100 MB), warnt der Dialog, dass das Anlegen dauert.

Den Worktree legt Nexa selbst mit git an, wo und wie Claude Code es mit `claude --worktree <name>` täte
(`GitService.addWorktree`, Einzelheiten zu Claude Code in `docs/PROTOCOLS.md`): `.claude/worktrees/<name>` im
Hauptordner des Repositorys, auch aus einem anderen Worktree heraus, auf einem neuen Branch `worktree-<name>`
(`--no-track`). Mit `fresh` zweigt er vom Standard-Branch von `origin` ab (`originDefault`: der Branch von
`origin/HEAD`, sonst `main`, sonst `master`); war das Repository seit 24 Stunden nicht geholt (`FETCH_HEAD`),
holt Nexa vorher diesen einen Branch, ohne zu fragen und höchstens 5 s lang, sonst nimmt es den, den git hat.
Hat git ihn gar nicht, holt Nexa ihn (bis 20 s); klappt das nicht, zweigt der Worktree vom HEAD ab, und der
Dialog sagt es in einem Toast (`SessionMeta.worktree.base` nennt, wovon er abzweigte). Mit `head` nimmt er den
HEAD des gewählten Ordners. Den Schalter von Claude Code nimmt Nexa nicht (siehe `docs/PROTOCOLS.md`): So
arbeitet Codex ebenso darin, und der Chat ist ein gewöhnlicher Chat in einem Ordner. `SessionService.create`
mit `worktree` setzt `cwd` auf den Worktree und merkt ihn in `SessionMeta.worktree`; liegt er nicht im Projekt
(das Projekt ist ein Unterordner des Repositorys), kommt der Chat ins innerste Projekt darüber, sonst in ein
neues für den Hauptordner. Filter aus der Konfiguration des Repositorys (`filter.<name>.smudge`/`clean`/`process`)
laufen beim Auschecken nicht (`files/git-filters.ts`, wie im Dateibaum), denn auch ein Agent kann sie dort
eintragen; mit `git lfs install --local` liegen dann Zeiger statt der Dateien im Worktree (`git lfs pull` darin
holt sie). Aus demselben Grund holt Nexa mit `--upload-pack=git-upload-pack` und listet ohne `core.fsmonitor`.

Ein neuer Worktree bekommt danach, was Claude Code ihm mitgibt (`files/worktree-setup.ts`): die Dateien, die
`.worktreeinclude` im Hauptordner nennt (Syntax der `.gitignore`), sofern git sie ignoriert, so dass nie eine
Datei aus dem Repository doppelt kommt. `git ls-files --others --ignored --exclude-standard --directory` nennt
sie; einen ganz ignorierten Ordner wie `node_modules/` liest Nexa nur, wenn ein Muster in ihn führt
(`reachesInto`, wie Claude Code). Kopiert wird nur, was eine gewöhnliche Datei ist, nie ein Link, nie über
eine Datei, die der Checkout schon hat, nie durch einen Link im Worktree und nie etwas unter
`.claude/worktrees/`. Auf Windows kommt auch `.claude/settings.local.json` mit, weil Claude Code sie dort im
Ordner der Sitzung sucht. Was sich nicht kopieren lässt, steht im Log; der Worktree entsteht trotzdem.

Einen Worktree des Namens, den es schon gibt, betritt der Chat wieder, ohne Kopieren. Mit `fresh` bringt
Nexa ihn vorher auf den Stand des Standard-Branchs (`refresh`, `git reset --hard`), wenn dabei nichts verloren
geht: Er ist auf seinem Branch, `git status` zeigt nichts, alle seine Commits sind schon auf dem
Standard-Branch, kein Chat arbeitet darin (`SessionService.inUse`) und git sperrt ihn nicht (eine laufende
Sitzung von Claude Code). Einen übrig gebliebenen Branch `worktree-<name>` setzt der neue Worktree fort, anders
als Claude Code, das ihn zurücksetzt: Nexa lässt ihn beim Löschen nur stehen, wenn er eigene Commits hat.

Die Sidebar zeigt einen Worktree als eine Ebene mit seinem Namen und dem Worktree-Symbol
(`lib/session-tree.ts`), auch für Chats, die Claude Code selbst in einem Worktree hatte.

Gelöscht wird der Worktree mit dem letzten Chat, der ihn in `worktree` hat (`SessionService.remove`,
`GitService.removeWorktree`), samt Branch, wie Claude Code es am Ende einer Sitzung im Worktree tut: nur,
wenn kein anderer Chat darin arbeitet (auch als hinzugefügter Ordner), `git status` nichts zeigt und seine
Commits auch auf einem anderen Branch, einem Tag oder einem Remote-Branch liegen (ein gemergter oder
gepushter Branch geht also mit, ein Squash-Merge nicht; ein Worktree vom Standard-Branch von `origin` bringt
Commits mit, die lokal noch kein Branch hat). Was git ignoriert, geht mit, auch die kopierten Dateien. Sonst bleibt er, und das Fenster sagt warum, mit „Ordner
öffnen“ (`SessionRemoveResult.worktreesKept`). Die Rückfrage vor dem Löschen erwähnt es. Ein Abzweig des
Chats teilt sich den Worktree; zieht ein Chat aus seinem Worktree weg, nimmt er ihn nicht mehr mit.

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
- Antigravity CLI: `session/list` über `agy acp` je Account-Ordner (`AgentProvider.sessions`), ohne
  Unterhaltungen, deren Datenbank fehlt.

Nur eingeschaltete, installierte CLIs zählen, Accounts mit demselben Ordner nur einmal. Sessions, die
Nexa schon kennt (`knownCliSessions`), bleiben draußen; liegt dieselbe Session in mehreren Ordnern
(nach einem Account-Wechsel), gilt die zuletzt geänderte Kopie. `planGroups` (`import-plan.ts`, auch für
den Claude Manager) ordnet jede Session dem innersten Projekt über ihrem Ordner zu; ohne eines wird ihr
Ordner ein neues Projekt unter „Projekte“. In der Vorschau wählt man die Gruppen aus.

Wie beim Claude Manager liest `SessionService` den Chat erst beim ersten Öffnen: Claude aus dem
Transkript in `importedFrom`, Codex mit `thread/read` über den App-Server des Accounts in `cli.codex`
(`AgentProvider.history`, `codexThreadItems`), Antigravity mit `session/load` (`AntigravityRun.replay`,
Zeiten aus der Datenbank, `stampHistory`). Die Suche liest so auch noch nie geöffnete Chats. Gibt
die CLI keinen Verlauf heraus, steht eine Warnung im Chat; er geht trotzdem in derselben Session weiter.

## Abgleich mit Claude Code und Codex

Ein Chat mit `cli.claude` kann außerhalb von Nexa weitergehen (`claude --resume` im Terminal, Claude
Desktop); das Transkript wächst dann ohne Nexa. `SessionService.syncCli` liest, was nach `CliLink.synced`
dazukam (`transcriptSince`, `readClaudeChatSince`), nur fertige Turns, und hängt es mit einer Notiz
„Außerhalb von Nexa weitergeführt“ an den Chat; folgen mehrere Turns von dort ohne etwas aus Nexa
dazwischen, zählt dieselbe Notiz weiter. Läuft Nexas eigene CLI des Chats untätig, endet sie: Sie kennt
die neuen Turns nicht, der nächste Prompt setzt mit `--resume` auf dem ganzen Transkript fort. Während ein
Turn in Nexa läuft, wird nichts übernommen.

Mit `cli.codex` genauso, wenn der Thread in der Codex-TUI, in VS Code oder der Codex-App weiterging: Ist
sein Rollout seit `CliLink.synced` gewachsen, holt `AgentProvider.history` mit `since` nur die neuesten
Turns (`thread/turns/list`), und `codexTurnsFromOutside` nimmt die fertigen, von denen der Chat kein Item
kennt. Einen Thread hat immer nur ein Prozess geladen (`codex-presence.ts`): Was dazukam, während Nexas
App-Server ihn hielt, ist Nexas eigenes, deshalb setzt auch das Ende eines Codex-Laufs `synced`. Damit die
TUI den Thread öffnen kann, endet ein Codex-Lauf nach 60 s ohne Turn (`releaseWhenIdle`), der App-Server
entlädt ihn eine Minute später; der nächste Prompt setzt ihn mit `thread/resume` fort.

Mit `cli.antigravity` (`agy` im Terminal): Ist die Datenbank der Unterhaltung (oder ihr `-wal`) seit
`CliLink.synced` geändert und hat sie Prompts, die danach gemacht wurden (Zeiten der Schritte), liest
`AgentProvider.history` mit `since` deren Turns über `session/load`. Nexas eigene Turns enden vor
`synced`, das jedes Turn-Ende setzt. Wo die Unterhaltung sonst offen ist, sagt Antigravity nicht.

Anlässe: `open()` (der Chat wird geladen), im Renderer der Wechsel in einen schon geladenen Chat, der Fokus
des Fensters (`ChatView`, höchstens alle 2 s) und „Mit … abgleichen“ im Menü des Chats (`sessions:sync`,
mit „Nichts Neues“ als Toast). Bei jedem Abgleich prüft `claude-presence.ts` bzw. für Codex die Sperre des
Threads (`AgentProvider.openElsewhere`), ob ein anderer Prozess die Unterhaltung offen hat
(`SessionRuntime.openElsewhere`); solange, steht ein Hinweis über der Eingabe und der Chat gleicht alle 5 s
ab. Hat die TUI den Thread, nimmt Codex in Nexa keine Prompts an („already has an active writer“, als
deutscher Fehler aus `heldElsewhere`).

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
`<nexa-context>`. Antigravity CLI kann über ACP weder abzweigen noch kürzen: Nexa kopiert ihre Unterhaltung
vor dem nächsten Start unter neuer ID und schneidet sie vor dem Prompt ab (`forkAntigravity`,
`copyConversation` in `antigravity-conversations.ts`, `CliLink.fork.at` ist dort eine Zeit). Bearbeiten lassen sich Prompts des Hauptstrangs unter dem letzten `/clear`, auch
während der Agent arbeitet: `edit` beendet dann die CLI samt ihrem Turn, Prompts in der Warteschlange
landen hinter dem bearbeiteten und fallen mit weg. Nur eine Shell im Hintergrund oder ein Agent von vor
dem Prompt hält es auf, sie stünden sonst als laufend im Chat. Was die Agents an Dateien geändert
haben, bleibt; zurückspulen lässt es sich mit den Checkpoints.

## Checkpoints (Änderungen je Prompt)

Keine CLI gibt Nexa die Dateien vor einem Prompt zurück (Claude Code sichert in `-p` nichts, Codex'
`thread/revert` lässt die Dateien, ACP kennt es nicht; PROTOCOLS.md, „Checkpoints“). `files/checkpoints.ts`
hält die Ordner eines Chats deshalb selbst fest, für Claude Code, Codex, Antigravity CLI und jede CLI, die
dazukommt, ohne dass ihr Provider etwas davon weiß:

- **Wann** (`SessionService`): `send` beginnt vor einem Prompt, der einen Turn beginnt, einen Checkpoint
  (`beginCheckpoint`, der Prompt wartet höchstens `CHECKPOINT_WAIT_MS`), das Item `turn` beendet ihn
  (`endCheckpoint`) und schreibt die Zahlen an den Turn (`TurnItem.fileChanges`). `fork` kopiert die
  Checkpoints, `edit` streicht die der wegfallenden Prompts, `remove` löscht sie. Einstellung
  „Checkpoints der Dateien“ (`chat.checkpoints`, an).
- **Anzeige**: Unter dem Turn „3 Dateien +12 −4“ (`TurnFooter`), das den Dialog „Änderungen je Prompt“
  (`PromptChangesDialog`) an seinem Prompt öffnet; ebenso „…“ im Chat-Kopf und `/rewind`. Der Dialog zeigt
  die Prompts mit ihren Dateien und jede Änderung als Diff (`DiffView` des Chats, `sessions:change-diff`).
  `ChatView` lädt die Liste (`sessions:changes`), wenn ein Prompt, ein gezählter Turn oder ein
  Zurückspulen dazukommt, und reicht sie per `provideChatChanges` an Prompts und Turns weiter.
- **Zurückspulen** (Symbol links neben einem Prompt mit Checkpoint, oder im Dialog): erst die Vorschau
  (`sessions:rewind-preview`: was zurückgesetzt, wiederhergestellt oder gelöscht wird, was seit dem letzten
  Turn auch außerhalb geändert wurde), dann `sessions:rewind`. Nicht während der Chat arbeitet. Der Chat
  bleibt, wie er ist; ein Hinweis (`NoticeItem.rewind`) steht im Verlauf, und mit dem nächsten Prompt
  erfährt die CLI davon (`rewindContext`, `<nexa-rewind>`). „Rückgängig“ im Toast oder „Zurücknehmen“ im
  Dialog (`sessions:rewind-undo`) setzt die Dateien wieder auf den Stand davor.

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

### Startbefehle

Ein Projekt hat Startbefehle (`Project.startCommands`, `shared/start-commands.ts`), wie die Shells mit
Startbefehl in den Tab-Sets des Claude Managers: Befehl (eine Zeile), Name, ein Ordner im Projekt (relativ,
mit `/`) und „Automatisch starten“. Bearbeitet werden sie in `StartCommandsDialog` (`ui.startCommandsProject`;
„Startbefehle …“ im Kontextmenü des Projekts, am Trenner für das Projekt seines Ordners, im Menü des Chats und
in der Befehlsliste). `StartCommands.save` prüft sie mit `parseStartCommands` (kein Ordner außerhalb des
Projekts) und speichert sie über `ProjectService.setStartCommands` in `projects.json`.

`services/start-commands.ts` (`StartCommands`, Kanäle `start-commands:*` in `start-commands-ipc.ts`) führt sie
aus wie die `!`-Befehle: `shellLaunch` mit `settings.chat.shell`, ein Prozess je Befehl über eine eigene
`UserShells` (Dekodierung, Ende der Ausgabe, Beenden samt Kindprozessen), im Ordner des Projekts oder dem
Ordner darin. Die Ausgabe bleibt im Speicher von Main und geht weder auf die Platte noch an einen Agent
(daher ohne `redactSecrets`); das Fenster holt ihr Ende (`output`, 100 000 Zeichen) jede Sekunde, solange
der Befehl läuft und gezeigt wird. Die Läufe (`StartCommandRun`: Zustand, Shell, Zeiten, Exit-Code, Fehler
wie ein fehlender Ordner) gehen als Ereignis an die Fenster; der letzte Lauf jedes Befehls bleibt, bis der
Befehl oder sein Projekt geht (`projectsChanged` beendet ihn dann). „Neu starten“ beendet den Prozess und
startet den Befehl so, wie er jetzt gespeichert ist. Beim Beenden von Nexa enden alle (`dispose` wartet bis
zu 3 s, damit kein Dev-Server seinen Port behält). Für „Automatisch starten“ meldet `ChatView` das Projekt
jedes Chats, den es zeigt (`chatOpened`): Beim ersten Chat eines Projekts mit solchen Befehlen starten sie,
einmal je Lauf von Nexa; einer, den der Nutzer beendet hat, bleibt aus.

### Terminal

Das Terminal rechts neben dem Chat (Knopf im Kopf des Chats links von „Chat neu starten“, Strg+Ö oder
Strg+`) ist eine echte Shell in einer Pseudokonsole: `services/terminals.ts` (`Terminals`, Kanäle
`terminals:*` in `terminals-ipc.ts`) startet sie mit node-pty im Ordner des Chats
(`SessionService.terminalTarget`) und mit der Umgebung seines Accounts (`AccountService.env`:
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, ohne die Variablen einer übergeordneten Sitzung, `cliEnv`), so dass
`claude` oder `codex` dort mit dem Login des Chats laufen. Welche Shell, bestimmt `terminalLaunch`: unter
Windows die aus `settings.chat.shell` interaktiv (PowerShell `-NoLogo`, Git Bash `--login -i` mit
`CHERE_INVOKING`, cmd), sonst die Login-Shell (`$SHELL -l`). node-pty wird erst mit dem ersten Terminal
geladen; scheitert das (Linux mit älterer glibc), scheitert nur das Terminal. Main sammelt die Ausgabe
und schickt sie alle 8 ms an die Fenster, mit der Zahl aller bisher geschriebenen Zeichen (`end`); das
Ende der Ausgabe (512 KB) bleibt für eine neue Ansicht (`buffer`), und was das Fenster schon mit dem Puffer
bekam, verwirft es an `end`. Terminals laufen weiter, wenn man den Chat verlässt oder das Panel schließt,
und enden mit ihrem Chat (`keepSessions` auf `sessions.changed`) oder mit Nexa. Eine Shell, die mit 0
endet (`exit`), nimmt ihr Terminal mit; eine mit Fehler bleibt mit „[Shell beendet mit Code …]“ stehen.

Im Renderer hält `stores/terminals.ts` die Liste aus Main, das Panel offen je Chat, den gezeigten Tab
und die Breite (localStorage). Das xterm jedes Terminals (`lib/terminal-session.ts`, mit Fit-, Unicode-11-
und Link-Addon) lebt im Store, nicht im Panel: `TerminalView` hängt sein Element nur ein und aus, so
bleibt der Bildschirm beim Wechsel des Chats. Farben aus der Terminal-Palette des Themes auf `--code-bg`
(`lib/terminal-theme.ts`), Schrift aus der Code-Schrift der Einstellungen. Strg+C kopiert mit Auswahl
(sonst bricht es ab), Strg+V fügt ein, die Kürzel des Fensters gehen am Terminal vorbei an die App
(`lib/terminal-keys.ts`). Strg+Klick auf einen Link öffnet ihn, eine Adresse auf `localhost` im Browser
des Chats.

Im Renderer hält `stores/start-commands.ts` die Läufe. `StartCommandsMenu` im Kopf des Chats (nur mit
Startbefehlen; ein Punkt in `--tool-run`, solange einer läuft) startet einen Befehl und klappt ihn im Dock
auf (`ShellDock`, siehe Renderer) als eigene Zeile über den Shells des Chats (`ui.shellId` ist dann
`startShellId(id)`, `start:<id>`); `StartCommandDetail` zeigt darunter Ausgabe, Starten, Neu starten und
Beenden. Ein Startbefehl, der endet, bleibt stehen, damit seine letzten Zeilen lesbar sind. Die
Sidebar zeigt am Projekt, was läuft, und startet oder beendet im Kontextmenü; `/tasks` öffnet einen
laufenden Startbefehl, wenn im Chat keine Shell läuft.

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

- `system` / `system-codex` / `system-antigravity`: der eigene Ordner der CLI (`~/.claude` bzw.
  `CLAUDE_CONFIG_DIR` der Umgebung, `~/.codex`, `~/.gemini`). Immer da, nicht entfernbar; Nexa ändert die
  Umgebung dafür nicht. Den Google-Login von Antigravity CLI im Schlüsselbund (einer je Benutzer) zeigt
  nur dieser Account, mit dem Plan aus `session/new`.
- `oauth`: eigener Ordner `profiles/<id>` in den App-Daten, Browser-Login. Neue Codex-Ordner bekommen
  `cli_auth_credentials_store = "file"`, damit jeder Account sein eigenes `auth.json` hat statt eines
  gemeinsamen Eintrags im Schlüsselbund. Aus demselben Grund starten weitere Google-Accounts von
  Antigravity CLI mit `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true`: Ihr Token liegt im eigenen Ordner.
- `token` / `apiKey`: Secret verschlüsselt in `accounts.json`, beim Start als `CLAUDE_CODE_OAUTH_TOKEN`
  bzw. `ANTHROPIC_API_KEY` (Claude) oder `GEMINI_API_KEY` (Antigravity CLI, nur `apiKey`, eigener Ordner
  über `--gemini-dir` mit `modelProvider: "gemini"`). Entschlüsselt nur im Speicher von Main.

`AccountService` liest alle 15 s die Login-Dateien (Konto, Plan, Ablauf) und meldet Änderungen.
`accountEnv()` baut die Umgebung: `CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME` setzen (für Antigravity CLI den
Ordner als `AccountEnv.dir`, den der Provider als `--gemini-dir` übergibt) und die Anmelde-Variablen
der Umgebung entfernen, damit kein fremder Login durchschlägt.

Accounts, Chats und Einstellungen von Gemini CLI aus Nexa 0.x übernimmt `provider-migration.ts` beim Laden:
Gemini-Accounts fallen weg, Chats wechseln zur Standard-CLI (Verlauf und Items bleiben, alte Items zeigen
das Antigravity-Symbol), eine Standard-CLI „gemini“ wird zur ersten CLI. Nichts davon wirft.

Die Session merkt sich je CLI den gewählten Account (`SessionMeta.accounts`) und je `CliLink`, mit
welchem Account die Sitzung der CLI entstand. Weichen beide ab, kopiert `session-transfer.ts` die
Unterhaltung (Claude: Transkript, Unterordner, `file-history`; Codex: Rollout unter `sessions/`) in den
neuen Ordner und setzt sie dort fort (Codex mit `thread/resume { path }`). Klappt das nicht, verfällt
der Link und die CLI bekommt den ganzen Verlauf als `<nexa-context>`. Antigravity: die Datenbank der
Unterhaltung (`copyConversation`, mit `VACUUM INTO`) und ihr `brain/<id>/` in den Ordner des Accounts.

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

### Logins frisch halten

Claude Code erneuert einen abgelaufenen Access-Token erst, wenn es wieder mit dem Account startet. Bis
dahin kann Nexa die Limits eines ruhenden Accounts nicht abfragen, und ein Chat, der zu ihm wechselt,
wartet erst auf die Erneuerung. Mit `chat.keepLoginsFresh` (Vorgabe an) erneuert `LoginRenewal` den Token
deshalb selbst, bevor `ProviderService.refreshUsage` (beim Start, alle 5 Minuten, „Aktualisieren“) die
Limits fragt: nur Browser-Logins von Claude (`nexaRenewsLogin`) mit `authState` `expired`, je Account eine
Erneuerung zur Zeit. `renewClaudeLogin` macht es wie Claude Code (Endpunkt und Sperre in PROTOCOLS.md):
unter dessen Sperre, mit der Datei unter der Sperre noch einmal gelesen (hat Claude Code inzwischen
erneuert, bleibt es dabei), und geschrieben wird nur, solange die Datei noch den benutzten Refresh-Token
hält. Ein Refresh-Token, den Anthropic mit `invalid_grant` ablehnt, merkt sich `cli-files.ts`
(`refuseRefreshToken`, nur im Speicher): Der Login ist dann `dead`, „Login abgelaufen“ meldet es, und
`AutoSwitch` nimmt den Account nicht mehr (`switchable`). Was sonst scheitert (Netz, Claude Code erneuert
gerade), versucht die nächste Runde. Für den Wechsel am Limit heißt das: Die Limits ruhender Accounts
sind aktuell, eine geschätzte Sperre bekommt ihren echten Reset, und der Chat startet beim nächsten
Account mit gültigem Token.

Die Karte „Logins“ (Einstellungen › Accounts, `LoginTable.vue`, Texte in `lib/logins.ts`) zeigt je Account
Status, Ablauf des Access-Tokens, Ende des Logins (`loginEndsAt` aus `refreshTokenExpiresAt`) und wann die
Tokens zuletzt gespeichert wurden (`tokenSavedAt`: Zeit der Datei bei Claude, `last_refresh` bei Codex).
„Jetzt erneuern“ (`accounts:renew-login`) erneuert auch einen Token, der noch gilt (`force`), und liest
danach die Limits; das geht auch mit ausgeschaltetem `keepLoginsFresh`. Codex-Logins erneuert Nexa nicht:
Codex tut es selbst, sobald es den Token braucht, und Nexa kennt keine Sperre, unter der Codex erneuert
(siehe PROTOCOLS.md, Codex › Accounts und Login).

### Am Limit

Stoppt ein Turn am Limit seines Accounts (`TurnItem.limit`, Ereignis `attention` `limit`), sperrt
`AutoSwitch` den Account bis zum Reset: dem spätesten der vollen Fenster aus `ProviderService.usage()`,
ohne Angabe der CLI geschätzt 5 Stunden (`UNKNOWN_RESET_MS`), bis eine Messung den Reset nennt. Ein Turn,
der mit dem Account durchgeht, hebt die Sperre auf. Mit `chat.autoSwitch` geht der Chat sofort mit dem
nächsten freien Account derselben CLI weiter (`nextAccount` in `shared/account-choice.ts`): in der
Reihenfolge der Accountliste, ohne gesperrte, volle, abgemeldete, denselben Login in anderem Ordner und
API-Keys (die kosten pro Token). Der Wechsel ist der gewohnte (`SessionService.update` mit `account`,
dann `send` mit `chat.continuePrompt`); die Unterhaltung kopiert `useAccount`.

Ohne freien Account, oder auf „Am Reset fortsetzen“ (`sessions:resume-at-reset`, auch ohne Wechsel),
wartet der Chat: `firstFree` sucht den Account, der zuerst frei wird (mit Wechsel jeder der CLI, sonst der
eigene), eine Minute nach seinem Reset (`RESET_GRACE_MS`). `SessionRuntime.resume` sagt dem Renderer wann
und mit wem (`LimitBanner.vue` über der Eingabe, mit Countdown und „Nicht fortsetzen“); `atRest` behält es,
jeder Prompt beendet es. Vor dem Weitermachen prüft `SessionService.limitState`, dass seit dem Limit nichts
geschah. Sperren und wartende Chats stehen in `auto-switch.json` und überdauern einen Neustart; ein Chat,
den der Nutzer fortsetzen ließ und der gleich wieder am Limit steht, wartet erneut.

## Einstellungen der CLIs

Einstellungen › CLI-Konfiguration (`SettingsCliConfig.vue`, Teile in `components/cli-config/*`,
`stores/cli-config.ts`) zeigt und ändert MCP-Server, Berechtigungen und Hooks in den Dateien, die die CLI
selbst liest: sie gelten damit auch im Terminal. Ziel ist `CliConfigTarget` (`shared/cli-config.ts`): CLI,
Account (sein Konfigurationsordner), Ebene (`user`, `project`, `local`) und für die Ebenen eines Projekts
dessen Ordner. „Konnektoren verwalten“ im „+“ der Eingabe öffnet die Seite mit CLI, Account und Ordner des
Chats (`sessions:config-target`).

Oben Tabs: „Alle CLIs“ und eine je CLI (`cliConfig.page`); unter der Leiste einer CLI (Account, Ebene,
Projekt, Dateien) ein Tab je Bereich (`cliConfig.section`). Ein Anker aus der Schnellsuche holt seinen Tab
nach vorn (`follow` in `SettingsCliConfig.vue`, synchron, bevor der Dialog das Element sucht); eine Suche
zeigt alle Karten mit Treffern untereinander, ohne Tabs.

- Jede CLI hat einen Adapter (`AgentProvider.config`, `CliConfigAdapter`); eine CLI ohne Adapter fehlt
  in der Auswahl. Der Adapter sagt, welche Ebenen und Arten von Servern es gibt, welche Felder die
  Berechtigungen haben (`PermissionField`: Auswahl, Liste, Schalter) und welche Hook-Ereignisse; das
  Fenster zeichnet nur, was er liefert, und kennt keine CLI.
- **Nichts geht verloren**: Was Nexa nicht bearbeitet, bleibt. Ein Server behält seine übrigen Schlüssel
  (`other`, im Fenster angezeigt), ein Hook über `origin` (Gruppe und Platz in der Datei beim Lesen) seine
  (`statusMessage` & Co.), Hooks anderer Art (prompt, agent, http, mcp_tool) werden nur gezeigt und
  mitgenommen. JSON-Dateien liest `updateJsonFile` direkt vor dem Schreiben und schreibt sie atomar; eine,
  die kein gültiges JSON ist (Kommentare, die CLI schreibt gerade), fasst Nexa nicht an und zeigt die Ebene
  nur (`readOnly`). Hooks tragen die Version ihres Stands (`versionOf`); hat sich die Datei seitdem
  geändert, lehnt das Speichern ab.
- **Secrets** in Variablen und Headern (nach Name oder Form, `isSecretEntry`) verlassen Main nicht: Sie
  kommen leer mit `masked` ins Fenster und behalten beim Speichern ihren Wert aus der Datei, solange der
  Nutzer nichts einträgt (`entriesIn`). Verweise wie `${TOKEN}` sind keine Secrets.
- Nach jeder Änderung liest die Seite neu und `cli-config:changed` sagt es den anderen Fenstern. Claude
  leert danach seine Caches der MCP-Server und Befehle des Accounts, Codex lädt die MCP-Server neu
  (`config/mcpServer/reload`).
- **Globale MCP-Server** (`services/global-mcp.ts`, „Alle CLIs“): einer auf der Ebene Nutzer jedes
  Accounts jeder installierten CLI. Die Übersicht liest alle Accounts (`exportMcpServers`, mit Werten,
  nur in Main) und zeigt je Server und Account gleich, abweichend, fehlt, kennt die Art nicht oder nicht
  lesbar; ins Fenster gehen die Werte maskiert. Ändert der Nutzer einen globalen Server im Tab einer CLI,
  trägt `CliConfigService.saveMcp` die Fassung in alle anderen Accounts; Entfernen dort entfernt ihn
  überall. Neue Accounts bekommen alle globalen (`accounts` `changed`). Was ein Account nicht annimmt,
  steht in `McpSyncResult.failed`, das Fenster nennt es; die anderen Accounts bekommen die Änderung trotzdem.
  Änderungen laufen nacheinander (`serial`), denn jede liest und schreibt die Dateien mehrerer Accounts.
- Dateien, Befehle und Eigenheiten je CLI: PROTOCOLS.md, „Einstellungen der CLIs“.

## MCP Apps

Ein MCP-Werkzeug kann eine eigene Oberfläche mitbringen (`_meta.ui.resourceUri`, eine `ui://`-Ressource
mit HTML). Nexa zeigt sie im Chat unter der Zeile des Werkzeugs (Protokolle in `PROTOCOLS.md`, „MCP Apps“).

- **Welche Werkzeuge**: Der Provider setzt `ToolItem.app` (`server`, `tool`, `resourceUri`) und
  `appResult` (das Ergebnis, wie der Server es gab). Codex nennt die Seite am Item (`mcpAppUi`), bei
  Claude Code fragt der Run nach `mcp_status` (`attachApp`, ein Ergebnis, das vorher kam, wartet).
  `chatBlocks` stellt ein solches Werkzeug allein, `MessageList` zeigt `McpAppBlock`.
- **Seite**: `McpAppBlock` fragt `mcpApps.open`, sobald es in den Blick kommt. Main liest die Ressource
  über die CLI des Chats (`SessionService.readMcpAppResource`: der laufende Run, sonst ein Prozess nur
  dafür, `AgentProvider.readMcpResource`) und gibt eine Adresse `nexa-app://<token>/` zurück
  (`McpAppViews`, die zuletzt gezeigten bis 24 MB). Das Schema liefert die Seite mit der CSP aus ihrem
  `_meta.ui.csp` (`mcpAppCsp`: eigene Skripte und Styles, von außen nur die genannten Domains, sonst
  keine Verbindungen); die CSP des Renderers erlaubt Frames nur von `nexa-app:`.
- **Frame**: `sandbox="allow-scripts allow-forms"` ohne `allow-same-origin`: Die Seite hat keinen Origin,
  keinen Speicher, keinen Zugriff auf Nexa, und die Rechte der App-Session gelten für Frames nicht
  (nur Schreiben in die Zwischenablage, `appMay` in `window/main-window.ts`). Nachrichten nimmt
  `McpAppBlock` nur von seinem Frame (`event.source`) und schickt sie als JSON-Kopie.
- **Host** (`lib/mcp-app-host.ts`, ohne DOM getestet): beantwortet `ui/initialize` mit Theme,
  Style-Variablen aus den Farben des Themes, Sprache und Zeitzone, schickt nach `initialized` die Eingabe
  und das Ergebnis (bzw. `tool-cancelled`), Theme- und Breitenwechsel als `host-context-changed`.
  `tools/call` geht über `SessionService.callMcpAppTool`, das nur Werkzeuge desselben Servers mit `app` in
  ihrer `visibility` zulässt; `resources/read` über dieselbe CLI; `ui/open-link` nur http(s) im
  Standardbrowser; `ui/message` landet im Composer, abgeschickt wird es vom Nutzer. Anzeige nur
  `inline`, `ui/update-model-context` kennt Nexa nicht (die CLIs nehmen zwischen den Turns keinen
  Kontext an).
- **Andere Geräte**: Im Chat eines anderen Geräts holt main die Seite von dort (`mcp-apps:open-remote` →
  `mcp-apps:page`, mit dem Ergebnis des Werkzeugs, das der Verlauf von dort nicht mitbringt), prüft sie wie
  eine eigene und stellt sie unter einer eigenen Adresse bereit (`McpAppViews.openRemote`). `tools/call`
  und `resources/read` der Seite gehen an das Gerät (`apiOf(device).mcpApps`), `tools/call` nur mit Stufe
  „Alles“.

## Chats in eigenen Fenstern

Ein Chat lässt sich aus dem Hauptfenster lösen (Symbol im Chat-Kopf neben Terminal und Neustart, Menü
„Mehr“, Kontextmenü der Seitenleiste, Schnellsuche). Er zeigt sich dann in einem eigenen Nexa-Fenster,
nur er, ohne Seitenleiste, Startseite und Schnellsuche.

- **Fenster**: dieselbe Seite wie das Hauptfenster, geladen mit `?chat=<id>` (`shared/chat-windows.ts`,
  `chatWindowSession`). Der Renderer liest das einmal (`lib/chat-window.ts`: `ownChat`, `isChatWindow`)
  und lässt weg, was nur das Hauptfenster hat. Main baut es mit `createChatWindow` (kleinere
  Mindestgröße, Material, Zoom und Härtung der `<webview>`s wie beim Hauptfenster) und richtet es mit
  `setUpWindow` in `index.ts` ein wie jedes Fenster der App.
- **Übergabe** (`ChatHandoff`: Entwurf, Terminal und Browser offen oder nicht): beim Lösen schickt das
  Hauptfenster sie mit `chat-windows:open`, Main hält sie, bis das neue Fenster sie holt
  (`takeHandoff`, nur das Fenster des Chats). Das Hauptfenster leert vorher Entwurf und Terminal-Panel des
  Chats und zeigt die Startseite, damit nichts doppelt steht. Zurück geht es mit „Zurück ins
  Hauptfenster“ (`dock`, das Hauptfenster zeigt den Chat) oder mit dem Schließen des Fensters.
- **Schließen**: Main verhindert `close`, fragt das Fenster (`event:chat-window-closing`), und es
  antwortet mit seiner Übergabe (`chat-windows:closing`). Antwortet es nicht binnen
  `CLOSING_WAIT_MS` (1,5 s), oder lädt die Seite noch bzw. ist abgestürzt, schließt es ohne. Nach
  `closed` meldet `ChatWindows` erst `changed` (das Hauptfenster weiß, dass der Chat wieder ihm gehört),
  dann `returned` mit der Übergabe. Eine Übergabe, die das Fenster nie geholt hat, geht zurück, wie sie kam.
  Schließt sich das Fenster selbst (Chat beendet oder gelöscht, `chatWindows.closeOwn()`), schickt es
  seine Übergabe ebenso über `chat-windows:closing`: `window.close()` in der Seite übergeht in Electron
  das `close` des Fensters und damit die Frage, der Entwurf wäre weg.
- **Beenden und Neustart**: Beim Beenden (auch für ein Update) schließen die Fenster ohne Frage und
  bleiben in `chat-windows.json` (`open`); beim nächsten Start öffnen sie wieder, sobald das Hauptfenster
  sichtbar ist (mit Infobereich erst, wenn es sich zeigt). Die Lage merkt sich Nexa je Chat (`bounds`,
  höchstens 100), gelöschte Chats fallen heraus (`keepSessions`).
- **Wer zeigt was**: `show` in `index.ts` (Meldungen, `nx`, lokale API) bringt das Fenster eines Chats nach
  vorn, sonst das Hauptfenster. Im Renderer prüfen `sessions.open` und `useChatActions().open` zuerst
  `chatWindows.elsewhere(id)`: ein Chat in eigenem Fenster holt dieses nach vorn; aus dem Fenster eines
  Chats geht jeder andere Chat ans Hauptfenster. `BrowserLayer` legt nur die Seiten der Chats an, die das
  eigene Fenster zeigt, ein Tab hat also nie zwei `<webview>`s.
- **Anfragen ans Hauptfenster** (`MainWindowRequest` über `chat-windows:to-main`): einen anderen Chat
  öffnen, neuer Chat, Löschen (damit „Rückgängig“ bleibt, auch wenn das Fenster dann schließt) und die
  Schnellsuche. Löschen schließt die Fenster der Chats ohne Frage (`chat-windows:close`).
- **Was alle Fenster teilen**: Main sendet Ereignisse an alle Fenster der App (`broadcast`). Die Listen
  überwachter Ordner und Git-Ordner schickt jedes Fenster ganz; `lib/per-window.ts` hält sie je Fenster,
  sonst nähme ein Fenster dem anderen seine. Meldungen merken sich je Fenster, welchen Chat es zeigt
  (`NotificationService.setViewing(windowId, …)`); keine Meldung, wenn das Fenster vorn den Chat zeigt,
  und blinken darf das Fenster des Chats, sonst das Hauptfenster. Schließt das Hauptfenster ohne
  Infobereich, beendet sich Nexa samt den Fenstern der Chats.

## Geplante Aufgaben

Eine Aufgabe schickt nach Zeitplan einen Prompt an eine CLI, jeder Lauf ist ein Chat im gewählten Projekt
(Idee aus Claude Desktop, mit CLI und Account je Aufgabe).

- **Modell** (`shared/scheduled-tasks.ts`): Name, Anweisungen, CLI, Account (leer: der Standard-Account
  der CLI beim Lauf), Modell und Denkaufwand (leer: Vorgabe), Freigaben, Projekt, Zeitplan, `reuseChat`
  (jeder Lauf im Chat des letzten statt in einem neuen), `catchUp` und die letzten 20 Läufe (`TaskRun`:
  Zeit, Auslöser `schedule`/`manual`/`catch-up`, Ergebnis `started`/`skipped`/`missed`/`error`, Chat).
  Zeitpläne: von Hand, stündlich (alle 1–12 Stunden zu einer Minute), täglich, wochentags, an Wochentagen,
  monatlich (Tag 29–31 in kürzeren Monaten am letzten) und einmalig. `nextRunAfter` rechnet in lokaler
  Zeit über den `Date`-Konstruktor, Sommer- und Winterzeit verschieben also nichts; `parseTaskInput`
  prüft, was aus dem Fenster kommt (deutsche Fehlertexte).
- **Ablauf** (`main/scheduled/scheduled-tasks.ts`): startet nach der Erkennung der CLIs und schläft bis
  zum nächsten Lauf, höchstens 60 s am Stück (Uhr verstellt, Ruhezustand). Fällige Aufgaben rücken erst
  ihren nächsten Lauf vor, dann laufen sie; einmalige schalten sich danach aus. Ein Lauf, der mehr als
  5 Minuten zu spät käme (Nexa zu, Computer schlief), läuft mit `catchUp` einmal nach, egal wie viele
  ausfielen, sonst steht er als verpasst in der Liste. Arbeitet der Chat des letzten Laufs noch, wird
  übersprungen. Ein Lauf ist `SessionService.create` mit `scheduledTask: { id, name }`, Titel
  „Name · 25.11. 7:05“ und `send` mit den Anweisungen; „Jetzt ausführen“ (`runNow`) gibt den Lauf zurück.
  `scheduledTask` setzt nur Main (`sessions:create` aus dem Fenster verwirft es), ein abgezweigter Chat
  erbt es nicht.
- **Chats der Läufe**: Symbol in der Seitenleiste, eine Meldung „fertig“ auch unter der Mindestdauer, und
  im Systemprompt der Hinweis, dass niemand zusieht und `notify` der Weg zum Nutzer ist (`instructions.ts`).
  Freigaben, die fragen, halten den Lauf an, bis jemand antwortet; der Dialog nimmt deshalb `auto`, wo die
  CLI es kann, und sagt, was jede Stufe für einen unbeaufsichtigten Lauf heißt (`lib/scheduled.ts`).
- Aufgaben laufen nur, solange Nexa läuft; mit „Im Infobereich weiterlaufen“ auch bei geschlossenem
  Fenster. Seite und Dialog weisen darauf hin.

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
  (Groß-/Kleinschreibung und Akzente egal) liegt in `shared/search.ts`, für Main und Renderer. Die Chats
  der anderen Geräte aus der Seitenleiste stehen mit Bildschirm-Symbol und Gerätenamen dabei (auch der
  Name findet sie) und öffnen sich wie dort; ihre Verläufe durchsucht jedes Gerät selbst
  (`apiOf(…).sessions.search`, nur online), ein Gerät, das nicht antwortet, kostet nur seine Treffer.
  Projekte eines anderen Geräts für einen neuen Chat nur mit Stufe „Prompts senden“ (`lib/device-chats.ts`).
- `stores/accounts.ts`: Accounts, laufende Logins, Vorgabe je CLI, Account eines Chats (`sessionAccount`).
- **Artefakte** (`views/ArtifactsView.vue`, `ui.view = 'artifacts'`, Eintrag unter „Neuer Chat“): Claudes
  Artefakte des gewählten Accounts als Karten mit Vorschaubild, Suche und Filtern (`lib/artifacts.ts`).
  `stores/artifacts.ts` hält Listen und Bilder, solange die App läuft, und fragt
  `SessionService.artifactChats` nach dem Chat jedes Artefakts (liest jeden gespeicherten Chat einmal, bis
  er sich ändert). Ein Klick öffnet den Chat und das Artefakt in dessen Browser-Panel (ein Tab, der es
  schon zeigt, wird wiederverwendet), ohne Chat im Standardbrowser. Das Menü einer Karte benennt eigene
  Artefakte um, löscht sie (mit Rückfrage) und pinnt sie auf claude.ai an, wenn die Liste Pins kennt
  (`pinsEnabled`); Anpinnen zeigt der Store sofort und nimmt es zurück, wenn claude.ai ablehnt.
- **Geplant** (`views/ScheduledView.vue`, `ui.view = 'scheduled'`, Eintrag unter „Artefakte“ mit der Zahl
  der Aufgaben, die von selbst laufen): die Aufgaben mit nächstem und letztem Lauf, Schalter, „Jetzt
  ausführen“ und Menü, darunter Vorlagen (`components/scheduled/task-templates.ts`). Der Dialog
  (`ScheduledTaskDialog`, `scheduled.dialog`) hat unter den Anweisungen CLI, Account, Freigaben und Modell
  wie der Composer, dazu Projekt, Zeitplan mit Vorschau des nächsten Laufs, erweiterte Einstellungen und
  die letzten Läufe. `stores/scheduled.ts` hält die Liste aktuell (`event:scheduled-changed`).
- **Andere Geräte** (Remote Control, nur mit gekoppeltem Server): In der Seitenleiste stehen unter den
  eigenen Projekten die bestätigten anderen Geräte (`SidebarDevice`), jedes mit seinen Projekten und Chats
  in derselben `SidebarTree` wie dieses, mit Anheften, Umbenennen, Verschieben und Ordnen. Ihr Chat und
  ihre Startseite sind `ChatView` und `HomeView` selbst, das Dock mit CLI, Modell, Konto, Effort und Modus
  aus dem, was auf dem Gerät da ist. Möglich machen das Stores je Gerät: `scopedStore` in
  `stores/device.ts` legt Settings, Providers, Accounts, Projects und Sessions für jedes Gerät einmal an
  (Id `name@<Instanz>`), auf der Fenster-API dieses Geräts (`apiOf`: `window.api`, oder für ein anderes
  dieselben Namespaces aus `shared/window-api.ts` über `remote.invoke` und die weitergereichten Ereignisse).
  Welches Gerät eine Komponente zeigt, sagt das nächste `DeviceScope` über ihr (`provideDevice`,
  `useDevice`); ohne eins ist es dieses. Stores reichen ihr Gerät ausdrücklich weiter, rein lokale rufen
  die Stores mit `null` auf. Was auf Dateien, Fenster, Terminals, Browser oder Dialoge dieses Geräts geht
  (Startbefehle, Terminal, eigenes Fenster, „Ordner öffnen“, Markdown-Export), bieten die Komponenten bei
  einem anderen Gerät nicht an. `stores/devices.ts` lädt ein Gerät, sobald es online ist
  und dieses lässt (`hello`), meldet die offenen Chats als Beobachtung (`remote.watch`) und liest neu, wenn
  das Gerät den Faden verlor (`onResync`). Von einem Gerät bleiben höchstens 4 Chats geladen. Bilder in
  Prompts eines anderen Geräts lädt das Fenster über `nexa-file://device?…` (`fileImageUrl` mit
  `ImageSource`); main holt sie dort mit `sessions:image`, das nur Bilder aus Prompts dieses Chats
  herausgibt (`SessionService.promptImage`).
  `useShownDeviceStore` merkt sich, wessen Chat oder Startseite der Hauptbereich zeigt; ein Chat eines
  Geräts schließt den offenen der anderen. Welche Geräte gerade die Chats dieses Geräts offen haben,
  steht unter Einstellungen › Geräte › Fernsteuerung, mit „Trennen“ (Stufe „Aus“). Ein Gerät lässt sich
  hier ausblenden (Kontextmenü in der Seitenleiste, Schalter neben „…“ unter Einstellungen › Geräte; `ui.hiddenDevices`,
  `nexa.hiddenDevices` im `localStorage`): Es fehlt dann in der Seitenleiste und unter „Angeheftet“ und
  wird weder geladen noch beobachtet, wie ein entferntes. Wieder eingeblendet liest es alles neu.
  Strg+Tab und Strg+1–9 zählen die Chats der Geräte mit, wie die Seitenleiste sie zeigt („Angeheftet“
  aller Geräte, dann dieses, dann jedes andere; `data-chat-key`), ist sie ausgeblendet, dieses Gerät vor
  den anderen. Strg+Umschalt+T legt den neuen Chat auf dem Gerät des offenen an, auf einem anderen nur
  mit Stufe „Prompts senden“, sonst ein Hinweis. `useChatActions(device)` und `useSessionsStore(device)`
  bedienen dafür ein Gerät auch ohne `DeviceScope`.
- **Dateien eines anderen Geräts** (Dateibaum, „Alle Änderungen“, Änderungen einer Datei, Branch in der
  Titelleiste): Im Chat eines anderen Geräts arbeiten sie auf dessen Ordnern, ab Stufe „Lesen“. Die
  Stores `file-tree` und `git` sind je Gerät (`scopedStore`), die Komponenten nehmen `useDeviceApi()`;
  über die Leitung gehen die Kanäle `files:*` und `git:branch`/`web-url`/`main-worktree`/`watch` sowie die
  Ereignisse `event:files-changed`, `event:files-touched` und `event:git-branch-changed`. Lesen, Suchen, Diffs und das
  Überwachen brauchen „Lesen“; Anlegen, Umbenennen, Papierkorb, Vormerken und Verwerfen „Voll“, darunter
  bietet die Oberfläche sie nicht an; „Im Chat erwähnen“ braucht „Prompts senden“. Öffnen mit dem
  Standardprogramm, im Explorer zeigen und Herausziehen bleiben eigenen Chats vorbehalten. Trenner und
  Namensregeln folgen dem System des Geräts, am Pfad erkannt (`separatorOf`, `/` vorne: POSIX). Auf dem
  gesteuerten Gerät prüft `files-ipc.ts` jeden Pfad eines anderen Geräts (`remoteCaller`): Er muss in
  einem Ordner seiner Chats liegen (Projektordner, Arbeitsordner, Worktree und zusätzliche Ordner der
  Chats, `chatFolders`/`inFolders` in `files/remote-roots.ts`), relative Pfade und `..` führen nicht
  hinaus. Was ein Gerät überwacht, führt main getrennt von den eigenen Fenstern als eigenen Absender
  (`remoteSender` in `lib/per-window.ts`) und nur, solange es beobachtet; endet die Beobachtung
  (abgelaufen, offline, Stufe gesenkt, Neustart mit `fresh`), lässt `RemoteHost` mit `dropped` los
  (`endRemoteSender`), und das Gerät meldet seine Ordner nach `onResync` neu. Ereignisse bekommt nur,
  wer den Ordner überwacht oder den Chat offen hat; Änderungen eines Ordners warten gebündelt
  (`remote/remote-files.ts`).
- **Abgleich mit anderen Geräten** (Einstellungen › Geräte, `settings.remote.sync`, Gruppen und Stufen in
  `shared/remote-sync.ts`): je Punkt, ob dieses und ein gesteuertes Gerät dasselbe zeigen (Auf- und
  Zuklappen, Reihenfolge, Anheften, Archiv, Namen, Vorgaben der Startseite, Anzeige im Chat). Was nicht
  geteilt wird oder das Gerät nicht erlaubt, hält `stores/kept-here.ts` je Gerät im `localStorage`; die
  Stores des Geräts zeigen ihre Listen und Einstellungen durch ihn (`projectsView`, `chatView`,
  `settingsView`) und schicken nur den Rest. Ein umgeschalteter Punkt vergisst, was dazu hier lag. Theme
  und Schriften kommen bei einem anderen Gerät immer von diesem.
- **Benachrichtigungen der Agents** (`composables/useAgentNotifications.ts`, in jedem Fenster): Toasts zu
  `notify` mit Chat, Text und Knöpfen (`AgentNotificationBody` als Beschreibung des Sonner-Toasts, dessen
  eigener Platz nur einen Knopf fasst). Ein Knopf oder das Schließen antwortet Main genau einmal;
  `onAgentDone` nimmt den Toast weg, wenn die Antwort anderswo kam.
- Themes: eingebaute in `shared/themes/builtin.ts`, eigene als JSON-Dateien im Ordner `themes` der
  App-Daten (Format des Claude Managers, `ThemeService` überwacht den Ordner). `themes/apply.ts` setzt
  die Tokens, `themes/color-info.ts` beschreibt jede Farbe für den Editor.
- **Schriften** (Einstellungen › Darstellung › Schrift, `appearance.uiFont`, `codeFont`, `ligatures`, wie
  im Terminal des Claude Managers): `themes/apply.ts` setzt sie mit den Tokens als `--ui-font` und
  `--code-font` (die gewählte Schrift, dahinter die von Nexa; leer nur die von Nexa, `lib/fonts.ts`) und
  `--code-font-features` (Ligaturen über `calt`/`liga`). Tailwinds `font-sans`/`font-mono` lesen sie über
  `@theme inline` in `main.css`, Markdown-Code und Diffs (`useDiffStyle`) direkt, Mermaid bekommt die
  Schrift beim Zeichnen. Schriften für Code halten eine Ligatur so breit wie ihre Zeichen, die Spalten der
  Diffs bleiben also stehen. Die Auswahl (`FontPicker`) listet die installierten Schriften aus Main.
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
  ändert, solange sie laufen. Die Aktivität ist, was gerade geschieht: Jede Art läuft ab, so lange wie
  unter Einstellungen › Allgemein › Aktivität im Dateibaum eingestellt (`general.activitySeconds`, Auswahl
  `ACTIVITY_CHOICES`; Vorgabe Lesen und Suchen 1 Minute, Commit 2, Schreiben 5; der Timer-Knopf in den
  Filtern öffnet die Karte). Der Store räumt sie höchstens sekündlich weg, kürzer eingestellt sofort. Die Filter (Änderungen, Aktivität) zeigen nur, wenn etwas da ist;
  sonst steht der ganze Baum da. Gefiltert kommt, was neu ist, aus dem Hintergrund nach vorn (wächst
  und wird scharf), und was geht, sinkt zurück (wird kleiner und verblasst), jeweils an seinem Platz statt
  seitlich (`file-tree-enter`/`-leave` in `main.css`, skaliert wird `.file-tree-pill` um den Anfang des
  Namens; Zeilen behalten ihren Platz, bis sie ausgeblendet sind).
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
- **Shells** (`ShellDock`, `ShellDetail`, `lib/shells.ts`): laufende Befehle aus den `tool`-Items
  (`ToolItem.shell` hält Task-ID und Zustand des Prozesses). Die Ausgabe holt `sessions.shellOutput` von
  der CLI (Claude: aus der Ausgabedatei der Shell, sonst `get_task_output`; siehe PROTOCOLS.md,
  „Ausgabedateien und Kodierung“), `sessions.stopShell` beendet sie (`stop_task`). Solange eine im
  Hintergrund läuft, steht `ShellDock` (`dockShells()`) über dem Eingabefeld, neben dem `AgentDock`, eine
  Zeile je Shell untereinander. Ein Klick klappt eine Zeile nach unten auf (`ShellDetail`: ganzer Befehl,
  Zustand, Ausgabe in `ShellOutput`, Beenden), immer nur eine (`ui.shellId`); der Dock wird dann so breit
  wie das Eingabefeld. Eine Shell, die vom Befehl im Chat, als Startbefehl aus dem Kopf oder mit `/tasks`
  geöffnet wird, kommt aufgeklappt als Zeile dazu (`dockRows()`). Eine offene Shell, die endet, bleibt
  offen; ein zweiter Klick oder Esc klappt sie zu.
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
  Start). Antigravity CLI kann einen Server nicht für einen Lauf weglassen: Sein Provider listet die
  Server aus den Dateien und schaltet sie dort (`AgentProvider.setMcpEnabled`, `McpServerInfo.switchIn`),
  laufende Chats mit dem Account starten neu. Ein fehlgeschlagener Server lässt sich dort neu verbinden, ein abgemeldeter anmelden
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
  Releases mit den PR-Beschreibungen als „Details“. Die Seite fragt GitHub beim Öffnen nichts: Sie zeigt, was
  die letzte Suche brachte (`UpdatesApi.releases`, Änderungen über `onReleases`), zuerst 10 Versionen, am
  unteren Ende (`IntersectionObserver`) je 10 weitere, erst bereits geladene, dann ältere Seiten von GitHub
  (`moreReleases`). Ein Punkt am Einstellungen-Knopf der Sidebar zeigt ein
  wartendes Update oder ungelesene Neuerungen nach einem Update, aber nur für eines, das die automatische
  Suche fand: Fand der Nutzer es selbst („Nach Updates suchen“, `UpdateState.foundByUser`), weiß er davon.
  Das gilt auch nach dem Neustart, der es installiert (`nexa.quietVersion` im `localStorage`).

## Einstellungen übertragen

Einstellungen › Allgemein › „Einstellungen übertragen“ und die Befehlsliste („Einstellungen exportieren…“,
„… importieren…“, `useSettingsTransfer`) nehmen die Einstellungen mit auf einen anderen Computer, wie im
Claude Manager. Die Logik ohne Electron steht in `shared/settings-transfer.ts`, das Lesen der Datei und die
Prüfungen gegen diesen Computer in `services/settings-transfer.ts`.

- **Datei**: JSON mit `format: "nexa-settings"`, `version` (1; eine neuere lehnt der Import mit „Bitte
  zuerst aktualisieren“ ab), `appVersion`, `platform`, `exportedAt`, `settings` (alle Einstellungen außer
  denen dieser Installation, `LOCAL_SETTINGS`: `setup.done` und der Ordner für neue Projekte, der keine Zeile
  in den Einstellungen hat) und `themes` (die eigenen Themes als `{ id, theme }`, `theme` im Format der
  Theme-Dateien). Accounts, Logins und Schlüssel stehen nicht darin; die Einstellungen nennen Accounts nur
  über ihre ID. Ein `settings.json` aus dem Datenordner liest der Import auch.
- **Prüfen** (`validSettings`): Nur bekannte Einstellungen mit dem Typ ihres Standardwerts; Auswahlen nur
  mit Werten, die die Einstellungen anbieten (Material, Breite, Zoomstufe, CLI, Freigaben, Shell, Sprache …),
  Zahlen nur im Bereich ihres Schiebereglers (`SETTING_RANGES` in `shared/defaults.ts`, den auch die Regler
  nehmen), Text mit Höchstlänge. Unbekannte Schlüssel (einer neueren Nexa) fallen still weg, falsche Werte
  stehen unter „ungültig“. Die Einstellungen jeder CLI prüft es über `PROVIDER_IDS`, eine neue CLI kommt
  so ohne Sonderfall mit.
- **Was hier fehlt** (`missingHere`), nur wenn sich die Einstellung ändern würde: der Pfad zur CLI, Accounts
  (Vorgabe je CLI, Account der Spracheingabe), Schriften, von denen keine installiert ist (CSS-Familien wie
  `monospace` zählen als da; konnte Nexa die Liste nicht lesen, keine), Git Bash. Ein eigenes Theme der
  Datei, das es hier mit demselben Namen gibt (wie beim Theme-Import), nimmt dessen ID; eines, das fehlt,
  bietet die Vorschau zum Hinzufügen an. Das Mikrofon kann nur das Fenster prüfen
  (`withoutMissingMicrophone`).
- **Vorschau** (`SettingsImportPreview`, `SettingsImportDialog` über `ui.settingsImport`): jede Änderung mit
  altem und neuem Wert, benannt und gruppiert wie in den Einstellungen (`lib/setting-changes.ts`: die Zeile
  im Einstellungsindex, für die CLIs mit ihrem Namen; ein Test prüft, dass jede Einstellung einen Platz hat),
  dazu die Themes, die dazukommen, und was nicht übernommen wird und warum. Ausgewählt ist alles außer dem,
  was bestimmt, was startet oder was die Agents ohne Nachfrage dürfen (`sensitive`: Pfad und Argumente
  einer CLI, Nachricht zum Weitermachen, mehr Freigaben für neue Chats, Nachrichten zwischen Chats, lokale
  API an).
- **Übernehmen**: erst die gewählten Themes (und das, welches die Theme-Einstellung wählt) über
  `themes.create`, dann ein gewöhnliches Update mit den gewählten Änderungen (`settingsPatch`).
  `consistentChanges` hält eine CLI an und die Vorgabe für neue Chats bei einer, die an ist. „Rückgängig“
  im Toast setzt die alten Werte und legt die hinzugefügten Themes in den Papierkorb.

## Befehl `nx`

`nx.exe` (`src/launcher/nx.cs`, ein GUI-Programm, damit der Explorer kein Konsolenfenster zeigt) gibt nur
den Ordner des Aufrufs und seine Argumente als einen Base64-Schalter `--nx=` an `Nexa.exe` weiter; läuft
Nexa schon, kommt die Anfrage über `requestSingleInstanceLock` als `additionalData` bei der laufenden Instanz
an (`second-instance`, geprüft mit `isLaunchRequest`). Was sie bedeutet, entscheidet `launch.ts` ohne
Seiteneffekte: `parseLaunchArgs` liest die Argumente (wie `cm` im Claude Manager: `-a`, `-c`, `-r [id]`,
`-n`, `-m`, `--claude`/`--codex`/`--antigravity` (kurz `--agy`), `--` für die CLI) und lehnt Widersprüche ab, `resolveLaunch` macht daraus
mit Einstellungen, Accounts, Projekten, Chats und `SessionService.running()` einen Plan: einen Chat öffnen,
einen neuen anlegen, eine Unterhaltung der CLIs übernehmen (`CliSessionImport.takeOver`: Transkript per
`findTranscript` in den Claude-Ordnern bzw. Thread aus `thread/list` der Codex-Accounts, eingeordnet wie beim
Import) oder die Schnellsuche mit den Chats des Ordners zeigen (`event:find-sessions`). `index.ts` führt den
Plan aus; Fehler erscheinen als Dialog „„nx“ konnte keinen Chat öffnen“.

- **Offener Chat** (`general.nxReuseChat`): ein Chat im Ordner (`cwd`, sonst der des Projekts), dessen CLI
  verbunden ist oder arbeitet, oder der noch leer ist (kein Prompt, keine Unterhaltung einer CLI). `-a`,
  `--claude`, `--codex`, `--antigravity` grenzen ihn und den Chat von `-c` ein; ein Chat ohne eigenen Account zählt mit dem
  Standard-Account seiner CLI.
- **Account** (`findAccount`): ID, Name, E-Mail, sonst ein eindeutiger Teil des Namens, unter den sichtbaren
  Accounts der eingeschalteten CLIs (oder der genannten); passen Accounts beider CLIs, gewinnt die
  Standard-CLI. Ohne `--claude`/`--codex`/`--antigravity` bestimmt der Account die CLI des neuen Chats.
- **Argumente für die CLI** stehen in `SessionMeta.cliArgs` je CLI und kommen bei jedem Start hinter die des
  Accounts (`RunOptions.extraArgs`). Claude Code nimmt sie unverändert. Der App-Server von Codex gehört allen
  Chats eines Accounts; `codexOverrides` macht aus `-c schlüssel=wert` die `config` des Threads (Nexas
  MCP-Server geht vor), andere Argumente lehnt `resolveLaunch` für Codex ab. Antigravity CLI startet je Chat
  einen Prozess und nimmt sie hinter `acp` (und `--gemini-dir`).
- **An- und abmelden**: `CommandIntegration` (`command-integration.ts`, Kanäle `command:*`) ruft
  `nx.exe --nx-status`, `--nx-register` und `--nx-unregister`; nx.exe schreibt selbst Benutzer-PATH und App
  Path. Gehört der App Path einem anderen Programm, nennt der Status es als Hinweis (`reg query`). Nur in der
  installierten App unter Windows; ein Entwicklungs-Build meldet sich nie an. Die Einstellungen zeigen es unter
  Allgemein › Befehl „nx“ (`SettingsCommand.vue`).

## Releases

semantic-release (`release.config.mjs`, `.github/workflows/release.yml`) bestimmt bei jedem Push auf `main`
die Version aus den Conventional Commits; Windows- und Linux-Runner bauen mit `electron-builder.yml`
Installer, AppImage, deb und rpm, dann erscheint alles als GitHub-Release. `shared/release-notes.ts` macht
aus den Zeilen unter `## Versionshinweise` einer PR-Beschreibung je einen Punkt der Versionshinweise (in
Node für `release.config.mjs`, daher nur Typen, die sich wegstreichen lassen). `build/installer.nsh`
registriert `nx` beim Installieren.
