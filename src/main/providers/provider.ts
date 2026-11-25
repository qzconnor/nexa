import type { ChatItem, ContextDetail, InteractionResponse, PermissionMode, ProviderId, SessionRuntime, TodoEntry } from '@shared/chat'
import type { McpAppToolResult, McpToolUi } from '@shared/mcp-apps'
import type {
  CommandOption,
  McpAuthStart,
  McpServerInfo,
  ModelDefaults,
  ModelOption,
  PluginInfo,
  ProviderStatus,
  ProviderUsage,
  SendInput,
  ShellOutput,
} from '@shared/types'

/** An MCP server as a CLI reports it; whether it is on for the project is Nexa's. */
/** A server as the CLI tells it; `enabled` only where the switch is the CLI's own (`switchIn: 'cli'`). */
export type McpServerState = Omit<McpServerInfo, 'enabled'> & { enabled?: boolean }
import type { AccountEnv } from '../accounts/account-env'
import type { LoginCommand } from '../accounts/account-login'
import type { McpCallLog } from '../mcp/call-log'
import type { CliConfigAdapter } from './cli-config'

/** Plan limits as a CLI reports them; the session service adds the account. */
export type RunUsage = Omit<ProviderUsage, 'accountId'>

/** A conversation of a CLI as its list of them tells; times in ms. */
export interface CliSessionInfo {
  id: string
  cwd: string
  /** The name it was given. */
  title: string | null
  firstPrompt: string | null
  createdAt: number | null
  updatedAt: number | null
}

/** The account a CLI runs with: its environment, and the access token of a browser login for read-only calls. */
export interface AccountContext extends AccountEnv {
  accessToken: string | null
}

/**
 * What a provider reports while a session runs. The session service turns it into the chat the
 * window shows and the file it keeps (src/main/services/session-service.ts).
 */
export interface RunSink {
  /** A new item or a new state of an item with the same id. */
  item(item: ChatItem): void
  /** More text for a streaming item (assistant text, thinking, a command's output). */
  delta(itemId: string, field: 'text' | 'output', text: string): void
  runtime(patch: Partial<SessionRuntime>): void
  /** The CLI's own id of the conversation, as soon as it is known. */
  cliSession(id: string): void
  usage(usage: RunUsage): void
  /** The CLI took up a prompt (`RunInput.id`); one sent while it worked joins the chat here. */
  taken(promptId: string): void
  /** The CLI process ended (crash, logout, killed); the next prompt starts it again. */
  exited(error?: string): void
}

/** A prompt for the CLI, with the id of its item in the chat: the CLI names it when it takes it up. */
export interface RunInput extends SendInput {
  id: string
}

export interface RunOptions {
  /** Nexa's session id. */
  sessionId: string
  cwd: string
  model?: string
  effort?: string
  /** Claude: Ultracode on or off; missing: as its settings say. */
  ultracode?: boolean
  permissionMode: PermissionMode
  /** Resume this conversation of the CLI. */
  resumeId?: string
  /** Codex: the conversation's file, after it was copied from another account. */
  resumePath?: string
  /**
   * `resumeId` is another chat's conversation: continue a copy of it under a new id (Claude
   * `--fork-session`, Codex `thread/fork`), up to `at` (Claude: a message uuid, Codex: a turn id).
   */
  fork?: { at?: string }
  /** The account the CLI runs with (its config folder and login). */
  account: AccountEnv
  /** Instructions Nexa adds to the system prompt (its tools, the handoff). */
  instructions: string
  /**
   * Nexa's MCP server for this session; absent when its tools are off. The token is the session's own
   * (its browser tools drive the session's browser); `allowed` tools run without asking, `ask` ones
   * only after the user agreed (names without the server's prefix, see mcp/nexa-tools.ts). `calls`:
   * the arguments of the run's calls to the server, for CLIs that may not report them (Antigravity CLI).
   */
  mcp?: { url: string; token: string; allowed: string[]; ask: string[]; calls?: McpCallLog }
  /** Claude: start without Claude in Chrome, so it takes Nexa's browser (`--no-chrome`). */
  noChrome?: boolean
  /** The user's MCP servers that stay off in this run (switched off for the project). */
  mcpOff?: string[]
  /** More folders the agent may work in (Claude `--add-dir`, Codex writable roots). */
  dirs?: string[]
  /** Claude: guess the user's next prompt after each answer (`SessionRuntime.suggestion`). */
  promptSuggestions?: boolean
  /** Claude: the chat's task list as it shows it, so that its task tools change it by id. */
  todos?: TodoEntry[]
  extraArgs: string[]
}

/** One conversation with a CLI, alive until `stop`. */
export interface AgentRun {
  send(input: RunInput): Promise<void>
  interrupt(): Promise<void>
  /** Answer to an interaction item the run created. */
  respond(itemId: string, response: InteractionResponse): Promise<void>
  setModel(model: string | undefined, effort: string | undefined): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  /** Guesses of the next prompt on or off (`RunOptions.promptSuggestions`), for CLIs that make them. */
  setPromptSuggestions?(on: boolean): Promise<void>
  /** The end of a shell task's output (`ShellState.taskId`), for CLIs that keep it. */
  shellOutput?(taskId: string): Promise<ShellOutput>
  /** Ends a shell task. */
  stopShell?(taskId: string): Promise<void>
  /** What fills the context, by kind, for CLIs that tell (Claude Code); null while it can't be counted. */
  contextDetail?(): Promise<ContextDetail | null>
  /** The MCP servers of the running CLI with their state. */
  mcpServers?(): Promise<McpServerState[]>
  /**
   * Switches an MCP server on or off while the run lives; false when the CLI takes it only at its
   * start (the next prompt starts it anew, see `mcpOff`).
   */
  setMcpEnabled?(name: string, enabled: boolean): Promise<boolean>
  /** Connects an MCP server anew (one that failed, or signed in since). */
  reconnectMcp?(name: string): Promise<void>
  /**
   * Starts the sign-in of an MCP server in the running CLI, which then takes the browser's answer;
   * null when it needs none (signed in already).
   */
  authenticateMcp?(name: string): Promise<McpAuthStart | null>
  /** A resource of an MCP server the CLI is connected to (MCP Apps: a tool's `ui://` page), as `resources/read` answers. */
  readMcpResource?(server: string, uri: string): Promise<unknown>
  /** Calls a tool of an MCP server for a tool's page (MCP Apps `tools/call`), outside the model's turn. */
  callMcpTool?(server: string, tool: string, args: Record<string, unknown>): Promise<McpAppToolResult>
  /** What a tool's descriptor says about pages; null for a tool the server doesn't list. */
  mcpToolUi?(server: string, tool: string): Promise<McpToolUi | null>
  /**
   * Loads the plugins again after one was switched; false when the CLI takes them only at its start
   * (the next prompt starts it anew).
   */
  reloadPlugins?(): Promise<boolean>
  /**
   * Compacts the conversation now, as a turn of its own, for CLIs that have a call for it (Codex);
   * the others take `/compact` as a prompt.
   */
  compact?(): Promise<void>
  /**
   * A short title for the chat from its first prompt, which the CLI also keeps as the conversation's
   * name; null when it has none to give.
   */
  title?(prompt: string): Promise<string | null>
  stop(): Promise<void>
  readonly alive: boolean
  /** The CLI's process, to tell it from others that have the same conversation open. */
  readonly pid?: number
}

/**
 * A coding-agent CLI. Everything specific to one CLI lives behind this interface, in
 * `src/main/providers/<id>/`; the rest of the app only knows these methods.
 */
export interface AgentProvider {
  readonly id: ProviderId
  /** Is the CLI installed, which version, who is logged in with this account. */
  detect(account: AccountContext): Promise<ProviderStatus>
  models(account: AccountContext): Promise<ModelOption[]>
  /** What a model runs with when Nexa names no effort (and, for Claude Code, Ultracode). */
  modelDefaults(account: AccountContext, model: string): Promise<ModelDefaults>
  /** The commands and skills the composer offers in a folder. */
  commands(account: AccountContext, cwd: string): Promise<CommandOption[]>
  /** The MCP servers the CLI would start in a folder, without a chat of its own running there. */
  mcpServers(account: AccountContext, cwd: string): Promise<McpServerState[]>
  /**
   * For CLIs whose servers Nexa can't leave out of a single run (`mcpOff`): switches one in the CLI's
   * own file where it is set up; its running chats with the account start anew to take it.
   */
  setMcpEnabled?(account: AccountContext, cwd: string, name: string, enabled: boolean): Promise<void>
  /** The next look at the MCP servers connects them anew (one that failed, or signed in since). */
  reconnectMcp(account: AccountContext, cwd: string, name: string): Promise<void>
  /** Starts the sign-in of an MCP server without a chat running; null when it needs none. */
  authenticateMcp(account: AccountContext, cwd: string, name: string): Promise<McpAuthStart | null>
  /** `AgentRun.readMcpResource` without a chat running, from a CLI started for it. */
  readMcpResource?(account: AccountContext, cwd: string, server: string, uri: string): Promise<unknown>
  /** `AgentRun.callMcpTool` without a chat running, for CLIs that can call a tool without a conversation. */
  callMcpTool?(account: AccountContext, cwd: string, server: string, tool: string, args: Record<string, unknown>): Promise<McpAppToolResult>
  /** `AgentRun.mcpToolUi` without a chat running. */
  mcpToolUi?(account: AccountContext, cwd: string, server: string, tool: string): Promise<McpToolUi | null>
  /** The CLI's own settings (MCP servers, permissions, hooks) to read and change, for CLIs Nexa can edit them for. */
  readonly config?: CliConfigAdapter
  /** The plugins installed for a folder, each on or off. */
  plugins(account: AccountContext, cwd: string): Promise<PluginInfo[]>
  /** Switches a plugin in the CLI's own settings (also outside Nexa); running chats load it anew. */
  setPluginEnabled(account: AccountContext, cwd: string, id: string, enabled: boolean): Promise<void>
  start(options: RunOptions, sink: RunSink): Promise<AgentRun>
  /**
   * Limits of the account's plan without a running session, if the CLI can tell. `wake`: also when
   * that needs a process that isn't running yet (asked for by hand).
   */
  usage(account: AccountContext, wake: boolean): Promise<RunUsage | null>
  /**
   * The conversations saved with the account, for CLIs whose server lists them (Codex, Antigravity
   * CLI); Claude Code's are its transcript files (import/claude-sessions.ts).
   */
  sessions?(account: AccountContext): Promise<CliSessionInfo[]>
  /**
   * The chat of a conversation saved with the account, for CLIs whose server gives it (Codex,
   * Antigravity CLI). `since`: only the newest turns; Codex's back to the first one that started
   * before it, Antigravity's those of prompts made after it.
   */
  history?(account: AccountContext, sessionId: string, since?: number): Promise<ChatItem[]>
  /**
   * Where else the conversation is open now, in words („Codex außerhalb von Nexa“), for CLIs that
   * can tell; null when nowhere. Claude Code's are read from its folder (claude/claude-presence.ts).
   */
  openElsewhere?(account: AccountContext, sessionId: string, configDir: string): Promise<string | null>
  /** The browser login of an account, started without a terminal (accounts/account-login.ts); null: only in the CLI's own terminal interface. */
  loginCommand(account: AccountEnv): LoginCommand | null
  /** Signs an account out, for CLIs Nexa can ask to (`ProviderMeta.signOut`). */
  logout?(account: AccountEnv): Promise<void>
  /** An account was removed: what runs for it ends. */
  forget(accountId: string): Promise<void>
  dispose(): Promise<void>
}

export interface ProviderPaths {
  /** Path from the settings; empty: search the PATH. */
  configured: string
}
