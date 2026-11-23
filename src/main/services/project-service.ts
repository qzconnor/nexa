import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ProjectCreateInput } from '@shared/ipc'
import type { Project } from '@shared/types'
import { baseName } from '@shared/utils'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'

/** Folders the agents work in; every session belongs to one (projects.json in the app's data). */
export class ProjectService extends TypedEmitter<{ changed: [Project[]] }> {
  private readonly file: string
  private projects: Project[]

  constructor(dataDir: string) {
    super()
    this.file = join(dataDir, 'projects.json')
    const saved = readJsonGuardedSync<{ projects?: Project[] }>(this.file)
    this.projects = Array.isArray(saved?.projects) ? saved.projects : []
  }

  list(): Project[] {
    return [...this.projects].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  /** The project of a folder, if there is one (case-insensitive on Windows). */
  byPath(path: string): Project | undefined {
    const key = folderKey(path)
    return this.projects.find((p) => folderKey(p.path) === key)
  }

  async create(input: ProjectCreateInput): Promise<Project> {
    const path = resolve(input.path)
    const existing = this.byPath(path)
    if (existing) return existing
    if (!existsSync(path)) {
      if (!input.create) throw new Error(`Den Ordner „${path}“ gibt es nicht.`)
      await mkdir(path, { recursive: true })
    } else if (!statSync(path).isDirectory()) {
      throw new Error(`„${path}“ ist kein Ordner.`)
    }
    const now = Date.now()
    const project: Project = { id: randomUUID(), name: input.name?.trim() || baseName(path), path, createdAt: now, updatedAt: now }
    this.projects.push(project)
    await this.save()
    return project
  }

  async update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed' | 'pinned'>>): Promise<Project> {
    const project = this.get(id)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    if (patch.name !== undefined && patch.name.trim()) project.name = patch.name.trim()
    if (patch.collapsed !== undefined) project.collapsed = patch.collapsed
    if (patch.pinned !== undefined) project.pinned = patch.pinned
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

  private async save(): Promise<void> {
    await writeJsonAtomic(this.file, { version: 1, projects: this.projects }, { guarded: true })
    this.emit('changed', this.list())
  }
}

export function folderKey(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase().replace(/\//g, '\\') : normalized
}
