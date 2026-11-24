# Roadmap

## Erledigt

- [x] Grundgerüst, Fenster, Themes (aus dem Claude Manager)
- [x] Provider-System mit Claude Code und Codex
- [x] Erkennung installierter CLIs mit Version und Anmeldung
- [x] Chat mit Markdown, Werkzeugzeilen, Diffs, Thinking, Todos, Turn-Fußzeile
- [x] Rückfragen im UI (Freigaben, Fragen, Plan, MCP-Formulare)
- [x] Agents mit Status und Seitenpanel
- [x] Wechsel zwischen Claude und Codex mit Kontextübergabe
- [x] Projekte und Sessions in der Sidebar
- [x] Nexa-MCP-Server mit Render-Werkzeugen und Systemprompt
- [x] Usage in der Titelleiste, Verbrauch in den Einstellungen
- [x] Lokale API mit SSE, `nx`-Befehl
- [x] Layout wie im Claude Manager (Rahmen und Inhalts-Panel)
- [x] Accounts und Profile: mehrere Konten je CLI (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), Verwaltung in den
      Einstellungen, Vorgabe je CLI, Wechsel im laufenden Chat mit Übernahme der Unterhaltung
- [x] Login im UI: `claude auth login` / `codex login` mit Link, Code-Eingabe und Status
- [x] Claude-Usage ohne laufende Session über die OAuth-Usage-Schnittstelle, Limits je Account
- [x] Dateien und Aktivität wie im Claude Manager: Dateibaum mit Git, angefasste Dateien, Diffs und
      Review-Kommentare als Panel neben dem Chat
- [x] Eigener Browser aus dem Claude Manager als Panel rechts neben dem Chat, mit allen Browser-Werkzeugen
      im Nexa-MCP-Server (Claude und Codex) und im Systemprompt
- [x] Browser im Chat: was der Agent im Browser tut, als Karte mit Live-Bild der Seite (nur zum Zusehen);
      zum Bedienen in der Seitenleiste oder im Vollbild, die Karte pausiert solange
- [x] Agents und Shells im Hintergrund über dem Eingabefeld, Übersicht der Shells (laufend, Ausgabe, Beenden) neben dem Chat
- [x] Releases wie im Claude Manager: semantic-release auf `main`, Installer für Windows (mit `nx` im PATH),
      AppImage/deb/rpm für Linux, Auto-Update mit Versionshinweisen in den Einstellungen
- [x] Übernahme aus dem Claude Manager (Workspaces, Accounts, Sessions) bei der Einrichtung und in den Einstellungen
- [x] Übernahme aus dem Claude Manager vollständig und nachholbar: auch Workspace-Prompts (`cm_prompts.md` →
      `prompts.md`), eigene Themes sowie Namen und Pins schon übernommener Chats; erneut gelesen bietet sie
      einzeln an, was Nexa noch fehlt
- [x] Claude Manager deinstalliert: Seine Hinweise verschwinden; der Import bleibt, solange seine Daten da sind
- [x] Unterordner in Projekten: Chats arbeiten in einem Ordner des Projekts, die Sidebar zeigt ihn als Ebene
- [x] Tabellen mit Abständen, festem Kopf und Sortierung per Klick auf die Spalte
- [x] Standard-Account einer CLI ausgeblendet, sobald ein eigener Account da ist
- [x] Trenner in der Sidebar (wie die Workspaces im Claude Manager): eigene anlegen, Projekte und Trenner per
      Drag & Drop ordnen, ein Projekt zum Trenner machen
- [x] Schnellsuche und Befehlsliste in der Titelleiste wie im Claude Manager (Strg+Umschalt+A / Strg+Umschalt+P):
      Chats auch im Verlauf durchsuchen, Projekte, Befehle, Einstellungen; ersetzt die Suche der Sidebar
- [x] Projektwahl auf der Startseite mit Suche und kurzen Pfaden (`~` für den Benutzerordner)
- [x] Eigene Auswahlfelder statt nativer `<select>` (Einstellungen, Plan-Modus, MCP-Formulare)
- [x] Änderungen an Dateien wie in den CLIs aufgeklappt, auch in zusammengefalteten Werkzeugfolgen
- [x] Chats in andere Projekte und Ordner verschieben, per Kontextmenü oder Drag & Drop (wie im Claude
      Manager); die CLI setzt die Unterhaltung im neuen Ordner fort
- [x] Nexas eigene Werkzeuge (`mcp__nexa__*`) im Chat als Teil der App statt als fremder MCP-Server;
      keine Kosten in Dollar mehr (Turn-Fuß, Verbrauch)
- [x] Dateiansicht über den ganzen Chat ohne Eingabefeld, „Schließen“ gut sichtbar und mit Esc; die Datei
      ist im Baum nach dem Schließen nicht mehr ausgewählt
- [x] Lange Chats öffnen schnell: ältere Nachrichten kommen erst beim Hochscrollen
- [x] Vervollständigung in der Eingabe: Befehle, Skills und MCP-Prompts der CLIs (`/`, bei Codex auch `$`),
      Dateien und Ordner des Projekts (`@`)
- [x] Modell, Denkaufwand (Schieberegler wie in der CLI), Ultracode und Freigaben hinter einem Zahnrad
- [x] Derselbe Login nur einmal: die Übernahme aus dem Claude Manager legt ihn nicht doppelt an, doppelte
      Accounts lassen sich in den Einstellungen zusammenführen
- [x] Zusammenfassen des Kontexts sichtbar: „Kontext wird zusammengefasst …“ mit Zeit, danach ein Trenner
      im Chat mit den Tokens vorher und nachher
- [x] Keine Pause vor der Antwort: „Arbeitet …“ bleibt, bis wirklich Text zu sehen ist (ein Antwortblock
      beginnt leer, Gedanken können ausgeblendet sein)
- [x] Kontext im Ring richtig: aus der letzten Antwort des Hauptchats statt aus der Summe aller Aufrufe eines
      Turns (das ergab z. B. 324 %); bei Claude Code gemessen an der Grenze aus seinen Einstellungen. Der
      Ring zählt während des Turns mit, Claude Code wird schon beim Start gefragt, und der letzte Stand
      bleibt über einen Neustart der CLI oder von Nexa
- [x] Kontext aufgeschlüsselt beim Hover über den Ring wie in Claude Desktop (Claude Code
      `get_context_usage`): Balken und Liste nach Art, Puffer fürs Zusammenfassen, frei, Werkzeuge bei Bedarf,
      aufklappbar MCP-Server, eigene Agents und Anweisungsdateien; Codex nennt nur die Summe
- [x] Nachrichten, während der Agent arbeitet: Sie warten wie in den CLIs blass unter dem Chat („Wartet“),
      bis der Agent sie aufnimmt, und stehen dann an dieser Stelle als normale Nachricht im Verlauf. In der
      Eingabe ein eigener Knopf dafür
- [x] Gedanken offen im Verlauf statt eingeklappt; stehen sie untereinander (nur Werkzeuge dazwischen),
      zeigt ein Block den neuesten und blendet ihn beim Wechsel über
- [x] Gedanken ohne Einklappen (ganz ausblenden weiter über „Gedanken anzeigen“); „Arbeitet …“ unter dem
      Chat schimmert mit seinem Spinner in der Akzentfarbe des Themes, alles andere wie bisher grau
- [x] „+“-Menü an der Eingabe wie in Claude Desktop statt der Büroklammer: „Dateien oder Fotos
      hinzufügen“ (Strg+U; Bilder hängen an, andere Dateien als `@`-Erwähnung), „Ordner hinzufügen“ (Claude
      `--add-dir`, Codex schreibbare Ordner; als Chips über der Eingabe), „Slash-Befehle“, „Konnektoren ›“
- [x] Zahnrad der Eingabe direkt links vom Senden-Knopf statt neben Account und CLI
- [x] Eingabe während der Arbeit des Agents wie sonst: kein gestrichelter Rahmen und kein eigener Knopf
      „In die laufende Antwort“ mehr, die Nachricht zeigt „Wartet“ im Chat
- [x] Angeheftete Chats wie im Claude Manager ganz oben über den Trennern („Angeheftet“, die neuesten
      zuerst, mit Projekt), zusätzlich weiter in ihrem Projekt
- [x] Rückfragen: Optionen untereinander statt zweispaltig; beantwortet stehen Fragen und Antworten
      untereinander und vollständig statt abgeschnitten in einer Zeile
- [x] `/clear` im selben Chat statt in einem neuen: Name, Pin und Platz bleiben, jede CLI fängt eine neue
      Unterhaltung an, ein Trenner „Kontext geleert“ steht im Verlauf. Was darüber steht, ist für keine CLI
      mehr Kontext und eingeklappt („Früheren Verlauf anzeigen“). Ein Titel vom Modell kommt mit dem ersten
      Prompt danach neu, ein eigener Name bleibt; `/new` legt wie bisher einen neuen Chat an
- [x] Shell-Modus mit `!` wie in Claude Code, für Claude und Codex: Nexa führt den Befehl im Ordner des
      Chats aus (Windows: PowerShell, Git Bash oder cmd nach Einstellung, sonst die Login-Shell), Ausgabe
      im Chat, Beenden; Schlüssel, Passwörter und Tokens in Befehl und Ausgabe werden durch •••• ersetzt,
      bevor sie gespeichert werden, und so bekommt der Agent sie mit dem nächsten Prompt. Auf der
      Startseite beginnt der Befehl einen neuen Chat
- [x] Bilder groß ansehen: Ein Klick auf ein angehängtes oder gesendetes Bild öffnet es über dem Fenster;
      Mausrad zoomt zum Zeiger, Ziehen verschiebt, Doppelklick wechselt zwischen eingepasst und vergrößert,
      Pfeiltasten blättern, „Mit dem Standardprogramm öffnen“ in der Leiste
- [x] Einzelne MCP-Server an- und ausschalten unter „Konnektoren“: Schalter mit Zustand, Werkzeugen und
      Suche, gilt für alle Chats des Projekts. Ungenutzte (nie angemeldete) wie in der CLI eingeklappt. Claude Code schaltet im laufenden Prozess um (`mcp_status`,
      `mcp_toggle`, gilt nur für den Prozess, daher wendet Nexa es bei jedem Start an); Codex über
      `mcp_servers.<name>.enabled` in der Konfiguration des Threads, ab dem nächsten Prompt
- [x] Prompt je Projekt und Trenner wie der Workspace-Prompt im Claude Manager: „Prompt …“ im
      Kontextmenü, der Text steht als `prompts.md` im Ordner. Jeder
      Chat darunter bekommt ihn zusätzlich, der äußerste zuerst (Claude `--append-system-prompt`, Codex
      `developerInstructions`), ab dem nächsten Start seiner CLI
- [x] Chat bleibt unten: Er folgt dem Neuen, bis man selbst nach oben scrollt. Vorher entschied der Abstand
      zum Ende beim Scroll-Ereignis, und kam dazwischen mehr als eine Zeile dazu (eine Werkzeugkarte, ein
      Codeblock), blieb die Ansicht mitten in der Session stehen
- [x] Chats mit Claude Code abgleichen: Was im Terminal (`claude --resume`) oder in Claude Desktop dazukam,
      übernimmt Nexa beim Öffnen des Chats, wenn das Fenster wieder in den Vordergrund kommt, und über „Mit
      Claude Code abgleichen“ im Menü des Chats; nur fertige Turns, mit einer Notiz „Außerhalb von Nexa
      weitergeführt“. Ist die Sitzung gerade woanders offen (`<config>/sessions/<pid>.json`), steht ein
      Hinweis über der Eingabe, und fertige Antworten von dort kommen alle paar Sekunden
- [x] Chat abzweigen: ein neuer Chat „… (Abzweig)“ mit dem ganzen Verlauf geht von hier aus weiter, der
      alte bleibt, wie er ist. Claude Code (`--fork-session`, `--resume-session-at` der letzten Antwort) und
      Codex (`thread/fork` bis zum letzten Turn) setzen eine Kopie ihrer Unterhaltung fort. Im Menü des
      Chats, im Kontextmenü der Seitenleiste, in der Befehlsliste und als `/fork [Name]` (`/branch`)
- [x] Slash-Befehle, die die CLIs ohne Terminal nicht können, führt Nexa selbst aus, für Claude und Codex:
      `/clear` (`/reset`: Kontext im selben Chat leeren), `/new` (neuer Chat im selben Ordner mit denselben
      Einstellungen), `/diff` (alle
      Änderungen), `/rename`, `/model` und `/effort` (mit Namen gleich gesetzt, ohne das Zahnrad), `/plan`,
      `/permissions`, `/mcp` (Konnektoren), `/add-dir`, `/copy`, `/export`, `/status`, `/resume`, `/tasks`,
      `/login`, `/settings`, `/theme`, `/help`, `/exit`; bei Codex auch `/compact` (`thread/compact/start`)
      und `/usage`. Sie stehen zuerst in der Vervollständigung; ein ausgeschriebener Befehl läuft mit Enter
- [x] Chat als Markdown exportieren (Ordner, Branch, Modell, Zeitraum, Nachrichten nach Tagen) und letzte
      Antwort kopieren: im Menü des Chats, im Kontextmenü der Seitenleiste, in der Befehlsliste und als
      `/export` und `/copy`
- [x] Modellnamen: Claudes „Default“ heißt nach dem Modell, für das es steht („Standard (Opus 5.5)“,
      aus `resolvedModel`)
- [x] Systemfarben: `nativeTheme` folgt dem Modus des Themes (Mica, native Menüs, `prefers-color-scheme`
      der Seiten im Browser), schon beim Start
- [x] Suche im offenen Chat: Strg+F (auch im Menü des Chats und in der Befehlsliste), Enter und F3 zum
      nächsten Treffer, Umschalt dazu zum vorigen; alle Treffer markiert, der aktuelle stärker. Ältere
      Nachrichten, die noch nicht geladen sind, lädt „Alle laden“ für die Suche nach
- [x] Tastenkürzel: Strg+Tab und Strg+Umschalt+Tab zum nächsten und vorigen Chat der Seitenleiste,
      Strg+1–8 zu diesem, Strg+9 zum letzten, Strg+Umschalt+T neuer Chat im Projekt des offenen. In der
      Seitenleiste gehen die Pfeiltasten von Zeile zu Zeile und klappen Trenner, Projekte und Ordner auf
      und zu, Pos1 und Ende springen an den Anfang und ans Ende, die Menütaste und Umschalt+F10 öffnen das
      Kontextmenü
- [x] Benachrichtigungen: Windows-Meldung, wenn ein Chat fertig ist (ab einer Mindestdauer), eine
      Rückfrage hat oder an ein Limit stößt, auf Wunsch mit Vorschau; ein Klick öffnet den Chat. Ton,
      blinkende Taskleiste, „nur im Hintergrund“ oder „auch, wenn der Chat nicht offen ist“, Warnung ab
      einer Schwelle je Account (80 %), „Login abgelaufen“, Glocke in der Titelleiste zum Stummschalten
- [x] Im Infobereich weiterlaufen und mit Windows starten (Einstellungen „Allgemein“): Schließen blendet
      das Fenster nur aus, Chats, API und Benachrichtigungen laufen weiter; der Start bei der Anmeldung
      bleibt dann unsichtbar, bis man Nexa öffnet. Auch unter Linux (Statusbereich, XDG-Autostart)
- [x] Löschen samt Transkript der CLI: Die Unterhaltung in Claude Code oder Codex kommt mit Subagents und
      Checkpoints in den Papierkorb, aus jedem Account mit einer Kopie (abschaltbar unter Einstellungen →
      Chat). Gelöschte Chats verschwinden sofort und lassen sich 8 s lang zurückholen. „Chats aufräumen“
      filtert nach Projekt, Alter, Größe und Archiv und löscht mehrere auf einmal
- [x] Sessions der CLIs übernehmen ohne Claude Manager: Transkripte von Claude Code und Threads von Codex
      aus allen Accounts, nach Ordnern auf Projekte verteilt und auswählbar (Einrichtung, Einstellungen →
      Accounts, Befehlsliste). Der Verlauf kommt beim ersten Öffnen aus der CLI, der Chat geht in
      derselben Session weiter
- [x] „Plugins ›“ im „+“-Menü: die installierten Plugins der CLI für den Ordner mit Suche und Schalter, in
      den Einstellungen der CLI (Claude Code `claude plugin enable|disable`, laufende Chats laden mit
      `reload_plugins` neu; Codex `[plugins."<id>"] enabled`, ab dem nächsten Prompt). Unter „Konnektoren“
      fehlgeschlagene Server neu verbinden (`mcp_reconnect`, Codex `config/mcpServer/reload`), abgemeldete
      anmelden (`mcp_authenticate`, Codex `mcpServer/oauth/login`) und „Konnektoren verwalten“ (claude.ai
      bzw. `config.toml`)
- [x] Artefakte als eigener Eintrag unter „Neuer Chat“: Claudes Artefakte von claude.ai je Account mit
      Vorschaubild, Suche und Filtern; ein Klick zeigt sie im Browser-Panel des Chats, aus dem sie kamen
- [x] Automatische Titel: Nach dem ersten Prompt benennt das Modell den Chat. Claude Code nutzt dafür
      `generate_session_title`, Codex einen flüchtigen Thread. Der Titel gilt auch in der CLI, bei Codex
      über `thread/name/set`. Bis er da ist, steht die erste Zeile da. Ein eigener Name bleibt.
      Abschaltbar unter Einstellungen › Chat.

## Als Nächstes

- [ ] **Chats mit Codex abgleichen** wie mit Claude Code: Was in der Codex-TUI dazukam, aus dem Rollout
      der verknüpften Sitzung nachtragen (`thread/read`, `thread/turns/list`), und warnen, wenn sie
      gerade woanders offen ist.
- [ ] **Sites von Codex** auf der Seite „Artefakte“, sobald der App-Server sie herausgibt (0.169 hat keine
      Methode dafür). Dazu für Claudes Artefakte: umbenennen, löschen und anpinnen wie im Claude Manager.
- [ ] **Automatischer Account-Wechsel bei erreichtem Limit** (wie „Account wechseln“ im Claude Manager):
      Chat mit dem nächsten freien Account derselben CLI fortsetzen, Reihenfolge einstellbar. Ein
      verlassener Account bleibt bis zu seinem Reset gesperrt; ohne freien Account wartet der Chat mit
      Countdown; „Am Reset fortsetzen“ auch ohne Wechsel; nach dem Wechsel eine einstellbare Nachricht
      („Mach weiter“). Dateien dort: `auto-switch.ts`, `session-handoff.ts`, `account-choice.ts`.
- [ ] **Accounts sortieren** per Drag & Drop und Account in der Sidebar am Chat anzeigen.
- [ ] **Einstellungen der CLIs** im UI (MCP-Server, Berechtigungen, Hooks) lesen und bearbeiten; dahin
      führt dann „Konnektoren verwalten“ (bis dahin zu claude.ai bzw. zur `config.toml` von Codex).

## Aus dem Claude Manager

Was der Claude Manager kann und Nexa noch fehlt (Dateien unter `claude-manager/src/`).

- [ ] **Übersicht aller Chats nach Zustand** (wartet auf dich, arbeitet, fertig) mit der offenen Frage,
      dem laufenden Werkzeug, Kontext und Limit je Karte; Strg+Umschalt+J springt zum nächsten wartenden
      Chat (`OverviewView.vue`, `lib/overview.ts`, `lib/attention.ts`).
- [ ] **Logins frisch halten**: abgelaufene Zugangs-Token ruhender Accounts erneuern (unter der Sperre von
      Claude Code), damit ihre Usage stimmt und ein Wechsel sofort geht; Tabelle mit Ablauf und
      „Jetzt erneuern“ (`oauth-renewal.ts`, `LoginOverviewCard.vue`).
- [ ] **Neuer Chat in einem Worktree** (`claude --worktree <name>`): Dialog mit Repository, Name (geprüft
      wie ein Branch) und vorhandenen Worktrees (`WorktreeDialog.vue`, `lib/worktree.ts`); `worktreeCheck`
      in `files/git-service.ts` ist schon da, aber nicht in Preload und UI.
- [ ] **Werkzeuge der App für die Agents** im Nexa-MCP-Server: `limits` (eigene Limits und die der anderen
      Accounts), `sessions_search` / `session_read` (frühere Chats durchsuchen und lesen)
      (`browser/app-tools/*`).
- [ ] **`nx` wie `cm`**: `-a <account>`, `-r [id]`, `-n`, `-- <args>` für die CLI, offenen Chat
      wiederverwenden, Befehl in den Einstellungen an- und abmelden (`cli/launch.ts`, `SettingsCommand.vue`).
- [ ] **Startbefehle je Projekt** (wie die Tab-Sets, z. B. `npm run dev`) als Shells neben dem Chat
      (`tab-set-service.ts`).
- [ ] **API-Beschreibung**: OpenAPI unter `/openapi.json` und eine Doku-Seite unter `/docs`
      (`api/openapi.ts`, `api/docs-page.ts`).

## Später

- [ ] Weitere CLIs (z. B. Gemini CLI) über das Provider-System.
- [ ] Mehrere Fenster bzw. Session in eigenem Fenster; mehrere Chats nebeneinander (`GroupShell.vue` im
      Claude Manager).
- [ ] Verbrauchs-Dashboard: Tokens je Tag, Modell und Ordner, Verlauf der Limits mit Prognose („Limit
      ≈ 16:40“), ohne Dollar (`DashboardView.vue`, `usage-forecast.ts` im Claude Manager).
- [ ] Änderungen je Prompt aus den Checkpoints von Claude Code, Zurückspulen mit Vorschau (Claude
      `rewind_files`, Codex `thread/revert`; `SessionChangesView.vue` im Claude Manager).
- [ ] „Von Chats geändert“ im Kontextmenü des Dateibaums (`FileSessionsMenu.vue` im Claude Manager).
- [ ] Terminal für den Nutzer neben dem Chat (xterm, node-pty) mit der Umgebung des Accounts.
- [ ] Einstellungen exportieren und importieren mit Vergleich (`SettingsTransfer.vue` im Claude Manager).
- [ ] Schlagwörter für Chats mit Filter (`session-marks.ts` im Claude Manager).
- [ ] MCP Apps: Oberflächen von MCP-Werkzeugen (`ui://`-Ressourcen) im Chat zeigen (Claude
      `mcp_read_resource`, Codex `mcpServer/resource/read`).
- [ ] Remote Control wie in Claude Desktop (Claude Code `remote-control`, Codex `remoteControl/*`).
