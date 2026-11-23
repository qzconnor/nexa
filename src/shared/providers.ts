import type { PermissionMode, ProviderId } from './chat'

/**
 * What Nexa knows of each CLI without asking it. The models come from the CLI itself at runtime
 * (Claude: `initialize`, Codex: `model/list`); these are only shown until it answered.
 *
 * A further CLI: an id in `ProviderId`, an entry here, and a provider in `src/main/providers/<id>`
 * that implements `AgentProvider` (see docs/ARCHITECTURE.md).
 */
export interface ProviderMeta {
  id: ProviderId
  name: string
  short: string
  command: string
  /** Where to get the CLI. */
  installUrl: string
  installHint: string
  loginCommand: string
  permissionModes: PermissionMode[]
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    short: 'Claude',
    command: 'claude',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    installHint: 'irm https://claude.ai/install.ps1 | iex',
    loginCommand: 'claude auth login',
    permissionModes: ['ask', 'edits', 'plan', 'auto', 'full'],
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    short: 'Codex',
    command: 'codex',
    installUrl: 'https://github.com/openai/codex',
    installHint: 'npm install -g @openai/codex',
    loginCommand: 'codex login',
    permissionModes: ['ask', 'edits', 'plan', 'full'],
  },
}

export const PERMISSION_MODES: Record<PermissionMode, { label: string; description: string }> = {
  ask: { label: 'Nachfragen', description: 'Fragt vor Änderungen und Befehlen' },
  edits: { label: 'Bearbeiten erlauben', description: 'Ändert Dateien ohne Nachfrage, fragt vor Befehlen' },
  plan: { label: 'Planen', description: 'Liest nur und schlägt einen Plan vor' },
  auto: { label: 'Auto', description: 'Ein Klassifikator entscheidet über Freigaben' },
  full: { label: 'Volle Rechte', description: 'Alles ohne Nachfrage – nur in vertrauten Ordnern' },
}

export function providerName(id: ProviderId): string {
  return PROVIDERS[id].name
}
