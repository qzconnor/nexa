import { computed, ref } from 'vue'
import type { ProjectCreateInput, SectionCreateInput, SectionUpdateInput } from '@shared/ipc'
import { applyLayout, type SectionLayout } from '@shared/sections'
import type { Project, ProjectSection, SessionRemoveResult } from '@shared/types'
import { apiOf, scopedStore } from './device'
import { useKeptHereStore } from './kept-here'

/** The projects and separators of a device (`scopedStore`), in its sidebar's order. */
export const useProjectsStore = scopedStore('projects', (device) => {
  const api = apiOf(device)
  let listening = false
  /** As the device has them, in its sidebar's order: by separator, then as the user arranged them. */
  const ownProjects = ref<Project[]>([])
  const ownSections = ref<ProjectSection[]>([])
  /** Another device's: with what this one keeps of them for itself (folding, order, names). */
  const kept = device ? useKeptHereStore(device) : null
  const shown = computed(() => (kept ? kept.projectsView(ownProjects.value, ownSections.value) : { projects: ownProjects.value, sections: ownSections.value }))
  const projects = computed(() => shown.value.projects)
  const sections = computed(() => shown.value.sections)

  async function load(): Promise<void> {
    const [list, sectionList] = await Promise.all([api.projects.list(), api.projects.sections()])
    ownProjects.value = list
    ownSections.value = sectionList
    if (listening) return
    listening = true
    api.projects.onChanged((next) => (ownProjects.value = next))
    api.projects.onSectionsChanged((next) => (ownSections.value = next))
  }

  function get(id: string | null | undefined): Project | undefined {
    return id ? projects.value.find((p) => p.id === id) : undefined
  }

  async function create(input: ProjectCreateInput): Promise<Project> {
    const project = await api.projects.create(input)
    ownProjects.value = await api.projects.list()
    return project
  }

  async function update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<void> {
    const send = kept ? kept.keepPlace('project', id, patch) : patch
    if (!Object.keys(send).length) return
    // Shown at once: nothing jumps back while the main process saves it.
    const project = ownProjects.value.find((p) => p.id === id)
    if (project) Object.assign(project, send)
    await api.projects.update(id, send)
  }

  /** With its chats; what deleting them did, for the window's sessions store and the report. */
  async function remove(id: string): Promise<SessionRemoveResult> {
    const result = await api.projects.remove(id)
    ownProjects.value = ownProjects.value.filter((p) => p.id !== id)
    kept?.drop('projects', [id])
    return result
  }

  /** The order after a drag and drop, shown at once: nothing jumps back while the main process saves it. */
  async function arrange(layout: SectionLayout[]): Promise<void> {
    if (kept?.keepLayout(layout)) return
    const next = applyLayout(ownProjects.value, ownSections.value, layout)
    ownProjects.value = next.projects
    ownSections.value = next.sections
    await api.projects.arrange(layout)
  }

  function createSection(input: SectionCreateInput): Promise<ProjectSection> {
    return api.projects.createSection(input)
  }

  async function updateSection(id: string, patch: SectionUpdateInput): Promise<void> {
    const send = kept ? kept.keepPlace('section', id, patch) : patch
    if (!Object.keys(send).length) return
    const section = ownSections.value.find((s) => s.id === id)
    if (section) Object.assign(section, send)
    await api.projects.updateSection(id, send)
  }

  async function removeSection(id: string): Promise<void> {
    await api.projects.removeSection(id)
    kept?.drop('sections', [id])
  }

  function toSection(id: string): Promise<ProjectSection> {
    return api.projects.toSection(id)
  }

  return { projects, sections, load, get, create, update, remove, arrange, createSection, updateSection, removeSection, toSection }
})
