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
- [x] Automatischer Account-Wechsel am Limit (wie „Account wechseln“ im Claude Manager): Der Chat geht mit
      dem nächsten freien Account derselben CLI in der Reihenfolge der Accountliste weiter; der verlassene
      bleibt bis zu seinem Reset gesperrt; ohne freien Account wartet der Chat mit Countdown; „Am Reset
      fortsetzen“ auch ohne Wechsel; danach eine einstellbare Nachricht („Mach weiter“)
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
- [x] Chatbreite „Normal“ und „Breit“ wächst auf großen Bildschirmen (4K, Ultrawide) mit: rund 40 % bzw.
      54 % der Chatspalte wie auf Full HD, nie schmaler als bisher (`--chat-width` mit `cqw`)
- [x] Skalierung der ganzen Oberfläche von 67 % bis 200 % unter Einstellungen › Darstellung, mit Strg +
      Plus, Strg + Minus und Strg + 0 überall im Fenster (Hinweis mit „Zurücksetzen“). Titelleiste und
      Fensterknöpfe wachsen mit, die Seiten im Browser starten in derselben Größe. Die Einstellungen
      öffnen immer bei „Allgemein“
- [x] Eingeklappte Projekte, Ordner und Trenner zeigen, was ihre Chats tun: Spinner, solange einer
      arbeitet, dazu ein Punkt für eine Rückfrage, einen Fehler oder eine ungelesene Antwort
- [x] Der Kontextring an der Eingabe dreht sich, während die CLI den Kontext zusammenfasst
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
- [x] Prompts bearbeiten: der Stift links neben einem Prompt ändert ihn im Chat und schickt ihn neu; was
      danach kam, fällt weg. Claude Code (`--resume-session-at` der Antwort davor) und Codex (`thread/fork`
      bis zum Turn davor) setzen ihre Unterhaltung an der Stelle fort, die alte bleibt dem Chat bis zum
      Löschen. Auch während der Agent arbeitet: Senden bricht seine Antwort ab
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
- [x] Accounts sortieren: am Griff einer Karte unter Einstellungen › Accounts ziehen oder mit den
      Pfeiltasten verschieben; in dieser Reihenfolge stehen sie überall. Hat eine CLI mehrere Accounts,
      zeigt die Sidebar am Chat einen Punkt in der Farbe seines Accounts
- [x] Prognose der Limits wie im Claude Manager: Aus den Messpunkten der letzten Zeit (eine Stunde beim
      5-Stunden-Fenster, ein Tag bei den Wochen) sagt jedes Fenster, wann das Limit beim jetzigen Tempo
      erreicht ist („Limit ≈ 17:45“, auch in der Titelleiste) oder wie voll es zum Reset ist; die Messpunkte
      überstehen einen Neustart (`usage-samples.json`)
- [x] Chats mit Codex abgleichen wie mit Claude Code: Was in der Codex-TUI, VS Code oder der Codex-App
      dazukam, kommt mit einer Notiz in den Chat (`thread/turns/list`), und ein Hinweis warnt, solange der
      Thread dort offen ist. Ein ruhender Codex-Chat gibt seinen Thread nach einer Minute frei, damit die
      TUI ihn öffnen kann
- [x] Nachrichten zwischen Chats (Einstellung „Nachrichten zwischen Chats“, aus bis man sie einschaltet):
      Die Agents erreichen über Nexas MCP-Server die anderen Chats beim Namen, auch umbenannte, auch von
      Claude zu Codex und zurück: `chat_list`, `chat_read`, `chat_send`, `chat_new`. Die Nachricht steht
      umrandet mit „Nachricht von …“ im Chat und nennt dem Agent den Absender zum Antworten; nach zehn
      Nachrichten zwischen Chats ohne den Nutzer ist Schluss
- [x] Logins frisch halten (aus dem Claude Manager): abgelaufene Zugangs-Token ruhender Claude-Accounts
      erneuert Nexa unter der Sperre von Claude Code, abschaltbar; Tabelle „Logins“ in den
      Account-Einstellungen mit Ablauf und „Jetzt erneuern“. Codex erneuert seine selbst
- [x] Neuer Chat in einem Worktree (aus dem Claude Manager): Dialog mit Repository, Name und vorhandenen
      Worktrees; Nexa legt ihn mit Git an wie `claude --worktree` (`.claude/worktrees/<name>`, Branch
      `worktree-<name>`), für Claude Code und Codex, und räumt ihn beim Löschen des Chats weg, wenn nichts
      Neues darin ist
- [x] Werkzeuge der App für die Agents im Nexa-MCP-Server: `limits` (eigene Limits und die der anderen
      Accounts), `sessions_search` (frühere Chats durchsuchen, unter „Nachrichten zwischen Chats“)
- [x] `nx` wie `cm`: `-a <account>`, `-r [id]`, `-n`, `-- <args>` für die CLI, offenen Chat
      wiederverwenden, Befehl unter Einstellungen › Allgemein an- und abmelden
- [x] Startbefehle je Projekt (wie die Tab-Sets im Claude Manager, z. B. `npm run dev`) als Shells neben
      dem Chat, auf Wunsch automatisch mit dem ersten Chat des Projekts; beim Beenden von Nexa gestoppt
- [x] API-Beschreibung: OpenAPI unter `/openapi.json` und eine Doku-Seite unter `/docs`, aus einer
      Routentabelle, die der Server selbst nutzt
- [x] Schriftarten wählen (Oberfläche und Code, aus den installierten Schriften) und Ligaturen für Code
      ein- und ausschalten wie im Claude Manager
- [x] „Chat neu starten“ (Knopf oben rechts, Menü, Befehlspalette): Die CLI startet auf derselben
      Unterhaltung neu und übernimmt geänderte Nexa-Werkzeuge und Prompts; nach dem Umschalten der Werkzeuge
      bietet ein Toast das für den offenen Chat an. „Chat beenden“ (vorher „CLI beenden“, auch `/exit`)
      beendet die CLI und führt zur Startseite
- [x] Shell-Ansicht im Dock statt als Panel neben dem Chat: Die Shells stehen untereinander in der Karte
      „Shells“ über dem Eingabefeld, ein Klick klappt eine nach unten auf (immer nur eine) mit ganzem Befehl,
      Zustand, Ausgabe, Beenden und bei Startbefehlen Neu starten. Vom Befehl im Chat oder aus dem Kopf
      geöffnet, kommt sie aufgeklappt dazu. Eine Shell, die endet, bleibt offen; Klick oder Esc klappt zu
- [x] Terminal für den Nutzer rechts neben dem Chat (xterm, node-pty): Knopf im Kopf des Chats links von
      „Chat neu starten“ oder Strg+Ö. Die Shell der Einstellungen im Ordner des Chats und mit der Umgebung
      seines Accounts (`claude`/`codex` dort mit dessen Login), mehrere Tabs, verstellbare Breite, Farben
      und Schrift aus dem Theme. Läuft weiter, wenn man den Chat verlässt, und endet mit dem Chat oder Nexa
- [x] Beantwortete Rückfragen: die Antworten stehen unter ihren Fragen, nicht unter der Marke davor
- [x] Worktree-Chats wie `claude --worktree`: Sie zweigen vom Standard-Branch von `origin` ab (`origin/main`,
      vorher geholt, wenn das Repository seit einem Tag nicht geholt wurde) oder wahlweise vom aktuellen Stand
      des Ordners, vorbelegt mit `worktree.baseRef` von Claude Code. Ignorierte Dateien, die `.worktreeinclude`
      nennt (`.env` & Co.), kommen mit, der Dialog zeigt welche; auf Windows auch `.claude/settings.local.json`.
      Ein vorhandener Worktree ohne eigene Arbeit kommt beim Wiederbetreten auf den neuen Stand
- [x] Einstellungen exportieren und importieren wie im Claude Manager (Einstellungen › Allgemein,
      Befehlsliste): eine Datei mit den Einstellungen und den eigenen Themes, ohne Accounts und Logins. Der
      Import zeigt erst jede Änderung mit altem und neuem Wert und lässt einzeln wählen; was bestimmt, was
      startet oder was die Agents ohne Nachfrage dürfen, ist nicht vorgewählt. Was es auf dem Computer nicht
      gibt (Pfad zur CLI, Accounts, Schriften, Mikrofon, Git Bash) und ungültige Werte bleiben, wie sie sind,
      und werden genannt; eigene Themes kommen dazu. „Rückgängig“ im Toast nimmt alles zurück
- [x] Einstellungen der CLIs im UI (Einstellungen › CLI-Konfiguration): MCP-Server (Befehl, HTTP, SSE)
      hinzufügen, bearbeiten, entfernen und bei Codex ein- und ausschalten, Berechtigungen (Claude: Modus,
      Erlauben, Immer fragen, Verbieten, weitere Ordner; Codex: Freigaben, Sandbox, Netzwerk, schreibbare
      Ordner) und Hooks je Ereignis mit Matcher, Befehl und Zeitgrenze, bei Codex mit Vertrauen. Je CLI,
      Account und Ebene (Nutzer, Projekt, bei Claude auch Lokal), in den Dateien der CLIs selbst; Schlüssel
      in Variablen und Headern bleiben verborgen, was Nexa nicht kennt, bleibt erhalten. „Konnektoren
      verwalten“ führt dorthin, mit CLI, Account und Ordner des Chats
- [x] CLI-Konfiguration in Tabs (Alle CLIs und eine je CLI, darunter MCP-Server, Berechtigungen und Hooks)
      und globale MCP-Server: einmal anlegen oder einen vorhandenen global machen, Nexa trägt ihn in jede
      CLI und jeden Account ein und hält ihn gleich (Ändern und Entfernen gelten überall, neue Accounts
      bekommen ihn). Die Übersicht zeigt je Server und Account, wo er fehlt oder abweicht, und gleicht an
- [x] Antigravity CLI als dritte CLI statt Gemini CLI: Google hat Gemini CLI für private Konten
      eingestellt, Antigravity CLI (`agy`) ist der Nachfolger und spricht ebenfalls das Agent Client
      Protocol (`agy acp`, ein Prozess je Chat). Text, Gedanken, Werkzeuge mit Diffs und Befehlsausgabe,
      Aufgabenliste (`update_steps`), Rückfragen zu Werkzeugen, Pläne (`implementation_plan.md`) mit
      Freigabe, Modelle mit Denkstufen, Modi samt `auto` und „Volle Rechte“ (Neustart mit
      `--dangerously-skip-permissions`), Abbrechen, Fortsetzen ohne Wiedergabe (`session/resume`), Nexas
      MCP-Server, Anweisungen und Ordner-Prompts im Systemprompt (`_meta.antigravity.systemPrompt`).
      Accounts: der Google-Login des Systems (Schlüsselbund, mit Plan) und API-Keys mit eigenem Ordner
      (`--gemini-dir`). CLI-Konfiguration für `mcp_config.json`, `hooks.json` und die Berechtigungen.
      `nx --antigravity` bzw. `nx --agy`. Accounts und Chats von Gemini CLI aus Nexa 0.x übernimmt Nexa
      beim Start (Chats wechseln zur Standard-CLI, Gemini-Accounts fallen weg)
- [x] Chat in eigenem Fenster: das Symbol neben Terminal und Neustart im Kopf des Chats (auch im Menü
      „Mehr“, im Kontextmenü der Seitenleiste und in der Schnellsuche) löst den Chat in ein eigenes
      Nexa-Fenster, nur mit diesem Chat. Entwurf, Terminal und Browser kommen mit, auch wieder zurück
      (Symbol „Zurück ins Hauptfenster“ oder Schließen des Fensters). Die Seitenleiste markiert solche
      Chats, ein Klick holt ihr Fenster nach vorn. Größe und Lage merkt sich Nexa je Chat, offene Fenster
      kommen beim nächsten Start wieder. Meldungen, Blinken und `nx` gehen an das Fenster des Chats
- [x] „Jetzt senden“ an einer Nachricht, die wartet, während der Agent arbeitet: bricht den Turn ab, und
      die Nachricht geht sofort raus (Claude Code und Antigravity CLI; Codex nimmt sie ohnehin gleich auf)
- [x] Vorschlag für den nächsten Prompt bei Claude Code (`prompt_suggestion`): grau im leeren
      Eingabefeld, Tab übernimmt ihn; abschaltbar unter Einstellungen › Chat
- [x] Die ersten Ideen aus `IDEAS.md` („Zuerst“):
  - [x] Schneller und sparsamer: Renderer minifiziert, xterm und selten gebrauchte Dialoge erst bei Bedarf
        geladen; Markdown beim Streamen höchstens alle 80 ms und erst am Ende hervorgehoben; die Blöcke des
        Chats nicht mehr bei jedem Stück Text neu gebaut
  - [x] Claude Code und Antigravity CLI enden nach einer Ruhezeit (Einstellungen › Chat › Prozesse, ab
        Werk 15 Minuten), nicht solange Shells oder Agents im Hintergrund laufen
  - [x] Esc hält den Agenten an; Toasts oben rechts unter der Titelleiste statt über dem Senden-Knopf
  - [x] An jeder Antwort und jedem Prompt Uhrzeit und Kopieren, das Modell in der Fußzeile, wenn es
        wechselt, dazu Tagestrenner
  - [x] Aufrufe, die Nexa verschluckte: Claudes Aufgaben (`TaskCreate` & Co.) als Todo-Liste,
        `SendMessage` und `ListAgents` lesbar, `SubagentHandback` ausgeblendet; bei Codex der Plan, Warten,
        Prompts von Hooks, der Fortschritt von MCP-Werkzeugen und was die Websuche tut
  - [x] Rückfrage mit Formular (`ask_user` im Nexa-MCP-Server) für alle CLIs
  - [x] Rückfrage beim Beenden, wenn Chats arbeiten oder Startbefehle laufen (abschaltbar)
- [x] Kein Terminalfenster mehr beim Start durch das eigene Update von Antigravity CLI
- [x] Geplante Aufgaben (Idee aus Claude Desktop): Seite „Geplant“ unter „Artefakte“, je Aufgabe CLI,
      Account, Modell, Freigaben und Projekt; täglich, wochentags, an Wochentagen, monatlich, stündlich,
      einmalig oder nur von Hand. Jeder Lauf ist ein Chat (oder geht im selben weiter), verpasste Läufe
      holt Nexa einmal nach, Vorlagen für Überblick, Pull Requests, Tests, Abhängigkeiten und mehr
- [x] Benachrichtigungen der Agents (`notify` im Nexa-MCP-Server): Toast im Fenster oder Meldung des
      Systems, ein Klick öffnet den Chat, bis zu drei Knöpfe, deren Wahl der Agent abwartet; abschaltbar
      unter Einstellungen › Benachrichtigungen

## Als Nächstes

- [ ] **Nachrichten an Claude-Sitzungen außerhalb von Nexa** (Terminal, VS Code) über das Peer-Protokoll
      von Claude Code (`PROTOCOLS.md`, „Nachrichten zwischen Sitzungen“). Senden ist einfach, für Antworten
      müsste Nexa eine eigene Pipe anmelden. Für Codex außerhalb von Nexa erst prüfen, ob die Queue
      (`thread/queue/*`) einen Thread erreicht, den die TUI hält. Und prüfen, wie Nachrichten ankommen, die
      eine Claude-Sitzung von außen per `SendMessage` an einen Chat von Nexa schickt, und sie als solche zeigen.

- [ ] **Sites von Codex** auf der Seite „Artefakte“, sobald der App-Server sie herausgibt (0.169 und 0.172
      haben keine Methode dafür).
- [x] Claudes Artefakte umbenennen, löschen und auf claude.ai anpinnen wie im Claude Manager, mit Filter
      „Angepinnt“.

## Aus dem Claude Manager

Was der Claude Manager kann und Nexa noch fehlt (Dateien unter `claude-manager/src/`).

- [ ] **Übersicht aller Chats nach Zustand** (wartet auf dich, arbeitet, fertig) mit der offenen Frage,
      dem laufenden Werkzeug, Kontext und Limit je Karte; Strg+Umschalt+J springt zum nächsten wartenden
      Chat (`OverviewView.vue`, `lib/overview.ts`, `lib/attention.ts`).

## Später

- [ ] **Antigravity CLI, was noch fehlt** (`PROTOCOLS.md`, „Antigravity CLI“):
  - [x] Mehrere Google-Logins: weitere Google-Accounts mit eigenem `--gemini-dir` und
        `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true`, der Token liegt dann im Ordner statt im Schlüsselbund.
        `AGY_ACCOUNT` und `ANTIGRAVITY_CREDENTIAL_SCOPE` gehören zu Sandbox-Konten und Plugins.
  - [x] Anmelden (`agy acp --login`, Code aus dem Browser im Dialog) und Abmelden (ACP `logout`) aus Nexa,
        mit der E-Mail des Kontos aus den Logs von `agy acp`. Noch mit einer echten Anmeldung prüfen.
  - [x] Limits und Kontingente: je Modellgruppe aus `agy -p "/usage"` in Titelleiste, Accounts und
        Verbrauch; ein Turn am Kontingent endet als Limit mit Reset (Texte aus den Strings von agy 1.5.17,
        ein echter Fehler dieser Art noch nicht gesehen).
  - [x] Titel aus `session_info_update` übernehmen.
  - [x] Unterhaltungen von Antigravity CLI lesen: übernehmen (Import, `nx -r <id>`) über `session/list`
        und `session/load`, Abgleich, wenn sie außerhalb von Nexa weiterlaufen (Zeiten der Schritte aus
        `conversations/<id>.db`), und Accountwechsel auf derselben Unterhaltung (Kopie der Datenbank).
  - [x] Abzweigen und Bearbeiten auf derselben Unterhaltung: Nexa kopiert die Datenbank unter neuer ID und
        schneidet sie vor dem Prompt ab (ACP kann weder abzweigen noch kürzen).
  - [x] Berechtigungen eines Projekts unter Einstellungen › CLI-Konfiguration: die Regeln des
        Antigravity-Projekts (`config/projects/default-cli-project.json`), die `/permissions` „Project“
        nennt. Antigravity CLI nimmt dieses Projekt in jedem Ordner, die Regeln gelten also in allen
        Projekten; Nexa sagt das dazu.
  - [x] MCP-Server von Antigravity CLI im „+“-Menü: aus den Dateien des Nutzers und des Ordners, mit
        „Eingerichtet“ oder „Aus“ und einem Schalter, der `disabled` in der Datei des Servers setzt.
  - [x] Ob ein MCP-Server von Antigravity CLI verbunden ist, im „+“-Menü zeigen (laufender Chat: über den
        lokalen Server von `agy acp`, `GetMcpServerStates`), mit „Neu verbinden“ (`RefreshMcpServers`).
  - [ ] Server des Nutzers je Projekt abschalten: geht mit 1.5.17 nicht (weder `.agents/mcp_config.json`
        noch `session/new` noch ein Schalter von `agy acp`; `ToggleMcpServer` schreibt in die Datei des
        Nutzers). Vielleicht über einen eigenen Agenten mit `inheritMcp: false` (`agy acp --agent`), ungeprüft.
  - [x] Die Regeln von „Shared with Antigravity“ (`/permissions`) zeigen und ändern: `config/config.json`,
        `userSettings.globalPermissionGrants`. Noch nicht gesehen, wie `/permissions` selbst sie schreibt.
  - [ ] Unter macOS und Linux prüfen: Installation (`~/.local/bin` laut `install.sh`), Schlüsselbund
        (`security` bzw. Secret Service über `gdbus`, nach den Konventionen von go-keyring geschrieben) und
        Pfade sind umgesetzt, aber ohne Mac oder Linux nicht ausprobiert.
- [ ] Weitere CLIs über das Provider-System.
- [ ] Verbrauchs-Dashboard: Tokens je Tag, Modell und Ordner, Verlauf der Limits als Diagramm, ohne
      Dollar (`DashboardView.vue`, `usage-history.ts` im Claude Manager).
- [ ] Änderungen je Prompt aus den Checkpoints von Claude Code, Zurückspulen mit Vorschau (Claude
      `rewind_files`, Codex `thread/revert`; `SessionChangesView.vue` im Claude Manager).
- [ ] „Von Chats geändert“ im Kontextmenü des Dateibaums (`FileSessionsMenu.vue` im Claude Manager).
- [ ] Schlagwörter für Chats mit Filter (`session-marks.ts` im Claude Manager).
- [x] MCP Apps: Oberflächen von MCP-Werkzeugen (`ui://`-Ressourcen) im Chat zeigen (Claude
      `mcp_read_resource`/`mcp_call`, Codex `mcpServer/resource/read`/`mcpServer/tool/call`), in einem
      Frame mit eigener Adresse und CSP. Offen: Vollbild und Bild-im-Bild (`ui/request-display-mode`),
      `ui/update-model-context`, mit einem echten Server und einem echten Turn prüfen.
- [ ] Remote Control wie in Claude Desktop (Claude Code `remote-control`, Codex `remoteControl/*`).
