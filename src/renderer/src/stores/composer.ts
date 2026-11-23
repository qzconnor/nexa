import { defineStore } from 'pinia'

export interface Draft {
  text: string
  images: string[]
}

type Inserter = (text: string) => void

/**
 * What is written in the composers but not sent, by chat, and text that other parts of the window put
 * into them: a file mentioned in the file tree, review comments on changes. The composer showing a chat
 * puts it at its cursor; for a chat not on screen it goes to the end of its draft.
 */
export const useComposerStore = defineStore('composer', () => {
  const drafts = new Map<string, Draft>()
  const inserters = new Map<string, Inserter>()

  const draftOf = (key: string): Draft | undefined => drafts.get(key)

  function saveDraft(key: string, draft: Draft): void {
    if (draft.text || draft.images.length) drafts.set(key, { text: draft.text, images: [...draft.images] })
    else drafts.delete(key)
  }

  /** The composer that shows the chat `key` takes the text inserted for it, until `detach`. */
  function attach(key: string, insert: Inserter): void {
    inserters.set(key, insert)
  }

  function detach(key: string, insert: Inserter): void {
    if (inserters.get(key) === insert) inserters.delete(key)
  }

  function insert(key: string, text: string): void {
    const inserter = inserters.get(key)
    if (inserter) return inserter(text)
    const draft = drafts.get(key) ?? { text: '', images: [] }
    const gap = draft.text && !/\s$/.test(draft.text) ? ' ' : ''
    drafts.set(key, { ...draft, text: `${draft.text}${gap}${text}` })
  }

  return { draftOf, saveDraft, attach, detach, insert }
})
