import type { ProviderId } from '@shared/chat'
import type { CommandOption, ModelOption } from '@shared/types'
import { effortLabel } from './effort'

/**
 * Commands Nexa runs itself instead of sending them to the CLI. Run headless, the CLIs answer many of
 * their own with „isn't available in this environment“ (`/diff`, `/status`, `/help`), or do it out of
 * Nexa's sight (`/clear` starts a new conversation the chat knows nothing of); Codex's app-server
 * takes none at all. Nexa has a place of its own for most of them.
 */
export type AppCommandId =
  | 'clear'
  | 'new'
  | 'fork'
  | 'compact'
  | 'diff'
  | 'rewind'
  | 'rename'
  | 'model'
  | 'effort'
  | 'plan'
  | 'permissions'
  | 'mcp'
  | 'add-dir'
  | 'copy'
  | 'export'
  | 'status'
  | 'resume'
  | 'tasks'
  | 'usage'
  | 'login'
  | 'settings'
  | 'theme'
  | 'help'
  | 'exit'

export interface AppCommand {
  id: AppCommandId
  aliases?: string[]
  description: string
  argumentHint?: string
  /** Only for this CLI: the other one does it well itself (Claude Code's `/compact` and `/usage`). */
  only?: ProviderId
}

export const APP_COMMANDS: readonly AppCommand[] = [
  { id: 'clear', aliases: ['reset'], description: 'Kontext leeren: Der Chat bleibt mit Name und Pin, der Agent fängt neu an' },
  { id: 'new', description: 'Neuer Chat im selben Ordner mit denselben Einstellungen; dieser bleibt in der Seitenleiste' },
  { id: 'fork', aliases: ['branch'], argumentHint: '[Name]', description: 'Chat abzweigen: ein neuer Chat geht von hier aus weiter, dieser bleibt, wie er ist' },
  { id: 'compact', description: 'Kontext zusammenfassen, damit wieder Platz ist', only: 'codex' },
  { id: 'diff', description: 'Änderungen im Ordner des Chats zeigen (Git)' },
  { id: 'rewind', aliases: ['checkpoint'], description: 'Änderungen je Prompt zeigen und die Dateien auf den Stand vor einem Prompt zurückspulen' },
  { id: 'rename', argumentHint: '[Name]', description: 'Chat umbenennen' },
  { id: 'model', argumentHint: '[Modell]', description: 'Modell wählen' },
  { id: 'effort', argumentHint: '[Stufe]', description: 'Denkaufwand einstellen' },
  { id: 'plan', description: 'Planen an- oder ausschalten: der Agent liest nur und schlägt einen Plan vor' },
  { id: 'permissions', aliases: ['approvals'], description: 'Freigaben einstellen' },
  { id: 'mcp', description: 'Konnektoren (MCP-Server) an- und ausschalten' },
  { id: 'add-dir', argumentHint: '[Ordner]', description: 'Ordner hinzufügen, in dem der Agent auch arbeitet' },
  { id: 'copy', description: 'Letzte Antwort kopieren' },
  { id: 'export', description: 'Chat als Markdown speichern' },
  { id: 'status', description: 'CLI, Account, Modell, Ordner und Kontext des Chats' },
  { id: 'resume', aliases: ['continue'], description: 'Anderen Chat öffnen' },
  { id: 'tasks', aliases: ['bashes'], description: 'Shells des Chats zeigen' },
  { id: 'usage', aliases: ['cost'], description: 'Verbrauch und Limits', only: 'codex' },
  { id: 'login', aliases: ['logout'], description: 'Accounts verwalten und anmelden' },
  { id: 'settings', description: 'Einstellungen von Nexa' },
  { id: 'theme', description: 'Darstellung und Themes' },
  { id: 'help', description: 'Alle Befehle zeigen' },
  { id: 'exit', aliases: ['quit'], description: 'Chat beenden und zur Startseite; der nächste Prompt setzt ihn fort' },
]

/** The commands Nexa runs for a chat with this CLI. */
export function appCommands(provider: ProviderId): AppCommand[] {
  return APP_COMMANDS.filter((c) => !c.only || c.only === provider)
}

/** As the composer lists them. */
export function appCommandOptions(provider: ProviderId): CommandOption[] {
  return appCommands(provider).map((c) => ({
    name: c.id,
    description: c.description,
    argumentHint: c.argumentHint,
    aliases: c.aliases,
    kind: 'app',
    insert: `/${c.id}`,
  }))
}

/**
 * Nexa's commands first, then the CLI's; one of the CLI's that has the name of one of Nexa's (or of its
 * alias) is left out, Nexa's does it in its place.
 */
export function mergeCommands(app: readonly CommandOption[], cli: readonly CommandOption[]): CommandOption[] {
  const taken = new Set(app.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())))
  return [...app, ...cli.filter((c) => c.kind === 'skill' || !taken.has(c.name.toLowerCase()))]
}

/** The command a prompt is, when it is one of Nexa's: its first word, and what follows it. */
export function appCommandOf(text: string, provider: ProviderId): { command: AppCommand; args: string } | null {
  const match = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const name = match[1]!.toLowerCase()
  const command = appCommands(provider).find((c) => c.id === name || c.aliases?.includes(name))
  return command ? { command, args: (match[2] ?? '').trim() } : null
}

/**
 * The folder `/add-dir` names: in quotes or not, `~` for the user's folder, relative to the chat's
 * folder. The main process makes it whole (`..`) and checks that it is there.
 */
export function dirFromArg(arg: string, cwd: string, home?: string): string {
  const path = arg.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (home && (path === '~' || /^~[\\/]/.test(path))) return home + path.slice(1)
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(path)) return path
  const sep = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/, '')}${sep}${path}`
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')

/**
 * The model a name stands for: its id or label, else the one whose id or label holds it (`opus`,
 * `5.5`); null when none or several do.
 */
export function matchModel(models: readonly ModelOption[], query: string): ModelOption | null {
  const needle = norm(query)
  if (!needle) return null
  const exact = models.find((m) => norm(m.id) === needle || norm(m.label) === needle)
  if (exact) return exact
  const partial = models.filter((m) => norm(m.id).includes(needle) || norm(m.label).includes(needle))
  return partial.length === 1 ? partial[0]! : null
}

/** The level a word stands for, by the CLI's name or Nexa's (`hoch`); '' for the model's default; null for none. */
export function matchEffort(levels: readonly string[], query: string): string | null {
  const needle = norm(query)
  if (!needle) return null
  if (needle === 'standard' || needle === 'default' || needle === 'auto') return ''
  return levels.find((level) => norm(level) === needle || norm(effortLabel(level)) === needle) ?? null
}
