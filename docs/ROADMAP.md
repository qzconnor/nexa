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
- [x] Releases wie im Claude Manager: semantic-release auf `main`, Installer für Windows (mit `nx` im PATH),
      AppImage/deb/rpm für Linux, Auto-Update mit Versionshinweisen in den Einstellungen

## Als Nächstes

- [ ] **Automatischer Account-Wechsel bei erreichtem Limit** (wie „Account wechseln“ im Claude Manager):
      Chat mit dem nächsten freien Account derselben CLI fortsetzen, Reihenfolge einstellbar.
- [ ] **Accounts sortieren** per Drag & Drop und Account in der Sidebar am Chat anzeigen.
- [ ] **Bestehende CLI-Sessions importieren** (`~/.claude/projects`, `~/.codex/sessions`).
- [ ] **Modellnamen**: „Default“ durch das tatsächliche Standardmodell der CLI ersetzen.
- [ ] **Automatische Titel** für Sessions über das Modell statt der ersten Zeile.
- [ ] **Systemfarben**: `nativeTheme` folgt dem Modus des Themes (hell/dunkel).
- [ ] **Einstellungen der CLIs** im UI (MCP-Server, Berechtigungen, Hooks) lesen und bearbeiten.
- [ ] Slash-Befehle und Skills der CLIs in der Eingabe (`/`-Menü).

## Später

- [ ] Weitere CLIs (z. B. Gemini CLI) über das Provider-System.
- [ ] Mehrere Fenster bzw. Session in eigenem Fenster.
