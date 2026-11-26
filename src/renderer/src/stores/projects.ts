import { ref } from 'vue'
import type { ProjectCreateInput, SectionCreateInput, SectionUpdateInput } from '@shared/ipc'
import { applyLayout, type SectionLayout } from '@shared/sections'
import type { Project, ProjectSection, SessionRemoveResult } from '@shared/types'
import { apiOf, scopedStore } from './device'
import { useDevicesStore } from './devices'

/** The projects and separators of a device (`scopedStore`), in its sidebar's order. */
export const useProjectsStore = scopedStore('projects', (device) => {
  const api = apiOf(device)
  let listening = false
  /** In the sidebar's order: by separator, then as the user arranged them. */
  const projects = ref<Project[]>([])
  const sections = ref<ProjectSection[]>([])

  async function load(): Promise<void> {
    const [list, sectionList] = await Promise.all([api.projects.list(), api.projects.sections()])
    projects.value = list
    sections.value = sectionList
    if (listening) return
    listening = true
    api.projects.onChanged((next) => (projects.value = next))
    api.projects.onSectionsChanged((next) => (sections.value = next))
  }

  /**
   * Folding on a device that lets this one only read: it stays here (until its list comes anew) and
   * isn't saved there, which it would refuse.
   */
  function foldsHere(patch: object): boolean {
    return !!device && Object.keys(patch).every((key) => key === 'collapsed') && !useDevicesStore().can(device, 'prompt')
  }

  function get(id: string | null | undefined): Project | undefined {
    return id ? projects.value.find((p) => p.id === id) : undefined
  }

  async function create(input: ProjectCreateInput): Promise<Project> {
    const project = await api.projects.create(input)
    projects.value = await api.projects.list()
    return project
  }

  async function update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<void> {
    const project = get(id)
    if (project) Object.assign(project, patch)
    if (!foldsHere(patch)) await api.projects.update(id, patch)
  }

  /** With its chats; what deleting them did, for the window's sessions store and the report. */
  async function remove(id: string): Promise<SessionRemoveResult> {
    const result = await api.projects.remove(id)
    projects.value = projects.value.filter((p) => p.id !== id)
    return result
  }

  /** The order after a drag and drop, shown at once: nothing jumps back while the main process saves it. */
  async function arrange(layout: SectionLayout[]): Promise<void> {
    const next = applyLayout(projects.value, sections.value, layout)
    projects.value = next.projects
    sections.value = next.sections
    await api.projects.arrange(layout)
  }

  function createSection(input: SectionCreateInput): Promise<ProjectSection> {
    return api.projects.createSection(input)
  }

  async function updateSection(id: string, patch: SectionUpdateInput): Promise<void> {
    const section = sections.value.find((s) => s.id === id)
    if (section) Object.assign(section, patch)
    if (!foldsHere(patch)) await api.projects.updateSection(id, patch)
  }

  function removeSection(id: string): Promise<void> {
    return api.projects.removeSection(id)
  }

  function toSection(id: string): Promise<ProjectSection> {
    return api.projects.toSection(id)
  }

  return { projects, sections, load, get, create, update, remove, arrange, createSection, updateSection, removeSection, toSection }
})
