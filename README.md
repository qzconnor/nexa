# Nexa

Ein Chat für Coding-Agenten: Claude Code und Codex mit derselben Oberfläche. Die CLIs laufen als
Kindprozesse mit JSON-Streams (`claude -p --output-format stream-json`, `codex app-server`), die Oberfläche
zeichnet Nexa selbst: Chats nach Projekten, Freigaben und Rückfragen im Fenster, Agents, mehrere Accounts
je CLI, Usage, ein Dateibaum mit Git und ein Browser neben dem Chat, den die Agents über Nexas MCP-Server
steuern.

## Installation

Die Dateien stehen bei jedem [Release](https://github.com/qzconnor/nexa/releases/latest) auf GitHub.

- **Windows 11**: `Nexa-<version>-Setup.exe` ausführen.
- **Debian, Ubuntu, Linux Mint, Pop!_OS**: `sudo apt install ./Nexa-<version>.deb`. Die App steht danach im
  Anwendungsmenü, auf der Kommandozeile als `nexa`.
- **Fedora, openSUSE, RHEL**: `sudo dnf install ./Nexa-<version>.rpm` (openSUSE: `sudo zypper install ./…`).
- **Alle anderen Distributionen**: `Nexa-<version>.AppImage` herunterladen, mit `chmod +x Nexa-*.AppImage`
  ausführbar machen und starten. Es braucht kein libfuse2, nur FUSE 3 (`fusermount3`).

Updates holt sich die App selbst (*Einstellungen › Updates*): Das AppImage ersetzt seine eigene Datei, das
deb- und rpm-Paket installiert die App über den Paketmanager, der dafür einmal nach dem Passwort fragt.

Mindestens eine der CLIs, Claude Code oder Codex, muss installiert sein. Nexa findet sie im PATH, unter
Linux auch dann, wenn die App aus dem Anwendungsmenü startet: Sie übernimmt einmal die Umgebung der
Login-Shell (`~/.bashrc`, `~/.zshrc`, nvm & Co.). Beim ersten Start zeigt Nexa, was es gefunden hat, und
fragt, welche CLIs es nutzen soll; das lässt sich später unter *Einstellungen › CLIs* ändern.

## Befehl `nx` (Windows)

Der Installer richtet den Befehl `nx` ein. Er funktioniert in jedem Terminal und in der Adressleiste des
Explorers: `nx` eintippen, Enter, und Nexa öffnet einen Chat im angezeigten Ordner.

| Aufruf | Wirkung |
|---|---|
| `nx` | neuer Chat im aktuellen Ordner |
| `nx <ordner>` | neuer Chat in `<ordner>` (auch `~`) |
| `nx -a <account>` | mit Account: Name, E-Mail oder ID, auch ein Teil des Namens, von Claude Code oder Codex |
| `nx --claude`, `nx --codex` | mit Claude Code bzw. Codex |
| `nx -c` | letzten Chat in diesem Ordner öffnen |
| `nx -r <id>` | Chat fortsetzen: per ID des Chats, der Session von Claude Code oder des Threads von Codex |
| `nx -r` | die Chats dieses Ordners zur Auswahl (Schnellsuche) |
| `nx -n` | neuer Chat, auch wenn im Ordner schon einer offen ist |
| `nx -m "<prompt>"` | Chat öffnen und den Prompt gleich senden |
| `nx -- <argumente>` | Argumente an die CLI des neuen Chats, z. B. `nx -- --model opus` |

**Offener Chat**: Läuft die CLI eines Chats im Ordner noch oder ist ein Chat dort noch leer, wechselt `nx`
zu ihm, statt einen neuen zu öffnen (abschaltbar unter *Einstellungen › Allgemein › Befehl „nx“*). `-n`,
`-m` und Argumente für die CLI öffnen immer einen neuen. `-a`, `--claude` und `--codex` grenzen ein, welcher
Chat bei `-c` und als offener Chat in Frage kommt, und bestimmen, womit ein neuer startet; passt ein Name auf
Accounts beider CLIs, gilt die CLI, mit der neue Chats starten.

**Fortsetzen**: `nx -r <id>` öffnet den Chat mit dieser ID oder den, der die Session von Claude Code bzw. den
Thread von Codex fortführt. Kennt Nexa sie noch nicht (z. B. aus dem Terminal), holt es sie aus den Ordnern
der Accounts als neuen Chat herein, wie *Einstellungen › Import*.

**Argumente für die CLI**: Claude Code bekommt sie unverändert bei jedem Start dieses Chats. Codex läuft als
App-Server für alle Chats eines Accounts und nimmt deshalb nur seine Konfiguration `-c schlüssel=wert`
(`--config`), die für den Thread des Chats gilt, z. B. `nx --codex -- -c model_reasoning_effort=high`.

`nx.exe` (`src/launcher/nx.cs`) liegt im Unterordner `bin` der Installation, nur dieser Ordner kommt in den
Benutzer-PATH. Die Deinstallation entfernt ihn wieder; unter *Einstellungen › Allgemein › Befehl „nx“* lässt
er sich auch von Hand ab- und wieder anmelden. Einen `nx` eines anderen Programms übernimmt Nexa nicht.

## Lokale API

Für Stream Deck, Skripte und Automationen gibt es eine HTTP-API, nur auf `127.0.0.1` und mit Token
(*Einstellungen › Lokale API*, Port 47615). Sie liest Status, Usage, Accounts, Projekte und Chats, legt
Chats an, sendet Prompts, unterbricht und meldet Änderungen an Chats und Limits als Server-Sent Events. Was es gibt, beschreibt
sie selbst: `http://127.0.0.1:47615/docs` zeigt alle Routen mit Parametern, Antworten und Beispielen,
`/openapi.json` dasselbe als OpenAPI 3.1 für Postman, Insomnia oder Codegeneratoren. Beide brauchen kein
Token und laden nichts aus dem Netz.

## Entwicklung

```powershell
npm install
npm run dev          # App mit Hot Reload (eigener Datenordner „Nexa Dev“)
npm run typecheck    # Main/Preload (tsc) und Renderer (vue-tsc)
npm test             # Unit-Tests (Vitest), liegen als *.test.ts neben dem Modul
npm run build:win    # Typecheck, Build, nx.exe und NSIS-Installer → release/<version>/
npm run build:linux  # unter Linux: Typecheck, Build, AppImage, deb und rpm → release/<version>/
```

`npx electron-builder --win --dir` erzeugt nur den entpackten Ordner `release/<version>/win-unpacked`, das
reicht zum schnellen Testen (vorher `npm run build` und einmal `npm run build:launcher`). Für das rpm-Paket
braucht es `rpmbuild` (Paket `rpm`). Ohne Linux-Rechner geht es z. B. in WSL oder im Container
`node:24-bookworm`.

Aufbau, Protokolle und offene Punkte: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/PROTOCOLS.md](docs/PROTOCOLS.md), [docs/ROADMAP.md](docs/ROADMAP.md).

### Releases

Jeder Push auf `main` startet [semantic-release](https://semantic-release.gitbook.io/)
(`.github/workflows/release.yml`). Es liest die Version aus den Commit-Nachrichten
([Conventional Commits](https://www.conventionalcommits.org/de/)). Mit ihr bauen ein Windows- und ein
Linux-Runner den Installer bzw. AppImage, deb und rpm, danach veröffentlicht semantic-release alles zusammen
mit den Versionshinweisen als GitHub-Release. Von dort holt sich die installierte App ihre Updates.

| Commit | Version | Versionshinweise |
| --- | --- | --- |
| `feat: …` | neue Minor-Version | „Neue Funktionen“ |
| `fix: …` | neue Patch-Version | „Fehlerbehebungen“ |
| `perf: …` | neue Patch-Version | „Schneller“ |
| `feat!: …` oder `BREAKING CHANGE:` im Text | neue Major-Version | |
| `docs:`, `ci:`, `build:`, `chore:`, `refactor:`, `style:`, `test:` | kein Release | nicht aufgeführt |

Pull Requests per Squash-Merge zusammenführen: Dann wird ihr Titel zur Commit-Nachricht und ihre
Beschreibung zum Text darunter. Deshalb prüft `pr-title.yml` den Titel, und `ci.yml` baut den Installer und
die Linux-Pakete einmal zur Probe. Die Version in `package.json` bleibt im Repository unverändert:
semantic-release setzt sie nur für den Build.

Der Titel nennt kurz, worum es geht, und trägt den wichtigsten Typ: `feat:`, sobald eine neue Funktion dabei
ist. Was in die Versionshinweise kommt, listet die Beschreibung unter `## Versionshinweise`, eine Änderung pro
Zeile (Vorlage: `.github/pull_request_template.md`). Jede Zeile wird ein eigener Punkt. Zeilen ohne Typ zählen
zum Typ des Titels, `fix: …` landet unter „Fehlerbehebungen“. `release.config.mjs` teilt die Liste auf
(`src/shared/release-notes.ts`). Ohne diese Liste wird der Titel zum Punkt, mehrere Änderungen darin trennt
`; `. In der App zeigt „Details“ unter einer Version den Rest der Beschreibung.
