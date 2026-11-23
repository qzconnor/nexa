import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProjectCreateInput } from '@shared/ipc'
import type { Project } from '@shared/types'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])

  async function load(): Promise<void> {
    projects.value = await window.api.projects.list()
    window.api.projects.onChanged((next) => (projects.value = next))
  }

  function get(id: string | null | undefined): Project | undefined {
    return id ? projects.value.find((p) => p.id === id) : undefined
  }

  async function create(input: ProjectCreateInput): Promise<Project> {
    const project = await window.api.projects.create(input)
    projects.value = await window.api.projects.list()
    return project
  }

  async function update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed' | 'pinned'>>): Promise<void> {
    const project = get(id)
    if (project) Object.assign(project, patch)
    await window.api.projects.update(id, patch)
  }

  async function remove(id: string): Promise<void> {
    await window.api.projects.remove(id)
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  return { projects, load, get, create, update, remove }
})
