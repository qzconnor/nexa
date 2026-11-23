import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ProjectCreateInput, SectionCreateInput, SectionUpdateInput } from '@shared/ipc'
import { applyLayout, type SectionLayout } from '@shared/sections'
import type { Project, ProjectSection } from '@shared/types'

export const useProjectsStore = defineStore('projects', () => {
  /** In the sidebar's order: by separator, then as the user arranged them. */
  const projects = ref<Project[]>([])
  const sections = ref<ProjectSection[]>([])

  async function load(): Promise<void> {
    const [list, sectionList] = await Promise.all([window.api.projects.list(), window.api.projects.sections()])
    projects.value = list
    sections.value = sectionList
    window.api.projects.onChanged((next) => (projects.value = next))
    window.api.projects.onSectionsChanged((next) => (sections.value = next))
  }

  function get(id: string | null | undefined): Project | undefined {
    return id ? projects.value.find((p) => p.id === id) : undefined
  }

  async function create(input: ProjectCreateInput): Promise<Project> {
    const project = await window.api.projects.create(input)
    projects.value = await window.api.projects.list()
    return project
  }

  async function update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<void> {
    const project = get(id)
    if (project) Object.assign(project, patch)
    await window.api.projects.update(id, patch)
  }

  async function remove(id: string): Promise<void> {
    await window.api.projects.remove(id)
    projects.value = projects.value.filter((p) => p.id !== id)
  }

  /** The order after a drag and drop, shown at once: nothing jumps back while the main process saves it. */
  async function arrange(layout: SectionLayout[]): Promise<void> {
    const next = applyLayout(projects.value, sections.value, layout)
    projects.value = next.projects
    sections.value = next.sections
    await window.api.projects.arrange(layout)
  }

  function createSection(input: SectionCreateInput): Promise<ProjectSection> {
    return window.api.projects.createSection(input)
  }

  async function updateSection(id: string, patch: SectionUpdateInput): Promise<void> {
    const section = sections.value.find((s) => s.id === id)
    if (section) Object.assign(section, patch)
    await window.api.projects.updateSection(id, patch)
  }

  function removeSection(id: string): Promise<void> {
    return window.api.projects.removeSection(id)
  }

  function toSection(id: string): Promise<ProjectSection> {
    return window.api.projects.toSection(id)
  }

  return { projects, sections, load, get, create, update, remove, arrange, createSection, updateSection, removeSection, toSection }
})
