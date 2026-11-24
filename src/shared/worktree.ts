/**
 * Worktrees for chats, where and as Claude Code makes them with `claude --worktree <name>`: the folder
 * `.claude/worktrees/<name>` of the main checkout, on the branch `worktree-<name>`. So the name has to
 * suit a folder (on Windows too) and a git branch alike.
 */

const MAX_LENGTH = 64

/** Names Windows keeps for devices: no folder can have them, not even with an extension. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

/** Why the name doesn't work; null when it does. An empty name is fine: one is made up. */
export function worktreeNameError(raw: string): string | null {
  const name = raw.trim()
  if (!name) return null
  if (name.length > MAX_LENGTH) return `Höchstens ${MAX_LENGTH} Zeichen.`
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'Nur Buchstaben ohne Umlaute, Ziffern, Punkt, Binde- und Unterstrich.'
  if (!/^[A-Za-z0-9]/.test(name)) return 'Der Name beginnt mit einem Buchstaben oder einer Ziffer.'
  if (name.includes('..') || name.endsWith('.') || name.toLowerCase().endsWith('.lock')) {
    return 'Git erlaubt keine zwei Punkte hintereinander und kein „.“ oder „.lock“ am Ende.'
  }
  if (DEVICE_NAME.test(name)) return `„${name}“ ist unter Windows ein Gerätename.`
  return null
}

/** The branch of the worktree `name`. */
export function worktreeBranch(name: string): string {
  return `worktree-${name}`
}

/** Where the worktree `name` lies in the main checkout, `/`-separated. */
export function worktreeFolder(name: string): string {
  return `.claude/worktrees/${name}`
}

const ADJECTIVES = ['bright', 'calm', 'clever', 'eager', 'gentle', 'happy', 'keen', 'lively', 'lucky', 'merry', 'nimble', 'proud', 'quick', 'quiet', 'shiny', 'swift', 'tidy', 'witty']
const VERBS = ['baking', 'climbing', 'dancing', 'diving', 'drifting', 'flying', 'gliding', 'hopping', 'jumping', 'roaming', 'running', 'sailing', 'singing', 'skating', 'sliding', 'swimming', 'wading', 'wandering']
const ANIMALS = ['badger', 'beaver', 'crane', 'dolphin', 'falcon', 'ferret', 'fox', 'heron', 'koala', 'lynx', 'otter', 'owl', 'panda', 'puffin', 'raven', 'seal', 'tiger', 'wren']

/**
 * A name as Claude Code makes one up (`bright-running-fox`); one `taken` isn't picked as long as
 * a few tries find another.
 */
export function randomWorktreeName(taken: (name: string) => boolean = () => false, random: () => number = Math.random): string {
  const pick = (words: readonly string[]) => words[Math.floor(random() * words.length)] ?? words[0]!
  let name = ''
  for (let i = 0; i < 20; i++) {
    name = `${pick(ADJECTIVES)}-${pick(VERBS)}-${pick(ANIMALS)}`
    if (!taken(name)) return name
  }
  return `${name}-${Math.floor(random() * 1000)}`
}
