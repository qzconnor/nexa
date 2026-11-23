# Changelog

Alle nennenswerten Änderungen an Nexa. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

Dies ist der Stand vor dem ersten Release. Seitdem stehen die Änderungen in den Versionshinweisen der
[GitHub-Releases](https://github.com/qzconnor/nexa/releases) und in der App unter *Einstellungen › Updates*;
semantic-release erzeugt sie aus den Pull Requests (siehe README, „Releases“).

## [Unveröffentlicht]

### Hinzugefügt

- **Grundgerüst**: Electron 45, electron-vite, Vue 3.5, TypeScript (strict), Tailwind v4, shadcn-vue, Pinia.
  Neu geschrieben auf Basis des Claude Managers, ohne Terminal, Tabs und Layouts.
- **Fenster** wie im Claude Manager: rahmenlos mit eigener Titelleiste, Mica/Acryl, Fenstergröße und
  -position werden gemerkt. Titelleiste und Sidebar teilen sich eine Fläche, der Inhalt sitzt als Panel
  mit abgerundeter Ecke darin.
- **Themes** aus dem Claude Manager (eingebaute und eigene), inklusive Code- und Syntaxfarben.
- **Theme-System wie im Claude Manager**: Theme-Karten mit Vorschau in den eigenen Farben, eigene Themes
  anlegen, kopieren, bearbeiten, als JSON öffnen, exportieren, importieren (auch per Drag & Drop) und
  löschen (Papierkorb). Der Themes-Ordner wird überwacht, von Hand geänderte Dateien erscheinen sofort.
  Theme-Dateien sind mit dem Claude Manager austauschbar.
- **Theme-Editor** mit jeder Farbe und ihrer Aufgabe in Nexa, Suche, Farbwähler, Kontrast-Warnungen und
  Live-Vorschau eines Nexa-Fensters (Sidebar, Chat, Werkzeuge, Diff, Eingabe).
- **Einstellungen als Dialog** über dem Fenster (Strg+,), mit Karten je Bereich: Darstellung, Accounts,
  CLIs, Chat, Lokale API, Info.
- **Suche in den Einstellungen** (Strg+F, beim Öffnen schon aktiv): findet Karten und Einstellungen über
  alle Bereiche, auch über Stichwörter („Acryl“, „Thinking“, „Port“), ohne Groß-/Kleinschreibung und
  Umlaute. Treffer erscheinen mit ihren Reglern und markiert, die Bereiche zeigen ihre Trefferzahl;
  Enter springt zum ersten Bereich.
- Rückfragen (Chat oder Projekt löschen, Theme löschen, Änderungen verwerfen) im App-Dialog statt im
  Browser-Dialog; Tooltips im Stil der App.
- **Modulares Provider-System** für CLI-Agenten (`AgentProvider` / `AgentRun`), zum Start mit
  Claude Code und Codex:
  - Claude Code über `claude -p` mit `stream-json` in beide Richtungen und Control-Protokoll
    (Freigaben, Unterbrechen, Modell- und Moduswechsel im laufenden Prozess).
  - Codex über `codex app-server` (JSON-RPC über stdio), ein Server je Account für alle seine Sessions.
- **Erkennung beim Start**: welche CLI installiert ist, Version, Anmeldung (Konto und Plan). „Erneut prüfen“
  auf der Startseite.
- **Chat-Oberfläche**, komplett selbst gerendert:
  - Antworten als Markdown mit Syntax-Highlighting und Kopierknopf an Codeblöcken, Streaming mit Cursor.
  - Werkzeugaufrufe als kompakte Zeilen mit Icon und Farbe nach Art (lesen, suchen, schreiben, ausführen,
    MCP, Web), ab sechs Aufrufen gefaltet. Aufgeklappt mit Diff, Befehl und Ausgabe.
  - Diffs mit Zeilennummern und Syntaxfarben, aus Claudes Edits und Codex' Unified Diffs.
  - Pfade im Projektordner werden relativ angezeigt (Werkzeugzeilen, Diffs, Freigaben).
  - Denkprozess (Thinking/Reasoning) einklappbar, Todo-Liste angeheftet über der Eingabe.
  - Fußzeile je Antwort: Dauer, Tokens, Kosten.
- **Rückfragen im UI**: Freigaben für Werkzeuge (mit Diff), Fragen mit Optionen, Plan-Freigabe mit
  Folgemodus, Formulare von MCP-Servern. Beantwortet schrumpfen sie auf die Entscheidung.
- **Agents (Subagents)** als Karten mit Status und Laufzeit, im Seitenpanel einsehbar mit eigenem Verlauf.
- **Eingabe**: Entwürfe je Session (bleiben auch beim Wechsel zur Startseite erhalten), Bilder per Einfügen, Drag & Drop oder Dateiauswahl, Kontext-Anzeige,
  Wahl von CLI, Modell, Denkaufwand und Berechtigungsmodus direkt an der Eingabe.
- **Nahtloser Wechsel zwischen Claude und Codex** in derselben Session: die übernehmende CLI bekommt
  den Verlauf, den sie noch nicht kennt, als Kontext (`<nexa-context>`).
- **Projekte und Sessions**: Sessions sind Projekten (Ordnern) zugeordnet, in der Sidebar mit Status,
  Suche, Umbenennen, Löschen. Verläufe als JSONL gespeichert, Sessions laufen über `--resume` bzw.
  `thread/resume` weiter.
- **Nexa-MCP-Server** (Streamable HTTP, lokal, mit Token je Session) mit Werkzeugen, die Elemente im
  Chat rendern: `render_chart`, `render_diagram` (Mermaid), `render_table`, `render_stats`,
  `render_callout`. Ein Systemprompt-Zusatz sagt den Agenten, wann sie diese nutzen.
- **Accounts wie im Claude Manager, für Claude Code und Codex**: eigener Bereich „Accounts“ in den
  Einstellungen. Neben dem Standard-Account der CLI (`~/.claude`, `~/.codex`) beliebig viele weitere,
  jeder mit eigenem Konfigurationsordner (`CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME`), Name und Farbe.
  - Anmeldearten: Browser-Login (Claude Code und Codex), Long-lived Token aus `claude setup-token` und
    API-Key (Claude Code). Token und Keys liegen mit der Windows-Datenverschlüsselung verschlüsselt.
  - **Login im UI** ohne Terminal: Nexa startet `claude auth login` bzw. `codex login`, der Dialog zeigt
    den Link zum Kopieren oder Öffnen, nimmt den Code aus dem Browser an und meldet, wer angemeldet ist.
  - Je Account: Konto, Plan, Anmeldestatus (abgelaufen, fehlt), Limits; Erweitert mit zusätzlichen
    CLI-Argumenten, vorhandenem Konfigurationsordner und Übernahme der Einstellungen aus `~/.claude`
    (settings.json, CLAUDE.md, Skills, Commands, Agents – ohne Anmeldedaten).
  - **Vorgabe je CLI** für neue Chats; auf der Startseite und im Chat wählt ein Menü an der Eingabe den
    Account, mit Plan, Status und Auslastung.
  - **Account-Wechsel im laufenden Chat**: Nexa kopiert die Unterhaltung der CLI (Claude-Transkript samt
    Dateiverlauf, Codex-Rollout) in den neuen Account, die CLI macht dort nahtlos weiter. Geht das nicht,
    bekommt sie den Verlauf als Kontext.
  - Entfernen mit Rückfrage, auf Wunsch samt Profilordner; Chats des Accounts laufen mit der Vorgabe weiter.
- **Usage in der Titelleiste** je CLI und Account: Claude gleich nach dem Start über die OAuth-Usage-
  Schnittstelle (auch für Accounts ohne laufenden Chat, mit Limits einzelner Modelle), Codex aus
  `account/rateLimits`. Gezeigt wird der Account des offenen Chats; das Popover listet alle Accounts.
  Im Chat erscheinen nur die CLIs, mit denen er gearbeitet hat (beide erst nach einem Wechsel), sonst
  die CLI, mit der neue Chats starten.
- **Verbrauch** als Bereich der Einstellungen: Tokens, Kosten und Turns je Tag und CLI, Limits je
  Account. Die Usage in der Titelleiste öffnet ihn.
- **Dateien und Aktivität** wie im Claude Manager, als einklappbares Panel links neben dem Chat
  (Knopf im Chat-Kopf, Strg+Umschalt+E):
  - Dateibaum des Projektordners mit Git-Branch, Änderungen nach Art (M, A, D, U …) und Markierungen,
    Suche nach Namen und im Inhalt, Neu, Umbenennen, In den Papierkorb, Vormerken und Verwerfen.
  - Dateien, die der Agent gerade liest, durchsucht, schreibt oder committet, leuchten in der Farbe
    der Werkzeugart auf; ihre Ordner klappen kurz auf. Das gilt für Claude Code und Codex, auch für
    Shell-Befehle, die Dateien schreiben.
  - Filter „Änderungen“ und „Aktivität“: nur geänderte Dateien oder nur die, die der Agent in diesem
    Chat angefasst hat (auch aus dem Verlauf vor einem Neustart), je Art ein- und ausblendbar.
  - Ein Klick auf eine Datei zeigt ihre Änderungen über dem Verlauf (untereinander oder nebeneinander,
    mit Wortmarkierung und Syntaxfarben), „Alle Änderungen“ zeigt alle wie in einem Pull Request,
    auch seit dem Abzweig des Branches. Abschnitte lassen sich vormerken oder verwerfen.
  - Kommentare an Zeilen der Änderungen sammeln sich und gehen gesammelt in die Eingabe des Chats.
  - Kontextmenü „Im Chat erwähnen“ und Ziehen einer Datei auf die Eingabe setzen `@pfad` ein.
  - Git-Branch des Projekts im Chat-Kopf, ein Klick öffnet das Repository im Browser.
- **Eigener Browser** wie im Claude Manager, als einklappbares Panel rechts neben dem Chat (Globus im
  Chat-Kopf, offen oder zu je Chat, Breite am linken Rand ziehbar):
  - Jeder Chat hat seinen Browser mit Tabs; sie bleiben über Neustarts erhalten und laden erst, wenn
    man sie zeigt. Adressleiste, Suche auf der Seite (Strg+F, F3), Downloads, Anmeldung bei Seiten mit
    Benutzername und Passwort, DevTools (F12), Zoom, Strg+T/W/L/R wie in Chrome. Eigenes Profil
    (Cookies, Logins) getrennt von der App; „Browserdaten löschen“ in den Einstellungen.
  - Claude und Codex bedienen ihn über Nexas MCP-Server mit allen Browser-Werkzeugen des Claude
    Managers (`browser_navigate`, `browser_snapshot` mit Refs und Diffs, Klicken, Tippen, Formulare,
    Screenshots, Konsole, Netzwerk, Emulation, Routen, Speicher, Performance, Barrierefreiheit,
    Playwright-Test erzeugen …). Benutzt der Agent den Browser, öffnet sich das Panel von selbst.
  - Über der Seite zeigt Nexa, was der Agent tut: hervorgehobene Elemente, sein Mauszeiger, Status mit
    „Übernehmen“ (selbst bedienen, der Agent wartet) und ein Protokoll seiner Schritte.
  - Werkzeuge, die über die Seite hinausgreifen (Skripte, Cookies und Speicher, Uploads, Inhalte von
    Anfragen, Daten löschen), fragen vorher nach; die übrigen laufen ohne Rückfrage.
  - Der Systemprompt erklärt den Agents den Browser. Einstellungen „Browser neben dem Chat“ und
    „Ohne ‚Claude in Chrome‘“ (Claude Code startet dann mit `--no-chrome`).
- **Lokale REST-API** (z. B. für Stream Deck): Status, Usage, Accounts, Projekte, Sessions anlegen (auch
  mit Account), senden, unterbrechen, anzeigen, Ereignisse per SSE. Nur 127.0.0.1, Bearer-Token.
- **`nx`-Befehl**: `nx`, `nx <ordner>`, `-c` (letzte Session fortsetzen), `--claude`, `--codex`,
  `-m "<prompt>"`. Startet Nexa oder reicht an die laufende Instanz weiter.
- **App-Icon**: ein „N“ aus zwei verbundenen Knoten, in der Akzentfarbe.
- **Installer und Updates** wie im Claude Manager: Windows-Installer (richtet `nx` im PATH ein), AppImage,
  deb und rpm für Linux, als GitHub-Release von semantic-release. Die App sucht beim Start und alle
  4 Stunden nach einer neuen Version, lädt sie auf Klick und installiert sie beim Neustart. Unter
  *Einstellungen › Updates* stehen die Versionshinweise, ein Punkt am Einstellungen-Knopf zeigt ein
  wartendes Update. Unter Linux übernimmt Nexa die Umgebung der Login-Shell, damit die CLIs auch beim
  Start aus dem Anwendungsmenü gefunden werden.
- Links in Antworten, die auf lokale Dateien zeigen, öffnen die Datei.
- Unit-Tests (Vitest) für `nx`-Argumente, Diffs, relative Pfade, Codex-Befehlsanzeige, Account-Dateien
  der CLIs, Login-Ausgabe, Claude-Limits und das Kopieren von Unterhaltungen zwischen Accounts.

### Geändert

- Codex bekommt den Zugang zu Nexas MCP-Server je Chat (mit der Konfiguration des Threads) statt
  einen für alle; so weiß Nexa, zu welchem Chat ein Aufruf gehört, auch wenn mehrere Chats einen
  Codex-Prozess teilen. Werkzeuge dürfen bis zu 15 Minuten laufen (der Browser wartet z. B., solange
  der Nutzer ihn übernommen hat).
- Claude Code erlaubt Nexas Werkzeuge jetzt einzeln statt den ganzen Server, damit heikle
  Browser-Werkzeuge nachfragen.

### Behoben (während der Entwicklung)

- Codex-Befehle wurden als ganze PowerShell-Zeile angezeigt; jetzt der eigentliche Befehl, Lesen und
  Suchen als eigene Werkzeugart.
- Mermaid-Diagramme waren zu klein und nutzen jetzt die volle Breite.
- Nach einer Freigabe verschwand die Werkzeugzeile samt Diff.
- Deutsche Titel für weitere Claude-Werkzeuge (`ToolSearch`, MCP-Ressourcen, Aufgaben-Ausgabe).
- Die Auswahl an der Eingabe der Startseite (CLI, Account, Modell, Denkaufwand, Modus) war nach einem
  Neustart weg. Sie wird jetzt als Vorgabe für neue Chats gespeichert und folgt auch Änderungen in den
  Einstellungen.
- Warnung „'safeStorage.decryptString' is deprecated“ im Log: das Token der lokalen API wird jetzt
  asynchron ver- und entschlüsselt, wie die Secrets der Accounts.
- Im Login-Dialog schob ein langer Anmelde-Link den Inhalt über den Rand des Dialogs.
- Die Modi „Auto“ und „Bearbeiten erlauben“ erschienen an der Eingabe grau, als wären sie deaktiviert.
- Die Icons der Chats in der Sidebar saßen nicht bündig unter dem Projekt.
- Der Weichzeichner hinter Dialogen deckt jetzt auch die Titelleiste ab; nur Minimieren, Maximieren und
  Schließen bleiben bedienbar.

### Entfernt

- Der Eintrag „Verbrauch“ in der Sidebar; der Verbrauch steht jetzt in den Einstellungen.
