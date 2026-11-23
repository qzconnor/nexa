import type { AccountKind } from './accounts'
import type { ProviderId } from './chat'
import type { Unsubscribe } from './ipc'

/**
 * Taking over from the Claude Manager (see main/import/claude-manager.ts): its workspaces become
 * projects, its accounts Nexa's (with the same config folders), and the Claude Code sessions in
 * those folders chats that go on where they left off.
 */

export const ImportInvoke = {
  detect: 'import:cm-detect',
  scan: 'import:cm-scan',
  run: 'import:cm-run',
} as const

export const ImportEvent = {
  /** How far the scan of the sessions is. */
  progress: 'event:import-progress',
} as const

/** The Claude Manager's data folder, if it has one on this computer. */
export interface ClaudeManagerFound {
  dir: string
  workspaces: number
  accounts: number
}

export interface ImportAccount {
  name: string
  provider: ProviderId
  kind: AccountKind
  color: string
  /**
   * `create`: becomes a Nexa account with the same folder; `exists`: Nexa has an account with it;
   * `merge`: Nexa has its login in another folder (`into`), its sessions go on with that account;
   * `standard`: the CLI's standard account, which Nexa has too; `skip`: can't be taken over (its token
   * or key is encrypted for the Claude Manager alone).
   */
  action: 'create' | 'exists' | 'merge' | 'standard' | 'skip'
  /** `merge`: the name of the account it joins. */
  into?: string
}

/** A folder whose sessions become one project. */
export interface ImportGroup {
  path: string
  name: string
  /**
   * `workspace`: one of the Claude Manager, becomes a separator with its subfolders as projects;
   * `project`: a project Nexa has; `folder`: a folder of its own, becomes a project under the default separator.
   */
  kind: 'workspace' | 'project' | 'folder'
  exists: boolean
  /** Sessions to take over (those Nexa has already not counted). */
  sessions: number
  /** Sessions in folders below the folder itself. */
  inSubfolders: number
  /** A workspace: the projects its sessions go to under the separator (one per subfolder of the first level). */
  projects?: number
  /** Newest session, ms; null without. */
  updatedAt: number | null
}

export interface ImportPreview {
  dir: string
  accounts: ImportAccount[]
  groups: ImportGroup[]
  /** Sessions Nexa has taken over before. */
  known: number
  /** Sessions without a folder or that never got going. */
  skipped: number
}

export interface ImportInput {
  /** The `path`s of the groups to take over. */
  groups: string[]
}

export interface ImportResult {
  sections: number
  projects: number
  sessions: number
  accounts: number
}

export interface ImportProgress {
  done: number
  total: number
}

export interface ImportApi {
  detect(): Promise<ClaudeManagerFound | null>
  /** Reads the Claude Manager's folders and the sessions in its accounts' folders. */
  scan(): Promise<ImportPreview>
  /** Takes over the groups of the last scan. */
  run(input: ImportInput): Promise<ImportResult>
  onProgress(cb: (progress: ImportProgress) => void): Unsubscribe
}
