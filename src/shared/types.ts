import type { ChatItem, PermissionMode, ProviderId, SessionRuntime } from './chat'

export type { DeepPartial } from './utils'

/** `process.platform`, without Node's types in the renderer. */
export type Platform = 'aix' | 'android' | 'cygwin' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'netbsd' | 'openbsd' | 'sunos' | 'win32'

// ---------------------------------------------------------------------------------------------
// Settings

export type WindowMaterial = 'none' | 'mica' | 'acrylic' | 'tabbed'

export interface AppearanceSettings {
  /** Id of a built-in theme or `custom:<file>`. */
  theme: string
  material: WindowMaterial
  /** Keeps acrylic/mica painted while the window is in the background. */
  keepMaterialActive: boolean
  /** Opacity of surfaces over the window material, 0–100. */
  surfaceOpacity: number
  /** Corner radius in rem. */
  radius: number
  uiFontSize: number
  /** Width of the chat column. */
  chatWidth: 'normal' | 'wide' | 'full'
}

export interface ProviderSettings {
  /**
   * Used in Nexa: off, the CLI can't be picked for chats and Nexa doesn't ask it for its limits. It
   * is still looked for, so the settings can tell whether it is there.
   */
  enabled: boolean
  /** Path to the CLI; empty: found on the PATH. */
  path: string
  /** Model for new sessions; empty: the CLI's default. */
  model: string
  /** Reasoning effort for new sessions; empty: the model's default. */
  effort: string
  /** More arguments for every start. */
  extraArgs: string[]
}

export interface ChatSettings {
  /** Thinking blocks of the model, folded. */
  showThinking: boolean
  /** Output of finished tools stays folded unless it failed. */
  collapseTools: boolean
  /** Enter sends; with Shift+Enter a new line. Off: Ctrl+Enter sends. */
  enterSends: boolean
}

export interface ToolSettings {
  /** Nexa's MCP server with the tools that draw charts, diagrams and tables in the chat. */
  renderTools: boolean
  /** The browser beside each chat as tools of Nexa's MCP server (`browser_*`). */
  browserTools: boolean
  /**
   * Claude Code starts without Claude in Chrome (`--no-chrome`) while the browser tools are on, so it
   * takes Nexa's browser instead of the user's Chrome.
   */
  noClaudeInChrome: boolean
}

export interface ApiSettings {
  enabled: boolean
  port: number
}

export interface AppSettings {
  appearance: AppearanceSettings
  defaults: {
    provider: ProviderId
    permissionMode: PermissionMode
    /** The account each CLI starts new chats with (see shared/accounts.ts). */
    accounts: Record<ProviderId, string>
    /** Folder new projects are created in. */
    projectsFolder: string
  }
  claude: ProviderSettings
  codex: ProviderSettings
  chat: ChatSettings
  tools: ToolSettings
  api: ApiSettings
  setup: {
    /** The first start's setup (which CLIs to use) is through; until then it takes the start page's place. */
    done: boolean
  }
}

// ---------------------------------------------------------------------------------------------
// Providers

export interface ProviderAccount {
  email?: string
  organization?: string
  plan?: string
  /** `chatgpt`, `apiKey`, `oauth` … as the CLI reports it. */
  authMode?: string
}

/** What Nexa found out about a CLI at the start (and when asked to look again). */
export interface ProviderStatus {
  id: ProviderId
  name: string
  installed: boolean
  path?: string
  version?: string
  /** Null while unknown. */
  loggedIn: boolean | null
  account?: ProviderAccount
  error?: string
  checkedAt: number
}

export interface ModelOption {
  id: string
  label: string
  description?: string
  efforts?: string[]
  defaultEffort?: string
  isDefault?: boolean
}

export interface ProviderInfo {
  id: ProviderId
  name: string
  /** Short name for chips ("Claude", "Codex"). */
  short: string
  models: ModelOption[]
  permissionModes: PermissionMode[]
}

// ---------------------------------------------------------------------------------------------
// Usage of the plan limits

export interface UsageWindow {
  /** `five_hour`, `seven_day`, `primary` … */
  key: string
  label: string
  /** 0–100. */
  usedPercent: number
  /** Milliseconds since the epoch. */
  resetsAt?: number
  windowMinutes?: number
}

export interface ProviderUsage {
  provider: ProviderId
  /** The account the limits belong to. */
  accountId: string
  windows: UsageWindow[]
  plan?: string
  /** The limit is reached and the CLI refuses work until a reset. */
  limited?: boolean
  /** Why the limits couldn't be read (the last known ones stay). */
  message?: string
  updatedAt: number
  source: 'session' | 'api'
}

/** What Nexa's chats used on one day (local date `YYYY-MM-DD`), per CLI. */
export interface UsageDay {
  date: string
  tokens: Partial<Record<ProviderId, number>>
  costUsd: Partial<Record<ProviderId, number>>
  turns: Partial<Record<ProviderId, number>>
}

export interface UsageTotals {
  turns: number
  inputTokens: number
  outputTokens: number
  /** What the turns would cost at the API's prices, as the CLI reports it. */
  costUsd: number
}

export interface UsageStats {
  days: UsageDay[]
  totals: Partial<Record<ProviderId, UsageTotals>>
}

// ---------------------------------------------------------------------------------------------
// Projects and sessions

export interface Project {
  id: string
  name: string
  /** Absolute folder the agents work in. */
  path: string
  createdAt: number
  /** Last activity of one of its sessions. */
  updatedAt: number
  collapsed?: boolean
  /** The separator it shows under; none (or one that's gone) is the default one (shared/sections.ts). */
  sectionId?: string
}

/** A separator in the sidebar: a heading with projects under it, like the workspaces of the Claude Manager. */
export interface ProjectSection {
  id: string
  name: string
  /**
   * The folder it stands for, if any (a workspace whose subfolders are its projects): new projects in
   * that folder land under it, and the chats of the folder itself show right below the heading.
   */
  path?: string
  collapsed?: boolean
}

/** What a CLI knows of a Nexa session: its own session/thread and how much of the chat it has seen. */
export interface CliLink {
  /** Claude Code's session id or Codex's thread id. */
  sessionId: string
  /** Number of items of the Nexa session this CLI has seen, for the context when coming back. */
  seenItems: number
  /** The account whose config folder holds the conversation; missing: the standard account (older sessions). */
  accountId?: string
  /** Codex: the conversation file to resume from, after it was copied to another account. */
  resumePath?: string
  /**
   * The config folder the conversation was saved in. The standard account's folder is whatever
   * CLAUDE_CONFIG_DIR or CODEX_HOME Nexa was started with and can differ from one start to the next.
   */
  configDir?: string
}

export interface SessionMeta {
  id: string
  projectId: string
  title: string
  titleSource: 'auto' | 'user'
  /** The CLI that answers the next prompt. */
  provider: ProviderId
  model: string
  effort: string
  permissionMode: PermissionMode
  createdAt: number
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  /** First words of the last prompt or answer, for the sidebar. */
  preview?: string
  cli: Partial<Record<ProviderId, CliLink>>
  /** The account each CLI runs this chat with; missing: the default account of the CLI. */
  accounts?: Partial<Record<ProviderId, string>>
  /**
   * The folder the agent works in when it isn't the project's own: a folder in it, which the sidebar
   * shows as a level of its own under the project (as the Claude Manager does).
   */
  cwd?: string
  /**
   * A session taken over from Claude Code (the Claude Manager): its transcript, read into the chat the
   * first time the session opens.
   */
  importedFrom?: string
}

export interface SessionCreateInput {
  projectId: string
  /** A folder in the project to work in; missing: the project's own. */
  cwd?: string
  provider?: ProviderId
  /** An account of the CLI; missing: its default account. */
  account?: string
  model?: string
  effort?: string
  permissionMode?: PermissionMode
}

export interface SessionUpdateInput {
  title?: string
  provider?: ProviderId
  /** Another account of one of the CLIs: the chat continues with it. */
  account?: string
  model?: string
  effort?: string
  permissionMode?: PermissionMode
  pinned?: boolean
  archived?: boolean
  projectId?: string
}

export interface SessionDetail {
  meta: SessionMeta
  items: ChatItem[]
  runtime: SessionRuntime
}

export interface SendInput {
  text: string
  images?: string[]
}

/** The end of what a shell task wrote, as its CLI keeps it. */
export interface ShellOutput {
  /** Plain text, escape sequences included. */
  text: string
  /** Only the end of a longer output. */
  truncated: boolean
}

// ---------------------------------------------------------------------------------------------
// App

export interface AppInfo {
  version: string
  platform: Platform
  userData: string
  /** Windows build number, for the window material. */
  windowsBuild: number | null
}

export interface WindowState {
  maximized: boolean
  focused: boolean
  fullscreen: boolean
}

export interface ApiStatus {
  running: boolean
  port: number | null
  token: string | null
  error?: string
}
