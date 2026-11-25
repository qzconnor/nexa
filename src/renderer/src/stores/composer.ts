import { defineStore } from 'pinia'

export interface Draft {
  text: string
  images: string[]
}

type Inserter = (text: string) => void
type Reader = () => Draft

/**
 * What is written in the composers but not sent, by chat, and text that other parts of the window put
 * into them: a file mentioned in the file tree, review comments on changes. The composer showing a chat
 * puts it at its cursor; for a chat not on screen it goes to the end of its draft.
 */
export const useComposerStore = defineStore('composer', () => {
  const drafts = new Map<string, Draft>()
  const inserters = new Map<string, Inserter>()
  const readers = new Map<string, Reader>()

  const draftOf = (key: string): Draft | undefined => drafts.get(key)

  /** What is written for the chat right now: in the composer that shows it, else its saved draft. */
  function liveDraft(key: string): Draft | undefined {
    const read = readers.get(key)
    if (!read) return drafts.get(key)
    const draft = read()
    return draft.text || draft.images.length ? { text: draft.text, images: [...draft.images] } : undefined
  }

  function saveDraft(key: string, draft: Draft): void {
    if (draft.text || draft.images.length) drafts.set(key, { text: draft.text, images: [...draft.images] })
    else drafts.delete(key)
  }

  /** The composer that shows the chat `key` takes the text inserted for it and tells what it holds, until `detach`. */
  function attach(key: string, insert: Inserter, read?: Reader): void {
    inserters.set(key, insert)
    if (read) readers.set(key, read)
    else readers.delete(key)
  }

  function detach(key: string, insert: Inserter): void {
    if (inserters.get(key) !== insert) return
    inserters.delete(key)
    readers.delete(key)
  }

  function insert(key: string, text: string): void {
    const inserter = inserters.get(key)
    if (inserter) return inserter(text)
    const draft = drafts.get(key) ?? { text: '', images: [] }
    const gap = draft.text && !/\s$/.test(draft.text) ? ' ' : ''
    drafts.set(key, { ...draft, text: `${draft.text}${gap}${text}` })
  }

  // The project's files for `@`. Asked again after a while: the agent adds and removes files as it works.
  const fileLists = new Map<string, { at: number; list: Promise<readonly string[]> }>()
  const FILES_MAX_AGE_MS = 20_000

  /** The files of a project folder, relative to it. */
  function filesOf(root: string): Promise<readonly string[]> {
    const cached = fileLists.get(root)
    if (cached && Date.now() - cached.at < FILES_MAX_AGE_MS) return cached.list
    const list = window.api.files
      .searchList(root)
      .then((result) => Object.freeze(result.paths))
      .catch(() => cached?.list ?? ([] as readonly string[]))
    fileLists.set(root, { at: Date.now(), list })
    return list
  }

  return { draftOf, liveDraft, saveDraft, attach, detach, insert, filesOf }
})
