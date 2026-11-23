import type { ChatItem, InteractionResponse, PermissionMode, ProviderId, SessionRuntime } from '@shared/chat'
import type { CommandOption, ModelDefaults, ModelOption, ProviderStatus, ProviderUsage, SendInput, ShellOutput } from '@shared/types'
import type { AccountEnv } from '../accounts/account-env'
import type { ResolvedCommand } from './cli-binary'

/** Plan limits as a CLI reports them; the session service adds the account. */
export type RunUsage = Omit<ProviderUsage, 'accountId'>

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
  /** The CLI process ended (crash, logout, killed); the next prompt starts it again. */
  exited(error?: string): void
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
  /** The account the CLI runs with (its config folder and login). */
  account: AccountEnv
  /** Instructions Nexa adds to the system prompt (its tools, the handoff). */
  instructions: string
  /**
   * Nexa's MCP server for this session; absent when its tools are off. The token is the session's own
   * (its browser tools drive the session's browser); `allowed` tools run without asking, `ask` ones
   * only after the user agreed (names without the server's prefix, see mcp/nexa-tools.ts).
   */
  mcp?: { url: string; token: string; allowed: string[]; ask: string[] }
  /** Claude: start without Claude in Chrome, so it takes Nexa's browser (`--no-chrome`). */
  noChrome?: boolean
  extraArgs: string[]
}

/** One conversation with a CLI, alive until `stop`. */
export interface AgentRun {
  send(input: SendInput): Promise<void>
  interrupt(): Promise<void>
  /** Answer to an interaction item the run created. */
  respond(itemId: string, response: InteractionResponse): Promise<void>
  setModel(model: string | undefined, effort: string | undefined): Promise<void>
  setPermissionMode(mode: PermissionMode): Promise<void>
  /** The end of a shell task's output (`ShellState.taskId`), for CLIs that keep it. */
  shellOutput?(taskId: string): Promise<ShellOutput>
  /** Ends a shell task. */
  stopShell?(taskId: string): Promise<void>
  stop(): Promise<void>
  readonly alive: boolean
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
  start(options: RunOptions, sink: RunSink): Promise<AgentRun>
  /**
   * Limits of the account's plan without a running session, if the CLI can tell. `wake`: also when
   * that needs a process that isn't running yet (asked for by hand).
   */
  usage(account: AccountContext, wake: boolean): Promise<RunUsage | null>
  /** The browser login, started without a terminal (accounts/account-login.ts). */
  loginCommand(): ResolvedCommand
  /** An account was removed: what runs for it ends. */
  forget(accountId: string): Promise<void>
  dispose(): Promise<void>
}

export interface ProviderPaths {
  /** Path from the settings; empty: search the PATH. */
  configured: string
}
