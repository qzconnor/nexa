import { describe, expect, it } from 'vitest'
import { applyLayout, DEFAULT_SECTION_ID, isSectionRoot, layoutOf, moveProject, moveSection, sectionForPath, sectionIdOf } from './sections'
import type { Project, ProjectSection } from './types'

const project = (id: string, sectionId?: string, path = `F:\\${id}`): Project => ({ id, name: id, path, createdAt: 0, updatedAt: 0, ...(sectionId ? { sectionId } : {}) })
const sections: ProjectSection[] = [
  { id: DEFAULT_SECTION_ID, name: 'Projekte' },
  { id: 'work', name: 'Arbeit', path: 'F:\\Work' },
  { id: 'deep', name: 'Tief', path: 'F:\\Work\\Clients' },
]

describe('sectionIdOf', () => {
  it('falls back to the default separator', () => {
    expect(sectionIdOf(project('a'), sections)).toBe(DEFAULT_SECTION_ID)
    expect(sectionIdOf(project('a', 'gone'), sections)).toBe(DEFAULT_SECTION_ID)
    expect(sectionIdOf(project('a', 'work'), sections)).toBe('work')
  })
})

describe('layoutOf', () => {
  it('lists the projects under their separators in their order', () => {
    const layout = layoutOf([project('a', 'work'), project('b'), project('c', 'work'), project('d', 'gone')], sections)
    expect(layout).toEqual([
      { id: DEFAULT_SECTION_ID, projects: ['b', 'd'] },
      { id: 'work', projects: ['a', 'c'] },
      { id: 'deep', projects: [] },
    ])
  })
})

describe('applyLayout', () => {
  it('orders separators and projects and moves projects between separators', () => {
    const projects = [project('a'), project('b', 'work'), project('c')]
    const next = applyLayout(projects, sections, [
      { id: 'work', projects: ['c', 'b'] },
      { id: DEFAULT_SECTION_ID, projects: ['a'] },
    ])
    expect(next.sections.map((s) => s.id)).toEqual(['work', DEFAULT_SECTION_ID, 'deep'])
    expect(next.projects.map((p) => [p.id, p.sectionId])).toEqual([
      ['c', 'work'],
      ['b', 'work'],
      ['a', undefined],
    ])
    // The input stays as it was.
    expect(projects[2]!.sectionId).toBeUndefined()
  })

  it('keeps what the layout doesn’t name and ignores what is gone', () => {
    const next = applyLayout([project('a'), project('b', 'work')], sections, [{ id: 'nope', projects: ['a'] }, { id: 'work', projects: ['x'] }])
    expect(next.projects.map((p) => p.id)).toEqual(['a', 'b'])
    expect(next.projects[1]!.sectionId).toBe('work')
    expect(next.sections.map((s) => s.id)).toEqual(['work', DEFAULT_SECTION_ID, 'deep'])
  })
})

describe('moveProject', () => {
  const layout = [
    { id: DEFAULT_SECTION_ID, projects: ['a', 'b', 'c'] },
    { id: 'work', projects: ['d'] },
  ]

  it('moves within a separator', () => {
    expect(moveProject(layout, 'c', DEFAULT_SECTION_ID, 'a')[0]!.projects).toEqual(['c', 'a', 'b'])
    expect(moveProject(layout, 'a', DEFAULT_SECTION_ID, null)[0]!.projects).toEqual(['b', 'c', 'a'])
    expect(moveProject(layout, 'a', DEFAULT_SECTION_ID, 'c')[0]!.projects).toEqual(['b', 'a', 'c'])
  })

  it('moves to another separator', () => {
    const next = moveProject(layout, 'b', 'work', 'd')
    expect(next).toEqual([
      { id: DEFAULT_SECTION_ID, projects: ['a', 'c'] },
      { id: 'work', projects: ['b', 'd'] },
    ])
    expect(layout[0]!.projects).toEqual(['a', 'b', 'c'])
  })
})

describe('moveSection', () => {
  const layout = [
    { id: 'a', projects: [] },
    { id: 'b', projects: [] },
    { id: 'c', projects: [] },
  ]
  it('moves before another one or to the end', () => {
    expect(moveSection(layout, 'c', 'a').map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(moveSection(layout, 'a', null).map((s) => s.id)).toEqual(['b', 'c', 'a'])
    expect(moveSection(layout, 'a', 'c').map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('sectionForPath', () => {
  it('takes the innermost separator whose folder the project lies in', () => {
    expect(sectionForPath('F:\\Work\\app', sections)).toBe('work')
    expect(sectionForPath('f:/work/clients/x', sections)).toBe('deep')
    expect(sectionForPath('F:\\Workshop', sections)).toBe(DEFAULT_SECTION_ID)
  })
})

describe('isSectionRoot', () => {
  it('is the project of the separator’s own folder', () => {
    expect(isSectionRoot(project('w', 'work', 'f:/work/'), sections[1]!)).toBe(true)
    expect(isSectionRoot(project('w', 'work', 'F:\\Work\\app'), sections[1]!)).toBe(false)
    expect(isSectionRoot(project('w'), sections[0]!)).toBe(false)
  })
})
