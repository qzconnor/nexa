import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { startCommandKey, startCommandLabel, type StartCommandRun } from '@shared/start-commands'
import type { Project, StartCommand } from '@shared/types'
import { attempt } from '@/lib/errors'
import { useProjectsStore } from './projects'

/**
 * The projects' start commands (saved with the project) and their runs since Nexa started, which main
 * keeps (`services/start-commands.ts`): the last one of each command, running or ended.
 */
export const useStartCommandsStore = defineStore('startCommands', () => {
  const projects = useProjectsStore()
  const runs = ref<StartCommandRun[]>([])
  const byKey = computed(() => new Map(runs.value.map((run) => [startCommandKey(run.projectId, run.commandId), run])))

  function commandsOf(projectId: string | null | undefined): StartCommand[] {
    return projects.get(projectId)?.startCommands ?? []
  }

  function runOf(projectId: string | null | undefined, commandId: string): StartCommandRun | undefined {
    return projectId ? byKey.value.get(startCommandKey(projectId, commandId)) : undefined
  }

  function isRunning(projectId: string | null | undefined, commandId: string): boolean {
    return runOf(projectId, commandId)?.status === 'running'
  }

  /** The project's commands that run now, in its order. */
  function runningIn(projectId: string | null | undefined): StartCommand[] {
    return commandsOf(projectId).filter((c) => isRunning(projectId, c.id))
  }

  /** Whether `action` went through; a toast says why not. */
  async function done(action: () => Promise<void>, title: string): Promise<boolean> {
    const ok = await attempt(async () => {
      await action()
      return true
    }, title)
    return ok === true
  }

  /** Started (or failed to, which its run shows) by the time this returns. */
  function start(projectId: string, commandId: string): Promise<boolean> {
    return done(() => window.api.startCommands.start(projectId, commandId), 'Startbefehl ließ sich nicht starten')
  }

  /** Asked to end: its run says when it did. */
  function stop(projectId: string, commandId: string): Promise<boolean> {
    return done(() => window.api.startCommands.stop(projectId, commandId), 'Startbefehl ließ sich nicht beenden')
  }

  function restart(projectId: string, commandId: string): Promise<boolean> {
    return done(() => window.api.startCommands.restart(projectId, commandId), 'Startbefehl ließ sich nicht neu starten')
  }

  /** Starts those of the project that don't run; the first of them, for the panel. */
  async function startAll(projectId: string): Promise<StartCommand | undefined> {
    const idle = commandsOf(projectId).filter((c) => !isRunning(projectId, c.id))
    await Promise.all(idle.map((c) => start(projectId, c.id)))
    return idle[0]
  }

  async function stopAll(projectId: string): Promise<void> {
    await Promise.all(runningIn(projectId).map((c) => stop(projectId, c.id)))
  }

  /** Replaces the project's start commands; throws for the dialog to say why. */
  async function save(projectId: string, commands: StartCommand[]): Promise<Project> {
    // Like Electron's IPC: structured-cloned, which fails on Vue's reactive proxies.
    return window.api.startCommands.save(projectId, JSON.parse(JSON.stringify(commands)) as StartCommand[])
  }

  /** A chat of the project is on screen: the first one starts its commands with „Automatisch starten“. */
  function chatOpened(projectId: string): void {
    void window.api.startCommands.chatOpened(projectId).catch((error) => console.warn('[start-commands] auto start failed', error))
  }

  /** „dev und api laufen“: what runs in the project, for tooltips. */
  function runningText(projectId: string | null | undefined): string {
    const names = runningIn(projectId).map((c) => `„${startCommandLabel(c)}“`)
    if (!names.length) return ''
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0]
    return `${list} ${names.length > 1 ? 'laufen' : 'läuft'}`
  }

  window.api.startCommands.onChanged((next) => (runs.value = next))
  void window.api.startCommands
    .runs()
    .then((list) => (runs.value = list))
    .catch((error) => console.warn('[start-commands] runs not loaded', error))

  return { runs, commandsOf, runOf, isRunning, runningIn, start, stop, restart, startAll, stopAll, save, chatOpened, runningText }
})
