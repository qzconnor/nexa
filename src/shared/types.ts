import type { ChatItem, ContextUsage, PermissionMode, ProviderId, SessionRuntime } from './chat'

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
  /** Scale of the whole window in percent, one of `ZOOM_STEPS` (src/shared/zoom.ts). */
  zoom: number
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
  /**
   * What a tool changed in files (its diff) starts folded. Off, as in the CLIs, every change shows at
   * once; other tools' output is folded either way until it fails.
   */
  collapseDiffs: boolean
  /** Enter sends; with Shift+Enter a new line. Off: Ctrl+Enter sends. */
  enterSends: boolean
  /**
   * A new chat gets its title from the model after the first prompt; until then, and when off, the
   * prompt's first line. Codex asks its model in a short request of its own for it.
   */
  autoTitles: boolean
  /**
   * A deleted chat takes its conversations in Claude Code and Codex along into the recycle bin, with
   * subagents and the snapshots of `/rewind`, in every account with a copy. Off: the CLIs keep them.
   */
  deleteCliConversations: boolean
  /**
   * The shell that runs what is typed after `!` in the composer, on Windows: PowerShell (7 where it is
   * installed, else 5.1), Git Bash or cmd. Elsewhere the user's login shell.
   */
  shell: UserShell
}

export type UserShell = 'powershell' | 'gitbash' | 'cmd'

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

export interface GeneralSettings {
  /**
   * An icon in the notification area: closing the window only hides it, chats, the local API and the
   * notifications go on; the icon's menu quits.
   */
  runInTray: boolean
  /** Starts with the user's login (`--autostart`); with `runInTray` without showing the window. */
  launchAtLogin: boolean
}

/**
 * When a chat interrupts with a notification and the flashing taskbar: `background` only while the
 * window is in the background, `hidden` also while it shows another chat or the start page.
 */
export type NotifyWhen = 'background' | 'hidden'

/** How Nexa points to chats that are done or need the user, and to limits and logins of the accounts. */
export interface NotificationSettings {
  /** Main switch (also the bell in the title bar): off, Nexa never interrupts. */
  enabled: boolean
  /** The agent finished its answer (or stopped at an error). */
  onDone: boolean
  /** A finished answer only interrupts after the agent worked at least this long (s); 0: always. */
  minBusySeconds: number
  /** The agent waits for a permission, the answer to a question or the approval of a plan. */
  onInput: boolean
  /** The chat stopped at a usage limit. */
  onLimit: boolean
  /** A limit of an account reached `nearLimitPercent`: once per account, window and reset. */
  onNearLimit: boolean
  /** Usage of a limit window (%) from which `onNearLimit` warns. */
  nearLimitPercent: number
  /** An account's browser login ended and can't be renewed: once per login. */
  onLoginLost: boolean
  when: NotifyWhen
  /** The notification shows the beginning of the answer, the command waiting for permission or the question. */
  preview: boolean
  /** The notification plays the system sound. */
  sound: boolean
  /** The taskbar button flashes until the window is in front. */
  flashTaskbar: boolean
}

export interface ApiSettings {
  enabled: boolean
  port: number
}

export interface AppSettings {
  general: GeneralSettings
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
  notifications: NotificationSettings
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

/**
 * What a model runs with when Nexa names no effort: the CLI's settings decide (Claude Code's
 * `effortLevel`, per model), so Nexa asks the CLI. Ultracode: Claude Code's dynamic workflows on every
 * task, which only some models can do.
 */
export interface ModelDefaults {
  effort?: string
  ultracode?: { available: boolean; on: boolean }
}

/** A command the composer offers after `/` (Codex: its skills, also after `$`). */
export interface CommandOption {
  /** As the list shows it, without the `(MCP)` of an MCP server's prompt. */
  name: string
  description?: string
  /** What may follow it, as the CLI words it (`[issue description]`). */
  argumentHint?: string
  aliases?: string[]
  /**
   * A prompt of an MCP server, a skill (Codex), a command or skill of Claude Code, or a command Nexa
   * runs itself (renderer `lib/chat-commands.ts`).
   */
  kind: 'mcp' | 'skill' | 'command' | 'app'
  /** What goes into the prompt: `/name` for Claude Code, `$name` for a skill of Codex. */
  insert: string
  /** Codex: the skill's file, sent with the prompt that names it. */
  path?: string
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
  /** MCP servers switched off for the project's chats, by CLI (their names as the CLI reports them). */
  mcpOff?: Partial<Record<ProviderId, string[]>>
}

/** Whose prompt (`prompts.md` in its folder): a project's or a separator's that stands for a folder. */
export interface PromptTarget {
  kind: 'project' | 'section'
  id: string
}

/** A folder's prompt for the dialog that edits it. */
export interface FolderPromptInfo {
  name: string
  path: string
  /** The file's name in the folder. */
  file: string
  text: string
  /** The separators around it whose prompts a chat gets first, the outermost first. */
  outer: string[]
}

/** An MCP server of a chat's CLI, for the switches in the composer's „+“ menu. */
export interface McpServerInfo {
  /** As the CLI names it (`claude.ai ClickUp`, `rea` …). */
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  /** Where it comes from: `user`, `project`, `local`, `claudeai` (a connector), `plugin` … */
  scope?: string
  /** How many tools it has, once connected. */
  tools?: number
  error?: string
  /** On for the project's chats (Nexa keeps the ones switched off, `Project.mcpOff`). */
  enabled: boolean
}

/** The page where a signed-out MCP server signs in. */
export interface McpAuthStart {
  url: string
  /**
   * The CLI takes the browser's answer itself (its own OAuth with a local callback); otherwise the
   * sign-in happens on the CLI's website (a claude.ai connector) and the server connects afterwards.
   */
  waits: boolean
}

/** Where a CLI's connectors are set up: a page of its website, or its config file. */
export type ConnectorSettings = { url: string } | { path: string }

/** A plugin installed in a chat's CLI, for the switches in the composer's „+“ menu. */
export interface PluginInfo {
  /** As the CLI names it: `<plugin>@<marketplace>`. */
  id: string
  name: string
  description?: string
  version?: string
  /** The marketplace it comes from, by its name. */
  marketplace?: string
  /** Claude Code: where it is installed (`user`, `project`, `local`). */
  scope?: string
  enabled: boolean
  /** Why it can't be switched (the organization decides). */
  locked?: string
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
  /**
   * Claude Code: the time (ms) up to which the chat holds its transcript. Entries after it came from a
   * CLI outside Nexa (`claude --resume` in a terminal) and are read into the chat; missing: the time of
   * the chat's last item (sessions from before).
   */
  synced?: number
  /**
   * A chat branched off another: `sessionId` is still the other chat's conversation, which the CLI's
   * next start forks into one of its own (Claude `--fork-session`, Codex `thread/fork`), up to `at`
   * (Claude: the uuid of the last answer's message, Codex: the last turn's id) so that what the other
   * chat says meanwhile stays out. Gone once the CLI has named the new conversation.
   */
  fork?: { at?: string }
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
  /** Claude Code's Ultracode, on or off; missing: as the CLI's settings say. */
  ultracode?: boolean
  permissionMode: PermissionMode
  createdAt: number
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  /** First words of the last prompt or answer, for the sidebar. */
  preview?: string
  cli: Partial<Record<ProviderId, CliLink>>
  /**
   * The CLIs' conversations from before each `/clear`, the oldest first: no CLI goes on with them, but
   * they are the chat's and go along when it is deleted.
   */
  earlierCli?: Partial<Record<ProviderId, CliLink>>[]
  /**
   * The item from which on the conversation counts, after the last `/clear`: what is above it stays
   * readable in the chat but goes to no CLI any more (not as context when switching either).
   */
  contextFrom?: number
  /** The account each CLI runs this chat with; missing: the default account of the CLI. */
  accounts?: Partial<Record<ProviderId, string>>
  /**
   * The folder the agent works in when it isn't the project's own: a folder in it, which the sidebar
   * shows as a level of its own under the project (as the Claude Manager does).
   */
  cwd?: string
  /**
   * More folders the agent may work in besides its own (the composer's „Ordner hinzufügen“): Claude
   * Code's `--add-dir`, Codex's writable roots.
   */
  dirs?: string[]
  /**
   * The context as last counted, kept over a restart of the CLI or of Nexa: a fresh CLI knows it only
   * once it has answered, and until then the composer's ring would be gone.
   */
  context?: ContextUsage
  /**
   * A session taken over from a CLI (its own folder, or the Claude Manager): where its history is, read
   * into the chat the first time the session opens. Claude Code: its transcript; Codex: the thread's id,
   * read through the app-server of the account in `cli.codex`.
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
  ultracode?: boolean
  permissionMode?: PermissionMode
}

export interface SessionUpdateInput {
  title?: string
  provider?: ProviderId
  /** Another account of one of the CLIs: the chat continues with it. */
  account?: string
  model?: string
  effort?: string
  ultracode?: boolean
  permissionMode?: PermissionMode
  pinned?: boolean
  archived?: boolean
  /** The folders added to the chat (all of them; empty: none). */
  dirs?: string[]
}

/**
 * Where a chat moves to: a project (and a folder in it), or any folder, which gets a project if no
 * project holds it.
 */
export type SessionMoveInput = { projectId: string; cwd?: string } | { folder: string }

export interface SessionDetail {
  meta: SessionMeta
  items: ChatItem[]
  runtime: SessionRuntime
}

/** What deleting chats did (`sessions.remove`). */
export interface SessionRemoveResult {
  /** The chats gone from Nexa. */
  removed: string[]
  /** Files and folders of the CLIs that went to the recycle bin, and what they took on disk. */
  trashed: number
  bytes: number
  /** Chats whose CLI conversation stayed: a CLI outside Nexa has it open right now. */
  openElsewhere: string[]
  /** Files that could not go to the recycle bin, with the first reason. */
  failed: number
  error?: string
}

/** What a chat takes on disk: its history in Nexa, and the conversations of its CLIs that deleting it takes along. */
export interface SessionStorage {
  id: string
  bytes: number
}

/** A chat whose conversation holds every word searched for (the quick open's search). */
export interface SessionSearchHit {
  sessionId: string
  /** Who wrote the message the snippet is from. */
  role: 'user' | 'assistant'
  /** The provider that answered, for "Claude:" or "Codex:". */
  provider: ProviderId
  /** The words around the first place found, on one line. */
  snippet: string
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
  /** The user's home folder, which paths show as `~`. */
  homeDir: string
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
