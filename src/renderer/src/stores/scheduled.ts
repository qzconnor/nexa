import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ScheduledTask, ScheduledTaskInput, TaskRun } from '@shared/scheduled-tasks'
import type { TaskTemplate } from '@/components/scheduled/task-templates'

/** What the task dialog edits: a task by its id, or a new one, maybe from a template. */
export type TaskDialogRequest = { kind: 'edit'; id: string } | { kind: 'new'; template?: TaskTemplate } | { kind: 'copy'; id: string }

/** The scheduled tasks (main `scheduled/scheduled-tasks.ts`), kept up to date by its events. */
export const useScheduledStore = defineStore('scheduled', () => {
  const tasks = ref<ScheduledTask[]>([])
  const loaded = ref(false)
  /** The dialog for a task; null: closed. */
  const dialog = ref<TaskDialogRequest | null>(null)
  let loading: Promise<void> | null = null

  /** Once: the list, then every change of it. */
  function load(): Promise<void> {
    loading ??= (async () => {
      window.api.scheduled.onChanged((list) => (tasks.value = list))
      tasks.value = await window.api.scheduled.list()
      loaded.value = true
    })()
    return loading
  }

  /** Tasks that run on their own, for the count in the sidebar. */
  const activeCount = computed(() => tasks.value.filter((t) => t.enabled && t.nextRunAt !== null).length)

  const get = (id: string | null | undefined) => tasks.value.find((t) => t.id === id)

  function put(task: ScheduledTask): void {
    const index = tasks.value.findIndex((t) => t.id === task.id)
    if (index < 0) tasks.value = [...tasks.value, task]
    else tasks.value = tasks.value.map((t) => (t.id === task.id ? task : t))
  }

  async function save(input: ScheduledTaskInput, id?: string): Promise<ScheduledTask> {
    const task = await window.api.scheduled.save(input, id)
    put(task)
    return task
  }

  async function remove(id: string): Promise<void> {
    await window.api.scheduled.remove(id)
    tasks.value = tasks.value.filter((t) => t.id !== id)
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    put(await window.api.scheduled.setEnabled(id, enabled))
  }

  function runNow(id: string): Promise<TaskRun> {
    return window.api.scheduled.runNow(id)
  }

  return { tasks, loaded, dialog, activeCount, load, get, save, remove, setEnabled, runNow }
})
