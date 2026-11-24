import type { Artifact } from '@shared/artifacts'
import { containsTerms, searchText } from '@/lib/search'

/** The page's filters: all, those the login made, those shared with it, those from a chat of Nexa's. */
export type ArtifactFilter = 'all' | 'mine' | 'shared' | 'chats'

/**
 * The artifacts that pass the filter and hold every word of the search in their title, description
 * or the title of the chat they came from.
 */
export function filterArtifacts(
  artifacts: readonly Artifact[],
  filter: ArtifactFilter,
  query: string,
  chatTitle: (artifact: Artifact) => string | null = () => null,
): Artifact[] {
  const terms = query.trim().split(/\s+/).filter(Boolean)
  return artifacts.filter((artifact) => {
    if (filter === 'mine' && !artifact.mine) return false
    if (filter === 'shared' && artifact.mine) return false
    const chat = chatTitle(artifact)
    if (filter === 'chats' && chat === null) return false
    return !terms.length || containsTerms(searchText(artifact.title, artifact.description, chat), terms)
  })
}
