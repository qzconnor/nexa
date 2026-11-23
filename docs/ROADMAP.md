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

## Als Nächstes

- [ ] **Automatischer Account-Wechsel bei erreichtem Limit** (wie „Account wechseln“ im Claude Manager):
      Chat mit dem nächsten freien Account derselben CLI fortsetzen, Reihenfolge einstellbar.
- [ ] **Accounts sortieren** per Drag & Drop und Account in der Sidebar am Chat anzeigen.
- [ ] **Bestehende CLI-Sessions importieren** ohne Claude Manager (`~/.claude/projects`, `~/.codex/sessions`);
  aus dem Claude Manager geht es schon (siehe oben), der Transkript-Leser für Claude ist da.
- [ ] **Modellnamen**: „Default“ durch das tatsächliche Standardmodell der CLI ersetzen.
- [ ] **Automatische Titel** für Sessions über das Modell statt der ersten Zeile.
- [ ] **Systemfarben**: `nativeTheme` folgt dem Modus des Themes (hell/dunkel).
- [ ] **Einstellungen der CLIs** im UI (MCP-Server, Berechtigungen, Hooks) lesen und bearbeiten.
- [ ] Slash-Befehle und Skills der CLIs in der Eingabe (`/`-Menü).

## Später

- [ ] Weitere CLIs (z. B. Gemini CLI) über das Provider-System.
- [ ] Mehrere Fenster bzw. Session in eigenem Fenster.
