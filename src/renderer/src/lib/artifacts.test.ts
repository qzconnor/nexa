import { describe, expect, it } from 'vitest'
import type { Artifact } from '@shared/artifacts'
import { filterArtifacts } from './artifacts'

const artifact = (id: string, patch: Partial<Artifact> = {}): Artifact => ({
  id,
  url: `https://claude.ai/artifact/${id}`,
  shortId: id,
  title: id,
  description: null,
  kind: 'page',
  mine: true,
  external: false,
  audience: null,
  createdAt: null,
  updatedAt: null,
  lastViewedAt: null,
  views: null,
  ...patch,
})

const list = [
  artifact('quartalsbericht', { description: 'Zahlen für Q3' }),
  artifact('geteilt', { mine: false, description: 'Von der Kollegin' }),
  artifact('ubersicht', { title: 'Übersicht der Dienste' }),
]

describe('filterArtifacts', () => {
  it('keeps the own or the shared ones', () => {
    expect(filterArtifacts(list, 'mine', '').map((a) => a.id)).toEqual(['quartalsbericht', 'ubersicht'])
    expect(filterArtifacts(list, 'shared', '').map((a) => a.id)).toEqual(['geteilt'])
  })

  it('searches title, description and the chat, without minding accents', () => {
    expect(filterArtifacts(list, 'all', 'zahlen q3').map((a) => a.id)).toEqual(['quartalsbericht'])
    expect(filterArtifacts(list, 'all', 'kollegin').map((a) => a.id)).toEqual(['geteilt'])
    expect(filterArtifacts(list, 'all', 'ubersicht dienste').map((a) => a.id)).toEqual(['ubersicht'])
    const chat = (a: Artifact) => (a.id === 'geteilt' ? 'Deployment planen' : null)
    expect(filterArtifacts(list, 'all', 'deployment', chat).map((a) => a.id)).toEqual(['geteilt'])
    expect(filterArtifacts(list, 'chats', '', chat).map((a) => a.id)).toEqual(['geteilt'])
  })
})
