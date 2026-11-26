# nexa-server: Remote Control, PWA und Settings-Sync

Konzept vom 26.11.2026. Gebaut ist Phase 1: der Server (eigenes Repo `nexa-server`) und die Kopplung in
der App (Einstellungen › Geräte). Was hier als **Ungeprüft** markiert ist, stammt aus Doku oder
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
   Schlüssel des Namespace zum Kopieren; fürs Handy später als QR-Code. Die neue Instanz liest ihn und ist
   drin, sobald sie sich den anderen vorgestellt hat (siehe „Mitglieder und Schlüssel“).
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

- **Aus, bis man es einschaltet**, je Host. Dazu je steuernder Instanz eine Stufe: *nur mitlesen*,
  *Prompts senden und abbrechen*, *Berechtigungen und Rückfragen beantworten*.
- Wird ein Host gerade gesteuert, zeigt er das (Leiste mit Name des Geräts und „Trennen“).
- **Instanz wählen**: Auf der steuernden Seite stehen Projekte und Chats je Instanz. Ein neuer Chat fragt
  zuerst nach der Instanz, dann nach deren Projekten.
- **Bausteine**: Die lokale API (`src/main/api/routes.ts`) kann schon Chats auflisten, anlegen, Prompt
  senden, abbrechen und Ereignisse streamen. Ihre Handler sollten Relay und REST gemeinsam nutzen. Neu
  dazu kommen:
  - Verlauf eines Chats lesen (`ChatItem`s), seitenweise vom Ende her. Der größte Chat hier hat 27 MB Items
    (`IDEAS.md`, P5/P7); ganz übertragen geht nicht, schon gar nicht aufs Handy.
  - Deltas laufender Chats, gebündelt (wie P6).
  - Antwort auf eine `InteractionItem` (Berechtigung, Rückfrage, Plan).
- Die UI kennt nur `ChatItem`s, deshalb zeigt die steuernde Seite Chats mit denselben Komponenten.

## PWA

- Der `nexa-server` liefert sie aus (`/app`). Nichts zu installieren, kein App Store.
- Sie nutzt die Chat-Komponenten aus `src/renderer/src`. Diese Komponenten erwarten `window.api`; die PWA
  bekommt dafür eine Umsetzung von `NexaApi` über das Relay, beschränkt auf das, was Chats brauchen.
- **Web Push mit VAPID**: Jeder Server erzeugt seine eigenen VAPID-Schlüssel und spricht die Push-Dienste
  von Apple, Google und Mozilla direkt an. Kein Entwicklerkonto, kein zentrales Gateway. Ungeprüft: iOS ab
  16.4, nur wenn die PWA auf dem Home-Bildschirm liegt.
- **Inhalt bleibt verschlüsselt**: Der Host verschlüsselt den Text der Benachrichtigung mit dem Schlüssel des
  Namespace, der Server reicht ihn als Push-Nutzlast weiter, der Service Worker entschlüsselt und zeigt ihn.
  Grenze etwa 4 KB je Push. Ungeprüft: Safari verlangt zu jedem Push eine sichtbare Benachrichtigung,
  stille Pushes gibt es nicht.
- Anlass für Push wie bei den Benachrichtigungen auf dem Desktop (`NotificationSettings`): Antwort fertig,
  wartet auf Bestätigung, Limit.

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
2. Remote Control von Desktop zu Desktop.
3. PWA als Steuerung, mit Web Push für Rückfragen und Berechtigungen.
4. Settings-Sync.

## Offene Fragen

- Eigenes Repo `nexa-server` oder Monorepo mit `nexa-app`? Vorerst eigenes Repo; Protokoll und Anmeldung
  sind in die App kopiert. Mit der PWA (geteilte Chat-Komponenten) stellt sich die Frage neu.
- Wird die PWA im Repo von Nexa gebaut und ins Image des Servers kopiert, oder im Server-Repo?
- Kann eine steuernde Instanz auch Dateien, Diffs und die Shell des Hosts sehen, oder zunächst nur Chats?
- Abgleich der Projekte: gleiche Projekte auf mehreren Rechnern erkennen (Git-Remote?), oder nie?
- Wie verhält sich die eigene Fernsteuerung von Claude Code (`remote-control`) und Codex (`remoteControl/*`)
  dazu: anbieten, ersetzen, ignorieren?
