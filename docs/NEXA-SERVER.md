# nexa-server: Remote Control, PWA und Settings-Sync

Konzept vom 26.11.2026. Gebaut sind Phase 1, der Server (eigenes Repo `nexa-server`) mit der Kopplung in
der App (Einstellungen › Geräte), und Phase 2, Remote Control von Desktop zu Desktop. Was hier als **Ungeprüft** markiert ist, stammt aus Doku oder
Erinnerung, nicht aus einem Versuch.

## Ziel

- Nexa auf einem Rechner von einem anderen Gerät aus steuern: Chats sehen, Prompts senden, abbrechen,
  Berechtigungen und Rückfragen beantworten, neue Chats auf einer gewählten Instanz starten.
- Später vom Handy aus, als PWA.
- Einstellungen zwischen den eigenen Instanzen abgleichen.

## Entscheidungen

- **Kein zentraler Dienst.** Wer das Feature will, betreibt einen eigenen `nexa-server`. Nexa selbst bleibt
  ohne ihn vollständig.
- **Kein P2P.** Hinter VPN, NAT oder Firmen-Firewall ist ein Gerät oft nicht erreichbar. Beim Server bauen
  alle Geräte die Verbindung selbst nach außen auf (WSS auf 443), das geht fast überall.
- **Der Server ist blind.** Er leitet weiter und speichert, sieht aber nur Chiffretext. Remote Control heißt
  Code auf dem Host ausführen (die Agents haben eine Shell); wer den Server übernimmt, darf deshalb nicht an
  die Instanzen kommen. Auch der Admin eines geteilten Servers liest keine fremden Chats.
- **Ein Namespace ist ein Nutzer.** Ein Nutzer hat genau einen Namespace mit seinen Instanzen. Ein Server
  kann mehrere Namespaces halten (Familie, kleines Team), die nichts voneinander sehen.
- **Handy als PWA**, vom Server ausgeliefert. Native App vielleicht später.

## Aufbau

```
 Desktop (Host)          nexa-server                    Laptop (Host)
 Nexa + CLIs  ──WSS──>  ┌──────────────────────┐  <──WSS──  Nexa + CLIs
                         │ Namespace „connor“   │
 Handy (PWA)  ──WSS──>  │  Relay, Sync-Blobs   │
     ^                   │ Namespace „max“ …    │
     │                   └──────────┬───────────┘
     └──── Web Push (Apple/Google/Mozilla) <── VAPID, Inhalt verschlüsselt
```

## Namespaces und Instanzen

Was der Server kennt:

| Objekt | Felder |
|---|---|
| Namespace | Name, Speichergrenze, angelegt |
| Instanz | ID, Name („Desktop“), Rolle, öffentliche Schlüssel, zuletzt gesehen, Push-Abo (nur PWA) |
| Einladung | einmaliger Code, Namespace, läuft ab |
| Sync-Blob | Schlüssel, Version, Chiffretext |

- **Keine Konten mit Passwort.** Der Namespace ist der Nutzer; jede Instanz meldet sich mit ihrem eigenen
  Schlüssel an (Challenge signieren). Es gibt kein Passwort, das jemand abgreifen kann.
- **Rollen**: *Host* (Desktop, auf ihm laufen die CLIs, kann auch steuern) und *Steuerung* (PWA, steuert
  nur). Die Rolle steht von Anfang an im Protokoll, damit das Handy ohne Umbau dazukommt.
- **Namespace anlegen** macht der Admin auf dem Server, ohne Web-Oberfläche:
  `nexa-server namespace create connor` gibt einen einmaligen Einladungscode aus.
- **Instanz entfernen** geht von jeder anderen Instanz des Namespace aus (Liste der Geräte in den
  Einstellungen). Der Server trennt sie sofort; danach wechseln die übrigen den Schlüssel (siehe unten).

## Kopplung

1. **Erste Instanz**: Server-URL und Einladungscode eintragen (Einstellungen › Geräte). Nexa erzeugt den
   Schlüssel des Namespace und die eigenen Schlüssel und meldet die Instanz an.
2. **Jede weitere Instanz**: Auf einer gekoppelten Instanz „Gerät hinzufügen“. Sie holt beim Server eine
   neue Einladung (15 Minuten, einmal) und zeigt einen Kopplungscode (`nexa1:…`) mit URL, Einladung und
   Schlüssel des Namespace zum Kopieren; liefert der Server die PWA aus, dazu als QR-Code fürs Handy (siehe
   „PWA“). Die neue Instanz liest ihn und ist drin, sobald sie sich den anderen vorgestellt hat (siehe
   „Mitglieder und Schlüssel“).
3. Der Schlüssel steht nur im Kopplungscode, nie beim Server. Den Code zeigt nur ein Gerät, das schon
   dazugehört.

Gespeichert ist die Kopplung in `nexa-server.json`; die privaten Schlüssel und die des Namespace darin
verschlüsselt über `safeStorage`. Lassen sie sich nicht mehr entschlüsseln (anderes Benutzerkonto, neuer
Schlüsselbund), bleibt nur Abmelden und neu koppeln.

Wiederherstellung: Sind alle Instanzen weg, ist der Schlüssel weg und damit der Sync-Stand. Ein
**Wiederherstellungscode** kommt mit dem Settings-Sync; Remote Control verliert nichts, das hängt an den
Hosts.

## Mitglieder und Schlüssel

Der Server ist für Inhalte nicht vertrauenswürdig, auch nicht seine Liste der Instanzen: Er könnte eine
eigene hineinsetzen. Die Geräte halten sich deshalb an diese Regeln (die Hinweise für Clients im
`docs/PROTOCOL.md` von nexa-server; Formate in `PROTOCOLS.md`, „nexa-server“):

1. **Mitglied ist, wer den Schlüssel des Namespace hat.** Jedes Gerät führt seine eigene Liste
   anerkannter Instanzen. Ein neues Gerät stellt sich nach der Anmeldung mit einer Nachricht vor, die mit
   dem Schlüssel des Namespace verschlüsselt ist und seine ID und öffentlichen Schlüssel nennt; erst dann
   nehmen die anderen es auf. Neue Schlüssel bekommen nur anerkannte Instanzen. In der Geräteliste steht
   ein Gerät ohne Vorstellung als „Nicht bestätigt“, mit dem Grund, wenn seine Vorstellung verworfen
   wurde (Uhr falsch, anderer Schlüssel). Geht eine Vorstellung verloren, fragen die Geräte in
   wachsenden Abständen von selbst erneut.
2. **Kopfdaten mitverschlüsseln.** AES-GCM mit `from`, `to`, `kind` und `id` als Associated Data, damit der
   Server Chiffretext nicht umleiten oder als andere Art ausgeben kann. Jede `id` gilt nur einmal, und
   Nachrichten, deren Zeit mehr als 5 Minuten von der eigenen Uhr abweicht, gelten nicht. Die Uhren der
   Geräte müssen also stimmen; Nexa vergleicht die eigene beim Anmelden mit der des Servers und warnt ab
   1 Minute Abweichung.
3. **Absender prüfen.** `from` setzt der Server, und den Schlüssel des Namespace kennen alle Geräte. Deshalb
   signiert jedes Gerät jede Nachricht mit dem Schlüssel, mit dem es sich anmeldet (eigener
   Kontext-String), und der Empfänger prüft mit dem Schlüssel, den er für dieses Mitglied gespeichert hat.
   Darauf baut Remote Control mit Stufen je Gerät auf.
4. **Nach einer Entfernung den Schlüssel wechseln.** Das entfernte Gerät kennt den alten. Eines der übrigen
   macht einen neuen und schickt ihn jedem anderen Mitglied einzeln (ECDH der beiden). Wer dabei offline
   war, bekommt ihn beim nächsten Verbinden.

Bei 4401 (Anmeldung abgelehnt) und 4409 (eine zweite Verbindung derselben Instanz) verbindet Nexa sich
nicht von selbst neu, bei 4403 (entfernt) vergisst es die Kopplung.

## Verschlüsselung

- **Nur WebCrypto** (P-256, AES-GCM-256, HKDF): Node (`globalThis.crypto.subtle`) und Browser haben es
  beide. Damit liegt der Code einmal in `src/shared` und gilt für Desktop und PWA; in der PWA bleiben die
  Schlüssel nicht exportierbar in IndexedDB.
- **Schlüssel des Namespace** (symmetrisch, 256 Bit): verschlüsselt jede Nachricht und jeden Sync-Blob.
- **Schlüssel je Instanz**: ein Paar zum Signieren (Anmeldung beim Server), eins für ECDH (neuen Schlüssel des
  Namespace an genau diese Instanz schicken).
- **Schlüssel wechseln**: Wird eine Instanz entfernt, kennt sie den alten Schlüssel noch. Eine der übrigen
  erzeugt einen neuen und schickt ihn jeder anderen per ECDH; die Sync-Blobs werden neu verschlüsselt.
- **Was der Server trotzdem sieht**: wer mit wem, wann, wie groß. Das ist der Preis des Relays.

## Protokoll

- Versionierte JSON-Nachrichten über eine WebSocket-Verbindung je Instanz, unabhängig von Electron, damit
  Desktop, PWA und eine spätere App dasselbe sprechen. Was der Server spricht, steht im Repo nexa-server
  (`docs/PROTOCOL.md`); `protocol.ts` und `auth.ts` liegen als Kopie in `src/shared/nexa-server`.
- Für den Server sichtbar: `{ t: "send", id, to, kind, body }`; `body` ist verschlüsselt. `to` ist eine
  Instanz oder alle des Namespace (`*`).
- Der Server prüft nur: Instanz angemeldet, `to` im selben Namespace, Größe unter der Grenze. Ist `to` nicht
  verbunden, antwortet er mit „nicht erreichbar“; Nachrichten für Remote Control speichert er nicht.
- Was die Geräte in `body` vereinbaren (Verschlüsselung, Signatur, Arten), steht in `PROTOCOLS.md`.

## Remote Control

Von Desktop zu Desktop **gebaut** (Protokoll in `PROTOCOLS.md`, „Remote Control“).

- **Aus, bis man es einschaltet**, je Host (Einstellungen › Geräte › Fernsteuerung). Dazu je steuernder
  Instanz eine Stufe: *Aus*, *Nur mitlesen* (Vorgabe für Geräte ohne eigene Einstellung), *Prompts senden
  und Chats ordnen*, *Alles, wie am Gerät selbst*.
- Welche Geräte gerade die Chats eines Hosts offen haben, steht dort unter Einstellungen › Geräte ›
  Fernsteuerung, mit „Trennen“, das die Stufe des Geräts auf „Aus“ setzt.
- **In der Seitenleiste**: Auf der steuernden Seite stehen unter den eigenen Projekten die anderen Geräte
  mit ihren Projekten und Chats, bedient wie die eigenen; ein neuer Chat beginnt am Knopf des Geräts oder
  eines seiner Projekte. Der Server reicht dafür nur Nachrichten weiter (`rc.*`, große in Teilen
  `rc.part`); er muss nichts davon kennen.
- **Bausteine**: Die lokale API (`src/main/api/routes.ts`) kann schon Chats auflisten, anlegen, Prompt
  senden, abbrechen und Ereignisse streamen. Ihre Handler sollten Relay und REST gemeinsam nutzen. Neu
  dazu kommen:
  - Verlauf eines Chats lesen (`ChatItem`s), seitenweise vom Ende her. Der größte Chat hier hat 27 MB Items
    (`IDEAS.md`, P5/P7); ganz übertragen geht nicht, schon gar nicht aufs Handy.
  - Deltas laufender Chats, gebündelt (wie P6).
  - Antwort auf eine `InteractionItem` (Berechtigung, Rückfrage, Plan).
- Die UI kennt nur `ChatItem`s, deshalb zeigt die steuernde Seite Chats mit denselben Komponenten.

## PWA

Entschieden am 26.11.2026:

- **Ein Projekt mit dem Server.** Die PWA liegt im Repo `nexa-server`, wird mit ihm gebaut und liegt im
  selben Docker-Image. Der Server liefert sie unter `/app` aus, auf derselben Adresse wie `/v1/ws`. Nichts
  zu installieren, kein App Store.
- **Per Umgebungsvariable schaltbar** (`NEXA_PWA`, ab Werk aus). Die PWA hält die Schlüssel des Namespace,
  ihren Code liefert aber der Server: Wer ihn übernimmt, könnte eine veränderte PWA ausliefern und die
  Schlüssel abgreifen. Für die PWA ist der Server also nicht blind, anders als für die Desktops, deren Code
  aus der installierten App kommt. Wer sie nicht braucht, lässt sie aus. Später denkbar: dieselbe PWA unter
  einer festen, vom Server getrennten Adresse.
- **Eigene Oberfläche fürs Handy**, nicht die Komponenten der App (die hängen an Stores und `window.api`).
  Kopiert und gleich gehalten wie `protocol.ts`: die Themes (`shared/themes`), das Modell der Chats
  (`shared/chat.ts`), Remote Control (`shared/remote.ts`), Umschlag, Mitglieder und Kopplungscode
  (`shared/nexa-server`). Gleicher Look über dieselben Theme-Tokens; das Theme wählt man in der PWA.
- **Verbindung und Mitglieder aus der App**: Die PWA übernimmt `server-link/connection.ts`,
  `device-channel.ts`, `membership.ts` und `remote/remote-client.ts` aus `src/main` Byte für Byte
  (`scripts/sync-from-app.ts` in nexa-server), damit die Regeln für Mitglieder auf beiden Seiten gleich
  sind. Sie bleiben ohne Node-APIs, und relativ importieren sie nur, was die PWA selbst stellt:
  `TypedEmitter` ohne `node:events`, `Identity` (nur als Typ; die PWA hält die Schlüssel nicht exportierbar
  in IndexedDB) und den Fehler des Kanals. Ebenso `renderer/src/lib/tools.ts` (Blöcke der Zeitleiste,
  Zusammenfassungen der Werkzeuge), damit die PWA den Verlauf gruppiert wie die App: Importe nur aus
  `@shared/…`, `@lucide/vue` und `vue`, an Farben nur die `--tool-*`, die die PWA in ihrer
  `main.css` hat. Für Diffs wie in der App außerdem `lib/diff.ts`, `file-diff.ts`, `word-diff.ts`,
  `syntax.ts` mit `hljs-vue.ts` (highlight.js, Sprachen per `import()`) und
  `composables/useProjectPath.ts`; die Regeln für `.syntax`, `.diff-line` und `.diff-gutter` hat die PWA
  als Kopie in ihrer `main.css`. Für die offenen Pull Requests `lib/pull-requests.ts`. Das alles prüft
  `server-link/pwa-copies.test.ts`. Wer eine der Dateien verschiebt, einen
  Import oder eine `--tool-*`-Farbe dazunimmt, sagt es vorher im Chat „Nexa-Server“.
- **Aufbau**: unten eine Leiste mit „Inbox“ und „Chats“.
  - *Inbox* (Startseite): die Chats aller Rechner, die Aufmerksamkeit brauchen, in Abschnitten: „Wartet auf
    dich“ (Rückfrage, Freigabe, Plan, direkt dort beantwortbar), „Fehler und Limit“, „Fertig, ungelesen“,
    „Läuft gerade“.
  - *Chats*: Rechner, Projekte und Chats wie in der Seitenleiste; ein Chat als eigene Seite mit Eingabe.
- **Koppeln per QR-Code**: Der Code ist ein Link `<u>/app/#nexa1:…` (`webAppPairingLink`). `<u>` ist genau
  die Adresse aus dem Kopplungscode, denn die PWA vergleicht sie mit ihrer eigenen Herkunft und lehnt eine
  andere Schreibweise ab. Mit Schrägstrich, weil `/app` nur dorthin umleitet. Der Kopplungscode steht
  unverändert hinter dem `#`, der nie an den Server geht (er enthält den Schlüssel des Namespace). Die App
  fragt bei jedem „Gerät hinzufügen“ neben der Einladung `/v1/info` und zeigt den QR-Code nur bei
  `pwa: true`; scheitert die Frage, kommt der Code ohne ihn. Die PWA füllt Code und Gerätenamen vor,
  gekoppelt wird erst auf Knopfdruck.
- **Web Push mit VAPID**: Jeder Server erzeugt seine eigenen VAPID-Schlüssel und spricht die Push-Dienste
  von Apple, Google und Mozilla direkt an. Kein Entwicklerkonto, kein zentrales Gateway. Ungeprüft: iOS ab
  16.4, nur wenn die PWA auf dem Home-Bildschirm liegt.
- **Inhalt bleibt verschlüsselt**: Der Host versiegelt die Benachrichtigung für jedes Handy wie eine
  Nachricht zwischen Geräten (paarweiser Schlüssel, signiert, Kopfdaten als AAD, `DeviceChannel.sealed`).
  Nicht mit dem Schlüssel des Namespace: Der wechselt, wenn ein Gerät entfernt wird, und ein geschlossenes
  Handy hätte den neuen noch nicht; außerdem liest so nur das eine Handy mit. Der Server bekommt eine
  Anfrage `push` mit `to`, `kind` und dem versiegelten `body` und gibt dem Push-Dienst genau den JSON der
  Nachricht, die ein `send` weiterreichen würde (`{ t: "msg", id, from, to, kind, body }`). Der Service
  Worker öffnet sie mit demselben Code, prüft aber nicht mit dem `ReplayGuard`, denn Pushes kommen bis
  zu ihrer `ttl` später. Grenze 4 KB je Push (3993 Byte Nutzlast); Titel und Text sind auf 100 und 300
  Zeichen begrenzt, damit es auch in Zeichen zu drei Byte passt. Ungeprüft: Safari verlangt zu jedem Push
  eine sichtbare Benachrichtigung, stille Pushes gibt es nicht.
- **Inhalt** (`shared/push.ts`, die PWA übernimmt die Datei): `kind: "push.notify"`, Daten
  `{ v: 1, reason: "done" | "input" | "limit", chat, title, body }`, `chat` ist die Session-ID auf dem
  Rechner, der den Push geschickt hat (`from`). Ein Tipp öffnet `/app/chats/<from>/<chat>`.
- **Wann**: dieselben Anlässe und Texte wie die Benachrichtigungen auf dem Desktop (`NotificationSettings`,
  `chatAlert`): Antwort fertig (mit Mindestdauer), Rückfrage, Freigabe oder Plan, Limit. Dazu die
  Einstellung „Aufs Handy“ (`notifications.push`): aus, „Wenn du weg bist“ (Vorgabe: Bildschirm gesperrt
  oder `PUSH_AWAY_MINUTES` ohne Eingabe, `powerMonitor.getSystemIdleState`) oder immer. Rückfragen mit
  `urgency: "high"` und 24 Stunden `ttl`, sonst `normal` und eine Stunde.
- **An wen** (`pushPhones`): bestätigte Geräte mit der Rolle `controller`, wenn die Fernsteuerung an ist und
  ihre Stufe nicht „Aus“. Ein Push erzählt, was in einem Chat passiert; wer den Chat nicht sehen darf,
  bekommt keinen. Ob ein Handy Push eingeschaltet hat, weiß nur der Server; ohne Anmeldung antwortet er
  `unsubscribed`, und die App lässt es dabei.

Was die App als Host dafür hat (`PROTOCOLS.md`, „Remote Control“):

- Geräte mit der Rolle `controller` sind keine Rechner (`hasChats`): nicht in der Seitenleiste, keine
  Chats von ihnen, keine Ziele für `chat_*`.
- Den Lesestand je Chat auf dem Host (`finishedAt`, `seenAt`, `sessions:seen`), an alle Geräte gemeldet,
  damit „Fertig, ungelesen“ überall gleich ist.
- Den Stand für die Inbox in einer Antwort (`sessions:inbox`), mit den offenen Rückfragen.
- Den QR-Code unter „Gerät hinzufügen“ (siehe oben).
- Die Benachrichtigungen per Push (`server-link/push-notifier.ts`, siehe oben).

## Settings-Sync

- Speichern und später abholen, die Instanzen müssen nicht gleichzeitig online sein.
- Je Bereich ein Blob mit Version. Der Server nimmt eine Änderung nur zur erwarteten Version an (sonst
  holt die Instanz erst den neuen Stand und führt zusammen). Zusammenführen je Einstellung, die jüngste
  Änderung gewinnt.
- Ein Schalter je Bereich, was abgeglichen wird.

Erste Einteilung von `AppSettings` (`src/shared/types.ts`):

| Abgleichen | Nur auf diesem Gerät |
|---|---|
| `appearance` ohne `material`, `keepMaterialActive`, `zoom` | `general` (Tray, Autostart, `nx`, Beenden) |
| `chat` ohne `shell`, `voiceAccount`, `voiceMicrophone`, `keepLoginsFresh` | `api` (Port) |
| `tools` | `defaults.accounts`, `defaults.projectsFolder` |
| `notifications` | `<cli>.path`, `<cli>.extraArgs` |
| `defaults.provider`, `defaults.permissionMode` | `setup` |
| `<cli>.enabled`, `<cli>.model`, `<cli>.effort` | `material`, `zoom`, `shell`, Mikrofon, Accounts |

Später, nur wenn man es ausdrücklich wählt: eigene Themes (Dateien), globale MCP-Server (enthalten
Secrets), Berechtigungen und Hooks der CLIs. Logins und Tokens der Accounts nie.

## Server betreiben

- Node und TypeScript, damit Protokoll und Krypto aus `src/shared` geteilt werden.
- Ein Prozess, SQLite, WebSocket. Ein Docker-Image, dazu ein `docker-compose.yml` mit Caddy für HTTPS
  (Web Push und Service Worker brauchen HTTPS).
- Grenzen je Namespace: Speicher für Blobs, Größe einer Nachricht, Nachrichten je Sekunde, Verbindungen.
- Wer schon Tailscale oder Headscale nutzt, könnte ohne Server direkt zum Host. Das Protokoll sollte
  das nicht ausschließen.

## Reihenfolge

1. Server mit Namespaces, Einladungen, Instanzen und Relay; Kopplung zweier Desktops. **Gebaut.**
   Ungeprüft: hinter einem Proxy des Systems (der WebSocket von Node nutzt ihn nicht), und über HTTPS/WSS
   mit einem echten Zertifikat (getestet gegen den Server auf `localhost`).
2. Remote Control von Desktop zu Desktop. **Gebaut** (die anderen Geräte in der Seitenleiste, ihre Chats
   wie die eigenen bedient, mit Dock und neuen Chats, Bilder im Verlauf, die Werkzeuge `chat_*` über
   Geräte hinweg). Ungeprüft mit zwei echten Rechnern.
3. PWA als Steuerung (siehe „PWA“): Koppeln, Inbox mit Antworten, Chats lesen und Prompts senden, QR-Code
   **gebaut**; Web Push für fertige Antworten, Rückfragen und Limits in Arbeit (App und Server).
4. Settings-Sync.

## Offene Fragen

- Eigenes Repo `nexa-server` oder Monorepo mit `nexa-app`? Eigenes Repo, mit der PWA darin (siehe „PWA“);
  geteilter Code wird kopiert und gleich gehalten.
- Kann eine steuernde Instanz auch Dateien, Diffs und die Shell des Hosts sehen, oder zunächst nur Chats?
- Abgleich der Projekte: gleiche Projekte auf mehreren Rechnern erkennen (Git-Remote?), oder nie?
- Wie verhält sich die eigene Fernsteuerung von Claude Code (`remote-control`) und Codex (`remoteControl/*`)
  dazu: anbieten, ersetzen, ignorieren?
