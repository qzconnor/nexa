import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { inFolder } from '@shared/folders'
import { parseStartCommands, startCommandKey, type StartCommandRun } from '@shared/start-commands'
import { plainOutput } from '@shared/terminal'
import type { Project, ShellOutput, StartCommand } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import { UserShells, type ShellLaunch } from './user-shells'

/** What the window gets of a start command's output: its end, as much as of a `!` command in the chat. */
const MAX_OUTPUT = 100_000
/** How long quitting waits for the start commands to end: a dev server left behind holds on to its port. */
const QUIT_WAIT_MS = 3000

/** Where the start commands come from (ProjectService). */
export interface StartCommandProjects {
  get(id: string): Project | undefined
  setStartCommands(id: string, commands: StartCommand[]): Promise<Project>
}

interface Entry {
  run: StartCommandRun
  /** All it wrote so far, decoded (UserShells keeps the end of a long output). */
  output: string
  /** Starts again once it ended („Neu starten“). */
  restart: boolean
  /** Settles once its process is gone. */
  ended: Promise<void>
}

/**
 * The start commands of the projects (`npm run dev` …), like the shells of the Claude Manager's tab
 * sets: each in a process of its own in its folder of the project, with the shell of the settings, run
 * as the user's `!` commands are (UserShells). Their output stays in Nexa's memory: it isn't saved and
 * no agent gets it. The last run of each command stays until the command or its project goes; all end
 * when Nexa quits.
 */
export class StartCommands extends TypedEmitter<{ changed: [StartCommandRun[]] }> {
  private readonly shells = new UserShells()
  private readonly entries = new Map<string, Entry>()
  /** Projects whose commands with `autoStart` started already: once per run of Nexa. */
  private readonly autoStarted = new Set<string>()
  private disposed = false

  constructor(
    private readonly projects: StartCommandProjects,
    /** How a command runs: in the shell of the settings (`shellLaunch`); throws when that isn't installed. */
    private readonly launch: (command: string) => ShellLaunch,
  ) {
    super()
  }

  runs(): StartCommandRun[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.run }))
  }

  /** Replaces the project's start commands; one that runs and is gone ends. */
  async save(projectId: string, value: unknown): Promise<Project> {
    const project = await this.projects.setStartCommands(projectId, parseStartCommands(value))
    this.drop((run) => run.projectId === projectId && !hasCommand(project, run.commandId))
    return project
  }

  /** The projects as they are now: runs whose project or command is gone end and go. */
  projectsChanged(projects: readonly Project[]): void {
    const byId = new Map(projects.map((p) => [p.id, p]))
    this.drop((run) => !hasCommand(byId.get(run.projectId), run.commandId))
  }

  /**
   * Starts the command in its folder of the project; one that runs stays as it is. A folder or shell
   * that is missing makes a run that failed, so the panel says why.
   */
  start(projectId: string, commandId: string): void {
    if (this.disposed) return
    const key = startCommandKey(projectId, commandId)
    if (this.entries.get(key)?.run.status === 'running') return
    const project = this.projects.get(projectId)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    const command = project.startCommands?.find((c) => c.id === commandId)
    if (!command) throw new Error('Den Startbefehl gibt es nicht mehr.')
    const cwd = resolve(project.path, command.dir ?? '')
    let settle!: () => void
    const entry: Entry = {
      run: { projectId, commandId, name: command.name, command: command.command, cwd, shell: '', status: 'running', startedAt: Date.now() },
      output: '',
      restart: false,
      ended: new Promise((done) => (settle = done)),
    }
    this.entries.set(key, entry)

    let launch: ShellLaunch | null = null
    let problem = !inFolder(cwd, project.path) ? `Der Ordner „${cwd}“ liegt nicht im Projekt.` : isFolder(cwd) ? null : `Den Ordner „${cwd}“ gibt es nicht.`
    if (!problem) {
      try {
        launch = this.launch(command.command)
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error)
      }
    }
    if (!launch) {
      Object.assign(entry.run, { status: 'error', error: problem ?? undefined, endedAt: Date.now() })
      settle()
      this.changed()
      return
    }
    entry.run.shell = launch.name
    this.changed()
    this.shells.run(projectId, key, launch, cwd, {
      output: (text) => (entry.output = text),
      exit: ({ code, stopped, error }) => {
        settle()
        if (this.entries.get(key) !== entry) return
        Object.assign(entry.run, {
          status: stopped ? 'stopped' : code === 0 && !error ? 'done' : 'error',
          endedAt: Date.now(),
          ...(stopped ? {} : { exitCode: code }),
          ...(error ? { error } : {}),
        })
        if (entry.restart && !this.disposed) {
          try {
            return this.start(projectId, commandId)
          } catch {
            // Its command went meanwhile: it stays ended.
          }
        }
        this.changed()
      },
    })
  }

  /** Ends the command and what it started. */
  stop(projectId: string, commandId: string): void {
    const key = startCommandKey(projectId, commandId)
    const entry = this.entries.get(key)
    if (!entry) return
    entry.restart = false
    this.shells.stop(key)
  }

  /** Ends it and starts it again, as it is saved now (an edit counts from here); one that ended just starts. */
  restart(projectId: string, commandId: string): void {
    const key = startCommandKey(projectId, commandId)
    const entry = this.entries.get(key)
    if (entry?.run.status !== 'running') return this.start(projectId, commandId)
    entry.restart = true
    this.shells.stop(key)
  }

  /** The end of what its last run wrote, as plain text. */
  output(projectId: string, commandId: string): ShellOutput {
    const text = plainOutput(this.entries.get(startCommandKey(projectId, commandId))?.output ?? '')
    if (text.length <= MAX_OUTPUT) return { text, truncated: false }
    // From a line's start: half a line on top reads as garbage.
    const from = text.length - MAX_OUTPUT
    return { text: text.slice(text.indexOf('\n', from) + 1 || from), truncated: true }
  }

  /**
   * A chat of the project is on screen: the first one starts its commands with `autoStart`, once per run
   * of Nexa. One the user stopped stays stopped as other chats open.
   */
  chatOpened(projectId: string): void {
    if (this.autoStarted.has(projectId) || this.disposed) return
    const auto = this.projects.get(projectId)?.startCommands?.filter((c) => c.autoStart) ?? []
    if (!auto.length) return
    this.autoStarted.add(projectId)
    for (const command of auto) this.start(projectId, command.id)
  }

  /** Ends all (Nexa quits), and waits a moment for them to be gone. */
  async dispose(): Promise<void> {
    this.disposed = true
    const ended = [...this.entries.values()].filter((e) => e.run.status === 'running').map((e) => e.ended)
    this.shells.stopAll()
    let timer: NodeJS.Timeout | undefined
    await Promise.race([Promise.all(ended), new Promise((done) => (timer = setTimeout(done, QUIT_WAIT_MS)))])
    clearTimeout(timer)
  }

  private drop(gone: (run: StartCommandRun) => boolean): void {
    let changed = false
    for (const [key, entry] of this.entries) {
      if (!gone(entry.run)) continue
      this.entries.delete(key)
      entry.restart = false
      this.shells.stop(key)
      changed = true
    }
    if (changed) this.changed()
  }

  private changed(): void {
    this.emit('changed', this.runs())
  }
}

function hasCommand(project: Project | undefined, commandId: string): boolean {
  return !!project?.startCommands?.some((c) => c.id === commandId)
}

function isFolder(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return false
  }
}
