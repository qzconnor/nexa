# Nexa

Desktop-App (Electron + Vue) für Chats mit CLI-Agenten, zum Start Claude Code und Codex. Die CLIs laufen
als Kindprozesse mit JSON-Streams, die Oberfläche rendert Nexa selbst. Befehl: `nx`.

## Regeln

- **Versionshinweise**: Releases macht semantic-release aus den Commits auf `main` (siehe README, „Releases“).
  Änderungen kommen als Pull Request mit Conventional-Commit-Titel (`feat:`, `fix:`, `perf:` bringen ein
  Release, `chore:`, `docs:`, `refactor:` & Co. nicht) und werden per Squash-Merge zusammengeführt. Was Nutzer
  sehen oder merken, steht in der PR-Beschreibung unter `## Versionshinweise`, eine Änderung pro Zeile, auf
  Deutsch (Vorlage `.github/pull_request_template.md`). `CHANGELOG.md` ist der Stand vor dem ersten Release
  und wird nicht mehr fortgeschrieben.
- **Sprache**: UI-Texte Deutsch (mit echten Umlauten und „Anführungszeichen“), Code-Kommentare Englisch.
  Kommentare erklären das Warum, nicht das Was.
- **Roadmap**: Was offen ist, steht in `docs/ROADMAP.md`; Erledigtes dort abhaken.
- Dateien mit dem Edit/Write-Werkzeug ändern, nicht mit PowerShell `Set-Content` (Kodierung) oder
  Python-Strings mit Backslashes (Escapes).

## Befehle

```sh
npm run dev            # Entwicklung mit Hot Reload (eigener Datenordner „Nexa Dev“)
npm run typecheck      # Main (tsc) und Renderer (vue-tsc)
npm test               # Vitest, Tests liegen als *.test.ts neben dem Modul
npm run build          # electron-vite build nach out/
npm run build:icons    # build/icon.svg → icon.png / icon.ico
npm run build:launcher # src/launcher/nx.cs → build/bin/nx.exe
npm run build:win      # Installer
```

Vor dem Abschluss einer Änderung: `npm run typecheck` und `npm test`.

## Aufbau

- `src/main` – Electron-Main: Services, Provider, MCP-Server, API, Fenster. Details in `docs/ARCHITECTURE.md`.
- `src/preload` – typisierte `window.api` (`NexaApi` aus `src/shared/ipc.ts`).
- `src/renderer/src` – Vue-UI: `components/chat` (Chat-Elemente), `components/render` (MCP-Elemente),
  `stores` (Pinia), `views`, `lib` (reine Helfer), `composables`.
- `src/shared` – Typen und Logik für beide Seiten: `chat.ts` (ChatItem-Modell), `providers.ts`,
  `render.ts` (Specs der Render-Werkzeuge), `ipc.ts` (Kanäle).
- Aliase: `@shared` → `src/shared`, `@` → `src/renderer/src`.

## Konventionen

- Neue CLI = neuer Ordner unter `src/main/providers/<id>/` mit `AgentProvider` und `AgentRun`, die das
  Protokoll der CLI auf `ChatItem`s abbilden. Die UI kennt nur `ChatItem`s, nie CLI-Formate.
- Protokolldetails (Nachrichten, Felder, Eigenheiten) in `docs/PROTOCOLS.md` festhalten.
- IPC nur über `handle()` in `src/main/ipc.ts` (prüft das Absenderfenster); neue Kanäle in
  `src/shared/ipc.ts` und `src/preload/index.ts`.
- Farben nur über Theme-Tokens (`--tool-*`, `--syn-*`, `--code-*`, Tailwind-Tokens), keine festen Werte.
