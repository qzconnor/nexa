import { hostname } from 'node:os'
import { keyIdOf, randomNamespaceKey } from '@shared/nexa-server/envelope'
import type { KeyRecord, Member } from '@shared/nexa-server/members'
import { decodePairingCode, encodePairingCode, isPairingCode, normalizeServerUrl, webSocketUrl } from '@shared/nexa-server/pairing-code'
import {
  isInstanceId,
  normalizeInstanceName,
  PROTOCOL_VERSION,
  type InstanceInfo,
  type JoinRequest,
  type RelayedMessage,
  type Role,
  type ServerLimits,
} from '@shared/nexa-server/protocol'
import { DEFAULT_SERVER_LIMITS } from '@shared/nexa-server/server-messages'
import { DEFAULT_REMOTE_LEVEL, type RemoteLevel } from '@shared/remote'
import { CLOCK_SKEW_WARN_MS, type DeviceInvite, type LinkedDevice, type PairInput, type ServerLinkState } from '@shared/server-link'
import { TypedEmitter } from '../lib/typed-emitter'
import { ServerConnection, ServerError, type SocketFactory, type StopReason } from './connection'
import { generateIdentity, importIdentity, LinkStore, type Identity, type LinkSecrets, type SecretCodec, type StoredLink } from './link-store'
import { DeviceChannel } from './device-channel'
import { Membership } from './membership'

export interface ServerLinkDeps {
  userDataDir: string
  defaultName?: string
  fetch?: typeof fetch
  socket?: SocketFactory
  codec?: SecretCodec
  log?: (message: string) => void
}

/** This device as the desktop app pairs it: CLIs run here, and it may control others. */
const ROLE: Role = 'host'
const HTTP_TIMEOUT_MS = 15_000
/** Online and offline of devices come often; they reach the disk in one write. */
const SAVE_DELAY_MS = 1_000
const CLOCK_CHECK_MS = 10_000

type Profile = Omit<StoredLink, 'version' | 'secrets' | 'members' | 'devices'>

interface Active {
  profile: Profile
  privateKeys: Pick<LinkSecrets, 'signKey' | 'dhKey'>
  identity: Identity
  devices: Map<string, InstanceInfo>
  membership: Membership
  connection: ServerConnection
  channel: DeviceChannel
  offs: (() => void)[]
  /** The user leaves the namespace: the close that follows is no removal by someone else. */
  leaving: boolean
  /**
   * The server's time at login and `performance.now()` then: the skew stays right when the user sets
   * the clock afterwards, which is the point of showing it.
   */
  clock: { server: number; mono: number } | null
  /** Checks the clock again while it is off, to notice when the user fixed it. */
  clockTimer: ReturnType<typeof setTimeout> | null
  /** What the server takes, as it said at login; its defaults until then. */
  limits: ServerLimits
}

type Events = {
  changed: [state: ServerLinkState]
  /** A member sealed this for this device alone (`DeviceChannel`), checked; `id` is the message's. */
  deviceMessage: [from: string, kind: string, id: string, data: unknown]
  /** The server couldn't pass on a message this device sent (its id), e.g. the other one isn't connected. */
  deviceSendFailed: [id: string, code: string]
  /** Another device connected or went (as the server says), or was removed (`online` false). */
  deviceStatus: [id: string, online: boolean]
  /** This device logged in (again): what it asked of others before may need asking anew. */
  connected: []
  /** Remote Control was turned on or off, or a device got another level. */
  remoteChanged: []
}

/**
 * The pairing of this device with a nexa-server (Einstellungen › Geräte): pairs with an invite or a
 * pairing code, keeps the connection, the list of devices and who of them is a member, and stores it all
 * in `nexa-server.json` with the keys encrypted. Off until paired; without a server nothing runs.
 */
export class ServerLinkService extends TypedEmitter<Events> {
  private readonly store: LinkStore
  private readonly fetch: typeof fetch
  private readonly defaultName: string
  private active: Active | null = null
  /** Paired, but the keys don't decrypt: shown with its error until the user forgets it. */
  private locked: StoredLink | null = null
  private error: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> = Promise.resolve()
  private forgetting: Promise<void> | null = null
  private busy = false

  constructor(private readonly deps: ServerLinkDeps) {
    super()
    this.store = new LinkStore(deps.userDataDir, deps.codec)
    this.fetch = deps.fetch ?? globalThis.fetch
    this.defaultName = normalizeInstanceName(deps.defaultName ?? hostname()) ?? 'Nexa'
  }

  async init(): Promise<void> {
    const loaded = await this.store.load()
    if (loaded.kind === 'locked') {
      this.locked = loaded.link
      this.error =
        'Die Schlüssel der Kopplung lassen sich nicht mehr entschlüsseln, etwa nach einem Wechsel des Benutzerkontos. Melde das Gerät ab und kopple es neu.'
    } else if (loaded.kind === 'ok') {
      const { link, secrets } = loaded
      const profile: Profile = {
        url: link.url,
        namespace: link.namespace,
        instance: link.instance,
        name: link.name,
        role: link.role,
        signKey: link.signKey,
        dhKey: link.dhKey,
        paused: link.paused,
        remote: link.remote,
      }
      const active = await this.activate(profile, { signKey: secrets.signKey, dhKey: secrets.dhKey }, secrets.keys, link.members, link.devices)
      if (!profile.paused) active.connection.start()
    }
    this.changed()
  }

  getState(): ServerLinkState {
    const base = { error: this.error, defaultName: this.defaultName, retryAt: null, locked: false }
    if (this.locked) {
      const members = new Set(this.locked.members.map((m) => m.id))
      return {
        ...base,
        locked: true,
        status: 'stopped',
        url: this.locked.url,
        namespace: this.locked.namespace,
        instance: this.locked.instance,
        name: this.locked.name,
        clockSkew: null,
        remoteEnabled: false,
        devices: deviceList(this.locked.devices, this.locked.instance, false, (id) => ({ trusted: members.has(id), issue: null, level: 'off' })),
      }
    }
    const active = this.active
    if (!active) {
      return { ...base, status: 'unpaired', url: null, namespace: null, instance: null, name: null, clockSkew: null, remoteEnabled: false, devices: [] }
    }
    const { profile, connection, membership } = active
    const online = !profile.paused && connection.status === 'online'
    return {
      ...base,
      status: profile.paused ? 'paused' : connection.status,
      retryAt: connection.status === 'offline' ? connection.retryAt : null,
      url: profile.url,
      namespace: profile.namespace,
      instance: profile.instance,
      name: profile.name,
      clockSkew: online ? clockSkew(active) : null,
      remoteEnabled: profile.remote.enabled,
      devices: deviceList([...active.devices.values()], profile.instance, online, (id) => {
        const trusted = membership.isMember(id)
        const level = id === profile.instance ? 'off' : (profile.remote.levels[id] ?? DEFAULT_REMOTE_LEVEL)
        return { trusted, issue: trusted ? null : membership.issueOf(id), level }
      }),
    }
  }

  /**
   * Pairs this device: with the invite of the server's admin it is the first of its namespace and makes
   * the namespace's key; with the pairing code of a paired device it takes that one's key.
   */
  async pair(input: PairInput): Promise<ServerLinkState> {
    if (this.active || this.locked) throw new Error('Dieses Gerät ist schon gekoppelt. Melde es zuerst ab.')
    if (this.busy) throw new Error('Die Kopplung läuft schon.')
    this.busy = true
    try {
      const code = input.code.trim()
      const fromCode = decodePairingCode(code)
      if (isPairingCode(code) && !fromCode) throw new Error('Der Kopplungscode ist unvollständig oder beschädigt. Kopiere ihn noch einmal.')
      const url = fromCode?.url ?? serverUrl(input.url)
      const invite = fromCode?.invite ?? code
      if (!invite) throw new Error('Gib den Einladungscode des Servers oder den Kopplungscode eines Geräts ein.')
      const name = normalizeInstanceName(input.name)
      if (name === null) throw new Error('Der Name des Geräts braucht 1 bis 64 Zeichen, ohne Steuerzeichen.')

      await this.probe(url)
      const { identity, secrets } = await generateIdentity()
      const joined = await this.join(url, { invite, name, role: ROLE, signKey: identity.signKey, dhKey: identity.dhKey })
      const raw = fromCode?.key ?? randomNamespaceKey()
      const key: KeyRecord = { gen: fromCode ? fromCode.gen : 1, id: await keyIdOf(raw), raw, createdAt: Date.now() }
      const profile: Profile = {
        url,
        namespace: joined.namespace,
        instance: joined.instance,
        name,
        role: ROLE,
        signKey: identity.signKey,
        dhKey: identity.dhKey,
        paused: false,
        remote: { enabled: false, levels: {} },
      }
      this.error = null
      const active = await this.activate(profile, secrets, [key], [], [], identity)
      await this.saveNow()
      active.connection.start()
      this.changed()
      return this.getState()
    } finally {
      this.busy = false
    }
  }

  /** A pairing code for the next device: a new invite of the server and the namespace's key. */
  async invite(): Promise<DeviceInvite> {
    const active = this.online()
    const answer = await this.request(active, { t: 'invite' })
    if (answer.t !== 'invite') throw new Error('Der Server hat keine Einladung geschickt.')
    const key = active.membership.currentKey
    return { code: encodePairingCode({ url: active.profile.url, invite: answer.code, key: key.raw, gen: key.gen }), expiresAt: answer.expiresAt }
  }

  async rename(instance: string | null, name: string): Promise<void> {
    const active = this.online()
    const normalized = normalizeInstanceName(name)
    if (normalized === null) throw new Error('Der Name braucht 1 bis 64 Zeichen, ohne Steuerzeichen.')
    const target = instance === null || instance === active.profile.instance ? undefined : instance
    await this.request(active, target === undefined ? { t: 'rename', name: normalized } : { t: 'rename', instance: target, name: normalized })
  }

  async remove(instance: string): Promise<void> {
    const active = this.online()
    if (instance === active.profile.instance) throw new Error('Dieses Gerät meldest du mit „Abmelden“ ab.')
    await this.request(active, { t: 'remove', instance })
  }

  /** Leaves the namespace. Offline the server keeps this device in its list until another removes it. */
  async unpair(): Promise<void> {
    if (this.locked) {
      this.locked = null
      this.error = null
      await this.store.clear()
      this.changed()
      return
    }
    const active = this.active
    if (!active) return
    // The server closes with 4403 right after its answer, which would read as a removal by someone else.
    active.leaving = true
    if (active.connection.status === 'online') {
      try {
        await active.connection.request({ t: 'remove', instance: active.profile.instance })
      } catch (error) {
        // Gone at the server already, or it doesn't answer: this device forgets it anyway.
        this.deps.log?.(`unpair: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.forget(null)
  }

  async connect(): Promise<void> {
    const active = this.active
    if (!active) return
    this.error = null
    if (active.profile.paused) {
      active.profile.paused = false
      await this.saveNow()
    }
    if (active.connection.status === 'offline') active.connection.retryNow()
    else active.connection.start()
    this.changed()
  }

  async disconnect(): Promise<void> {
    const active = this.active
    if (!active) return
    active.profile.paused = true
    active.connection.stop('user')
    await this.saveNow()
    this.changed()
  }

  // --- For Remote Control (main/remote) -----------------------------------------------------------

  /**
   * Seals `data` for the member `to` alone and relays it: the message's id (an answer names it), or null
   * when this device isn't connected or `to` isn't a member. Throws `MessageTooLargeError`.
   */
  sendToDevice(to: string, kind: string, data: unknown): Promise<string | null> {
    const active = this.active
    if (!active || active.connection.status !== 'online') return Promise.resolve(null)
    return active.channel.send(to, kind, data)
  }

  /** This device in the namespace, while paired. */
  self(): { instance: string; name: string } | null {
    const profile = this.active?.profile
    return profile ? { instance: profile.instance, name: profile.name } : null
  }

  /** Another device as the server lists it, and whether it is a member here. */
  device(id: string): { name: string; online: boolean; trusted: boolean } | null {
    const active = this.active
    const info = active?.devices.get(id)
    if (!active || !info) return null
    return { name: info.name, online: active.connection.status === 'online' && info.online, trusted: active.membership.isMember(id) }
  }

  /** What this device lets `id` do: nothing while Remote Control is off, nor for a device that isn't a member. */
  remoteLevel(id: string): RemoteLevel {
    const active = this.active
    if (!active?.profile.remote.enabled || id === active.profile.instance || !active.membership.isMember(id)) return 'off'
    return active.profile.remote.levels[id] ?? DEFAULT_REMOTE_LEVEL
  }

  remoteEnabled(): boolean {
    return !!this.active?.profile.remote.enabled
  }

  /** What the server takes (size of a message, messages per second), as it said at the last login. */
  limits(): ServerLimits {
    return this.active?.limits ?? DEFAULT_SERVER_LIMITS
  }

  /** Lets the other devices in (each with its level) or no one. */
  async setRemoteEnabled(on: boolean): Promise<void> {
    const active = this.paired()
    active.profile.remote = { ...active.profile.remote, enabled: on }
    await this.saveNow()
    this.changed()
    this.emit('remoteChanged')
  }

  async setRemoteLevel(id: string, level: RemoteLevel): Promise<void> {
    const active = this.paired()
    if (id === active.profile.instance) throw new Error('Dieses Gerät steuert sich nicht selbst.')
    active.profile.remote = { ...active.profile.remote, levels: { ...active.profile.remote.levels, [id]: level } }
    await this.saveNow()
    this.changed()
    this.emit('remoteChanged')
  }

  /** After the computer woke up: the connection is likely gone, and waiting for the next attempt helps nobody. */
  retryNow(): void {
    this.active?.connection.retryNow()
  }

  async dispose(): Promise<void> {
    const active = this.active
    if (!active) return
    for (const off of active.offs) off()
    this.stopClockWatch(active)
    active.membership.dispose()
    active.connection.stop('user')
    if (this.saveTimer) await this.saveNow()
    await this.saving
  }

  private async activate(
    profile: Profile,
    privateKeys: Pick<LinkSecrets, 'signKey' | 'dhKey'>,
    keys: KeyRecord[],
    members: Member[],
    devices: InstanceInfo[],
    identity?: Identity,
  ): Promise<Active> {
    const id = identity ?? (await importIdentity(privateKeys, { signKey: profile.signKey, dhKey: profile.dhKey }))
    const connection = new ServerConnection({
      url: webSocketUrl(profile.url),
      instance: profile.instance,
      signKey: id.signPrivate,
      socket: this.deps.socket,
      log: this.deps.log,
    })
    const membership = new Membership({
      instance: profile.instance,
      identity: id,
      keys,
      members,
      send: (to, kind, msgId, body) => connection.send(to, kind, msgId, body),
      persist: () => this.scheduleSave(),
      changed: () => this.changed(),
      clockSkew: () => clockSkew(active),
      log: this.deps.log,
    })
    const channel = new DeviceChannel({
      instance: profile.instance,
      identity: id,
      member: (memberId) => membership.member(memberId),
      send: (to, kind, msgId, body) => connection.send(to, kind, msgId, body),
      maxMessageBytes: () => active.limits.maxMessageBytes,
    })
    const active: Active = {
      profile,
      privateKeys,
      identity: id,
      devices: new Map(devices.map((d) => [d.id, d])),
      membership,
      connection,
      channel,
      offs: [],
      leaving: false,
      clock: null,
      clockTimer: null,
      limits: DEFAULT_SERVER_LIMITS,
    }
    active.offs.push(
      connection.on('status', () => this.changed()),
      connection.on('ready', (ready) => {
        active.devices = new Map(ready.instances.map((d) => [d.id, d]))
        active.limits = ready.limits
        const self = active.devices.get(profile.instance)
        if (self) profile.name = self.name
        // The server stamps this device's `lastSeen` at login, just before `ready`: its clock, give or take the trip.
        active.clock = self?.lastSeen ? { server: self.lastSeen, mono: performance.now() } : null
        this.watchClock(active)
        this.scheduleSave()
        void membership.ready(ready.instances)
        this.changed()
        this.emit('connected')
      }),
      connection.on('relayed', (msg) => {
        if (msg.kind.startsWith('rc.')) void this.onDeviceMessage(active, msg)
        else void membership.receive(msg)
      }),
      connection.on('sendFailed', (msgId, error) => this.emit('deviceSendFailed', active.channel.messageOf(msgId), error.code)),
      connection.on('instance', (event) => {
        if (event.t === 'removed') {
          active.devices.delete(event.instance)
          void membership.removed(event.instance)
          this.emit('deviceStatus', event.instance, false)
        } else {
          const before = active.devices.get(event.instance.id)
          active.devices.set(event.instance.id, event.instance)
          membership.instanceChanged(event.instance)
          if (event.instance.id === profile.instance) profile.name = event.instance.name
          if (before?.online !== event.instance.online) this.emit('deviceStatus', event.instance.id, event.instance.online)
        }
        this.scheduleSave()
        this.changed()
      }),
      connection.on('stopped', (reason) => void this.onStopped(active, reason)),
    )
    this.active = active
    return active
  }

  private async onDeviceMessage(active: Active, msg: RelayedMessage): Promise<void> {
    try {
      const opened = await active.channel.receive(msg)
      if (opened && this.active === active) this.emit('deviceMessage', msg.from, opened.kind, opened.id, opened.data)
    } catch (error) {
      this.deps.log?.(`device message: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async onStopped(active: Active, reason: StopReason): Promise<void> {
    if (this.active !== active || reason === 'user') return
    if (reason === 'removed') {
      await this.forget(
        active.leaving
          ? null
          : 'Dieses Gerät wurde aus dem Namespace entfernt, von einem anderen Gerät oder vom Admin des Servers. Um es wieder zu verbinden, kopple es neu.',
      )
      return
    }
    this.error = stopMessage(reason)
    this.changed()
  }

  /** Drops the pairing; a second call while it runs waits for the same. */
  private forget(error: string | null): Promise<void> {
    if (this.forgetting) return this.forgetting
    const active = this.active
    if (!active) return Promise.resolve()
    this.active = null
    this.error = error
    for (const off of active.offs) off()
    this.stopClockWatch(active)
    active.membership.dispose()
    active.connection.stop('user')
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.forgetting = this.saving
      .catch(() => undefined)
      .then(() => this.store.clear())
      .finally(() => {
        this.forgetting = null
        this.changed()
      })
    return this.forgetting
  }

  /**
   * While this device's clock is off, checks it again now and then. Once it is right, the window learns
   * it at once, and the devices that dropped this one's hello get a new one instead of waiting for the
   * next retry.
   */
  private watchClock(active: Active): void {
    this.stopClockWatch(active)
    const off = (skew: number | null) => skew !== null && Math.abs(skew) >= CLOCK_SKEW_WARN_MS
    if (!off(clockSkew(active))) return
    let shown = Math.round(clockSkew(active)! / 60_000)
    const check = () => {
      active.clockTimer = null
      if (this.active !== active || active.connection.status !== 'online') return
      const skew = clockSkew(active)
      if (!off(skew)) {
        this.changed()
        active.membership.askAgain()
        return
      }
      const minutes = Math.round(skew! / 60_000)
      if (minutes !== shown) {
        shown = minutes
        this.changed()
      }
      active.clockTimer = setTimeout(check, CLOCK_CHECK_MS)
    }
    active.clockTimer = setTimeout(check, CLOCK_CHECK_MS)
  }

  private stopClockWatch(active: Active): void {
    if (active.clockTimer) clearTimeout(active.clockTimer)
    active.clockTimer = null
  }

  private paired(): Active {
    const active = this.active
    if (!active) throw new Error('Dieses Gerät ist mit keinem Server gekoppelt.')
    return active
  }

  private online(): Active {
    const active = this.active
    if (!active) throw new Error('Dieses Gerät ist mit keinem Server gekoppelt.')
    if (active.connection.status !== 'online') throw new Error('Dafür muss Nexa mit dem Server verbunden sein.')
    return active
  }

  private async request(active: Active, request: Parameters<ServerConnection['request']>[0]) {
    try {
      return await active.connection.request(request)
    } catch (error) {
      throw new Error(error instanceof ServerError ? requestMessage(error) : String(error))
    }
  }

  /** Whether a nexa-server with this protocol answers at `url`. */
  private async probe(url: string): Promise<void> {
    let response: Response
    try {
      response = await this.fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
    } catch {
      throw new Error('Der Server ist nicht erreichbar. Stimmt die Adresse, und läuft er?')
    }
    const info = (await response.json().catch(() => null)) as { name?: unknown; protocol?: unknown } | null
    if (!response.ok || info?.name !== 'nexa-server') throw new Error('Unter dieser Adresse läuft kein nexa-server.')
    if (info.protocol !== PROTOCOL_VERSION) {
      const newer = typeof info.protocol === 'number' && info.protocol > PROTOCOL_VERSION
      throw new Error(`Der Server spricht eine andere Version des Protokolls. Aktualisiere ${newer ? 'Nexa' : 'den Server'}.`)
    }
  }

  private async join(url: string, request: JoinRequest): Promise<{ namespace: string; instance: string }> {
    let response: Response
    try {
      response = await this.fetch(`${url}/v1/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
    } catch {
      throw new Error('Der Server ist nicht erreichbar. Stimmt die Adresse, und läuft er?')
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
    if (response.status === 201 && data && typeof data.namespace === 'string' && isInstanceId(data.instance)) {
      return { namespace: data.namespace, instance: data.instance }
    }
    throw new Error(joinMessage(typeof data?.error === 'string' ? data.error : null, response.status))
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveNow().catch((error: unknown) => this.deps.log?.(`save: ${error instanceof Error ? error.message : String(error)}`))
    }, SAVE_DELAY_MS)
  }

  /** Writes the pairing now; one write after the other, so the newest state is the last. */
  private saveNow(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const active = this.active
    if (!active) return this.saving
    const link = {
      ...active.profile,
      members: active.membership.allMembers,
      devices: [...active.devices.values()],
    }
    const secrets: LinkSecrets = { ...active.privateKeys, keys: active.membership.allKeys }
    const next = this.saving.catch(() => undefined).then(() => (this.active === active ? this.store.save(link, secrets) : undefined))
    this.saving = next
    return next
  }

  private changed(): void {
    this.emit('changed', this.getState())
  }
}

function serverUrl(input: string): string {
  const result = normalizeServerUrl(input)
  if ('error' in result) throw new Error(result.error)
  return result.url
}

/** This device's clock minus the server's now, from the time the server gave at login. */
function clockSkew(active: Active): number | null {
  const clock = active.clock
  return clock ? Date.now() - (clock.server + performance.now() - clock.mono) : null
}

/**
 * This device first, then the others by name. Without a connection nobody counts as online: the last
 * list can't say who still is.
 */
function deviceList(
  devices: readonly InstanceInfo[],
  self: string,
  connected: boolean,
  trust: (id: string) => Pick<LinkedDevice, 'trusted' | 'issue' | 'level'>,
): LinkedDevice[] {
  return devices
    .map((d) => ({
      id: d.id,
      name: d.name,
      role: d.role,
      online: connected && (d.id === self || d.online),
      lastSeen: d.lastSeen,
      createdAt: d.createdAt,
      self: d.id === self,
      ...trust(d.id),
    }))
    .sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name, 'de'))
}

function stopMessage(reason: Exclude<StopReason, 'user' | 'removed'>): string {
  switch (reason) {
    case 'auth-failed':
      return 'Der Server hat die Anmeldung dieses Geräts abgelehnt. Kennt er es noch? Sonst melde es ab und kopple es neu.'
    case 'replaced':
      return 'Dieses Gerät hat sich ein zweites Mal mit dem Server verbunden, etwa aus einer anderen Nexa mit denselben Daten. Damit beide sich nicht ständig verdrängen, verbindet sich diese hier nicht von selbst neu.'
    case 'protocol':
      return 'Der Server spricht eine andere Version des Protokolls. Aktualisiere Nexa oder den Server.'
  }
}

function joinMessage(code: string | null, status: number): string {
  switch (code) {
    case 'invite-invalid':
      return 'Der Code ist ungültig, schon benutzt oder abgelaufen. Lass dir einen neuen geben.'
    case 'namespace-full':
      return 'Im Namespace sind schon so viele Geräte, wie der Server erlaubt. Entferne erst eins.'
    case 'bad-request':
      return 'Der Server hat die Kopplung abgelehnt (ungültige Anfrage).'
    default:
      return `Die Kopplung ist fehlgeschlagen (HTTP ${status}).`
  }
}

function requestMessage(error: ServerError): string {
  switch (error.code) {
    case 'offline':
      return 'Die Verbindung zum Server ist abgerissen. Versuch es gleich noch einmal.'
    case 'timeout':
      return 'Der Server hat nicht geantwortet.'
    case 'unknown-instance':
      return 'Dieses Gerät kennt der Server nicht (mehr).'
    case 'rate-limited':
    case 'busy':
      return 'Der Server ist gerade ausgelastet. Versuch es gleich noch einmal.'
    case 'bad-request':
      return 'Der Server hat die Anfrage abgelehnt.'
    default:
      return 'Fehler im Server.'
  }
}
