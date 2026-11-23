import { childFolder, subfolderSegments } from '@shared/folders'
import { sectionIdOf } from '@shared/sections'
import type { ProjectSection } from '@shared/types'
import type { ProjectService } from './project-service'
import type { SessionService } from './session-service'

/**
 * Makes a project a separator for its folder, as the Claude Manager shows a workspace: the chats in its
 * subfolders go to projects of their own under it (one per subfolder of the first level), the chats in
 * the folder itself stay in the project, which shows right below the heading. Projects in the folder
 * that are still under the default separator come along. Every chat keeps working in its folder.
 */
export async function projectToSection(projects: ProjectService, sessions: SessionService, id: string): Promise<ProjectSection> {
  const project = projects.get(id)
  if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
  const section =
    projects.sectionByPath(project.path) ??
    (await projects.createSection({ name: project.name, path: project.path, after: sectionIdOf(project, projects.sections()) }))
  await projects.moveTo(project.id, section.id)

  const moves: { id: string; projectId: string; cwd: string }[] = []
  // The latest first, so a project's last activity is right from the start.
  for (const meta of sessions.list()) {
    if (meta.projectId !== project.id || !meta.cwd) continue
    const [first] = subfolderSegments(meta.cwd, project.path)
    if (!first) continue
    try {
      const target = await projects.create({ path: childFolder(project.path, first), sectionId: section.id }, { at: meta.updatedAt, collapsed: true, end: true })
      moves.push({ id: meta.id, projectId: target.id, cwd: meta.cwd })
    } catch {
      // The subfolder is gone: the chat stays where it is.
    }
  }
  sessions.relocate(moves)
  await projects.gather(section.id)
  return section
}
