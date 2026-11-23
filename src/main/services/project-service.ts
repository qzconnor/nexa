import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { inFolder } from '@shared/folders'
import type { ProjectCreateInput, SectionCreateInput, SectionUpdateInput } from '@shared/ipc'
import {
  applyLayout,
  DEFAULT_SECTION_ID,
  DEFAULT_SECTION_NAME,
  layoutOf,
  moveProject,
  sectionForPath,
  sectionIdOf,
  type SectionLayout,
} from '@shared/sections'
import type { ProviderId } from '@shared/chat'
import type { FolderPromptInfo, Project, ProjectSection, PromptTarget } from '@shared/types'
import { baseName } from '@shared/utils'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'
import { type FolderPrompt, PROMPT_FILE, readFolderPrompt, writeFolderPrompt } from './folder-prompts'

interface Saved {
  version?: number
  projects?: (Project & { pinned?: boolean })[]
  sections?: ProjectSection[]
}

export interface ProjectCreateOptions {
  /** The last activity of a project taken over from elsewhere; a new one counts as active now. */
  at?: number
  collapsed?: boolean
  /** Last under its separator instead of first (the importer adds projects by their activity). */
  end?: boolean
}

/**
 * Folders the agents work in; every session belongs to one. They stand under separators (sections) in
 * the order the user arranged them by drag and drop (projects.json in the app's data).
 */
export class ProjectService extends TypedEmitter<{ changed: [Project[]]; sections: [ProjectSection[]] }> {
  private readonly file: string
  private projects: Project[]
  private sectionList: ProjectSection[]

  constructor(dataDir: string) {
    super()
    this.file = join(dataDir, 'projects.json')
    const saved = readJsonGuardedSync<Saved>(this.file)
    const projects = Array.isArray(saved?.projects) ? saved.projects : []
    // Until version 2 the sidebar ordered by itself (pinned first, then the latest): that order is the user's now.
    if ((saved?.version ?? 1) < 2) projects.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
    this.projects = projects.map(({ pinned: _pinned, ...project }) => project)
    const sections = Array.isArray(saved?.sections) ? saved.sections.filter((s) => typeof s?.id === 'string' && typeof s.name === 'string') : []
    if (!sections.some((s) => s.id === DEFAULT_SECTION_ID)) sections.unshift({ id: DEFAULT_SECTION_ID, name: DEFAULT_SECTION_NAME })
    this.sectionList = sections
  }

  /** The projects in the sidebar's order: by separator, then as the user arranged them. */
  list(): Project[] {
    const rank = new Map(this.sectionList.map((s, i) => [s.id, i]))
    const of = (p: Project) => rank.get(sectionIdOf(p, this.sectionList)) ?? 0
    return [...this.projects].sort((a, b) => of(a) - of(b))
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  /** The project of a folder, if there is one (case-insensitive on Windows). */
  byPath(path: string): Project | undefined {
    const key = folderKey(path)
    return this.projects.find((p) => folderKey(p.path) === key)
  }

  /** The project a folder lies in (or is), the innermost one when projects nest. */
  containing(path: string): Project | undefined {
    return this.projects.filter((p) => inFolder(path, p.path)).sort((a, b) => b.path.length - a.path.length)[0]
  }

  async create(input: ProjectCreateInput, options: ProjectCreateOptions = {}): Promise<Project> {
    const path = resolve(input.path)
    const existing = this.byPath(path)
    if (existing) {
      if (options.at !== undefined && options.at > existing.updatedAt) {
        existing.updatedAt = options.at
        await this.save()
      }
      return existing
    }
    if (!existsSync(path)) {
      if (!input.create) throw new Error(`Den Ordner „${path}“ gibt es nicht.`)
      await mkdir(path, { recursive: true })
    } else if (!statSync(path).isDirectory()) {
      throw new Error(`„${path}“ ist kein Ordner.`)
    }
    const now = Date.now()
    const sectionId = input.sectionId && this.section(input.sectionId) ? input.sectionId : sectionForPath(path, this.sectionList)
    const project: Project = {
      id: randomUUID(),
      name: input.name?.trim() || baseName(path),
      path,
      createdAt: now,
      updatedAt: options.at ?? now,
      ...(options.collapsed ? { collapsed: true } : {}),
      ...(sectionId !== DEFAULT_SECTION_ID ? { sectionId } : {}),
    }
    // The order counts only within a separator: first in the list is first under its separator.
    if (options.end) this.projects.push(project)
    else this.projects.unshift(project)
    await this.save()
    return project
  }

  async update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<Project> {
    const project = this.get(id)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    if (patch.name !== undefined && patch.name.trim()) project.name = patch.name.trim()
    if (patch.collapsed !== undefined) project.collapsed = patch.collapsed
    await this.save()
    return project
  }

  /** Switches an MCP server of a CLI on or off for the project's chats. */
  async setMcpEnabled(id: string, provider: ProviderId, name: string, enabled: boolean): Promise<Project> {
    const project = this.get(id)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    const off = new Set(project.mcpOff?.[provider] ?? [])
    if (enabled) off.delete(name)
    else off.add(name)
    const mcpOff = { ...project.mcpOff, [provider]: [...off].sort() }
    if (!off.size) delete mcpOff[provider]
    if (Object.keys(mcpOff).length) project.mcpOff = mcpOff
    else delete project.mcpOff
    await this.save()
    return project
  }

  async touch(id: string): Promise<void> {
    const project = this.get(id)
    if (!project) return
    project.updatedAt = Date.now()
    await this.save()
  }

  async remove(id: string): Promise<void> {
    this.projects = this.projects.filter((p) => p.id !== id)
    await this.save()
  }

  // Prompts of projects and separators -----------------------------------------------------------

  /**
   * The folders whose prompt a chat of the project gets, the outermost first: the separators for a
   * folder it lies in (a workspace in a workspace, too), then the project. Only folders Nexa knows:
   * a `cm_prompts.md` that comes with a cloned repository in a subfolder stays out.
   */
  promptFolders(projectId: string): { name: string; path: string }[] {
    const project = this.get(projectId)
    if (!project) return []
    const sections = this.sectionList
      .filter((s): s is ProjectSection & { path: string } => !!s.path && inFolder(project.path, s.path))
      .sort((a, b) => folderKey(a.path).length - folderKey(b.path).length)
      .map((s) => ({ name: s.name, path: s.path }))
    const own = sections.some((s) => folderKey(s.path) === folderKey(project.path))
    return own ? sections : [...sections, { name: project.name, path: project.path }]
  }

  /** The prompts of a project's chats, read as a CLI starts: a change counts from its next start. */
  async promptsFor(projectId: string): Promise<FolderPrompt[]> {
    const folders = this.promptFolders(projectId)
    return Promise.all(folders.map(async (f) => ({ ...f, text: await readFolderPrompt(f.path) })))
  }

  /** The folder of a project or a separator with one, whose prompt it is. */
  promptTarget(target: PromptTarget): { name: string; path: string } {
    const owner = target.kind === 'project' ? this.get(target.id) : this.section(target.id)
    if (!owner?.path) throw new Error(target.kind === 'project' ? 'Das Projekt gibt es nicht mehr.' : 'Dieser Trenner steht für keinen Ordner.')
    return { name: owner.name, path: owner.path }
  }

  async readPrompt(target: PromptTarget): Promise<FolderPromptInfo> {
    const { name, path } = this.promptTarget(target)
    // The folders around it whose prompts come first.
    const outer =
      target.kind === 'project'
        ? this.promptFolders(target.id).filter((f) => folderKey(f.path) !== folderKey(path))
        : this.sectionList.filter((s) => s.path && s.id !== target.id && inFolder(path, s.path)).map((s) => ({ name: s.name, path: s.path! }))
    return { name, path, file: PROMPT_FILE, text: await readFolderPrompt(path), outer: outer.map((f) => f.name) }
  }

  async writePrompt(target: PromptTarget, text: string): Promise<void> {
    await writeFolderPrompt(this.promptTarget(target).path, text)
  }

  // Separators ---------------------------------------------------------------------------------

  sections(): ProjectSection[] {
    return [...this.sectionList]
  }

  section(id: string): ProjectSection | undefined {
    return this.sectionList.find((s) => s.id === id)
  }

  /** The separator of a folder, if one stands for it. */
  sectionByPath(path: string): ProjectSection | undefined {
    const key = folderKey(path)
    return this.sectionList.find((s) => s.path && folderKey(s.path) === key)
  }

  /** A new separator after `after` (else last); for a folder that has one already, that one. */
  async createSection(input: SectionCreateInput): Promise<ProjectSection> {
    const path = input.path ? resolve(input.path) : undefined
    const existing = path ? this.sectionByPath(path) : undefined
    if (existing) return existing
    const section: ProjectSection = {
      id: randomUUID(),
      name: input.name?.trim() || (path ? baseName(path) : '') || 'Neuer Trenner',
      ...(path ? { path } : {}),
    }
    const after = input.after ? this.sectionList.findIndex((s) => s.id === input.after) : -1
    this.sectionList.splice(after >= 0 ? after + 1 : this.sectionList.length, 0, section)
    await this.save()
    return section
  }

  async updateSection(id: string, patch: SectionUpdateInput): Promise<ProjectSection> {
    const section = this.section(id)
    if (!section) throw new Error('Den Trenner gibt es nicht mehr.')
    if (patch.name !== undefined && patch.name.trim()) section.name = patch.name.trim()
    if (patch.collapsed !== undefined) section.collapsed = patch.collapsed
    await this.save()
    return section
  }

  /** Removes a separator; its projects go to the default one, after those there. */
  async removeSection(id: string): Promise<void> {
    if (id === DEFAULT_SECTION_ID) throw new Error(`„${DEFAULT_SECTION_NAME}“ bleibt immer da.`)
    if (!this.section(id)) return
    const moved = this.projects.filter((p) => p.sectionId === id)
    for (const project of moved) delete project.sectionId
    this.projects = [...this.projects.filter((p) => !moved.includes(p)), ...moved]
    this.sectionList = this.sectionList.filter((s) => s.id !== id)
    await this.save()
  }

  /** The order of separators and projects the user dragged them into (shared/sections.ts). */
  async arrange(layout: readonly SectionLayout[]): Promise<void> {
    const next = applyLayout(this.projects, this.sectionList, layout)
    this.projects = next.projects
    this.sectionList = next.sections
    await this.save()
  }

  /** Puts a project under a separator, first there. */
  async moveTo(id: string, sectionId: string): Promise<void> {
    const layout = layoutOf(this.projects, this.sectionList)
    const first = layout.find((entry) => entry.id === sectionId)?.projects[0] ?? null
    await this.arrange(moveProject(layout, id, sectionId, first))
  }

  /**
   * Gathers under a separator with a folder the projects in that folder that are still under the default
   * one, and orders its projects by their last activity: for a separator that has just come about.
   */
  async gather(sectionId: string): Promise<void> {
    const section = this.section(sectionId)
    if (!section) return
    const layout = layoutOf(this.projects, this.sectionList)
    const own = layout.find((entry) => entry.id === sectionId)!
    const fallback = layout.find((entry) => entry.id === DEFAULT_SECTION_ID)!
    const joining = section.path ? fallback.projects.filter((id) => inFolder(this.get(id)!.path, section.path!)) : []
    fallback.projects = fallback.projects.filter((id) => !joining.includes(id))
    const at = (id: string) => this.get(id)?.updatedAt ?? 0
    own.projects = [...own.projects, ...joining].sort((a, b) => at(b) - at(a))
    await this.arrange(layout)
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(this.file, { version: 2, sections: this.sectionList, projects: this.projects }, { guarded: true })
    this.emit('changed', this.list())
    this.emit('sections', this.sections())
  }
}

export function folderKey(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase().replace(/\//g, '\\') : normalized
}
