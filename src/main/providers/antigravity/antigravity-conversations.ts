import { randomUUID } from 'node:crypto'
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { antigravityPaths } from '../../accounts/cli-files'

/**
 * Antigravity CLI's conversations on disk: one SQLite database each (`antigravity-cli/conversations/<id>.db`,
 * in WAL mode), its steps as protobuf messages without a published schema. Nexa reads only what it
 * needs (each step's kind and time) and copies a conversation to fork it, to cut it before an edited
 * prompt, or to take it to another account. Layout: docs/PROTOCOLS.md, „Antigravity CLI“.
 */

/** A step of a conversation: Antigravity's kind of step and when it was made (ms; null if unreadable). */
export interface AntigravityStep {
  type: number
  at: number | null
}

/** The kind of step of the user's input, one per prompt. */
export const USER_STEP = 14

/** The database of a conversation in a data folder (`--gemini-dir`). */
export function conversationFile(dir: string, id: string): string {
  return join(antigravityPaths(dir).conversationsDir, `${id}.db`)
}

/**
 * When the conversation was written to last: its database or the log next to it, which holds what
 * came since the last checkpoint. Null when there is none.
 */
export async function conversationMtime(dir: string, id: string): Promise<number | null> {
  const file = conversationFile(dir, id)
  const [db, wal] = await Promise.all([stat(file).catch(() => null), stat(`${file}-wal`).catch(() => null)])
  return db ? Math.max(db.mtimeMs, wal?.mtimeMs ?? 0) : null
}

// ------------------------------------------------------------------------------------------
// Protobuf, as far as Nexa reads it

type Field = { field: number; wire: number; value: number; bytes: Buffer | null }

function varint(buf: Buffer, pos: number): [number, number] {
  let result = 0
  let mul = 1
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint')
    const b = buf[pos++]!
    result += (b & 0x7f) * mul
    if (!(b & 0x80)) return [result, pos]
    mul *= 128
  }
}

/** The top-level fields of a message; throws on one that isn't protobuf. */
function fields(buf: Buffer): Field[] {
  const out: Field[] = []
  let pos = 0
  while (pos < buf.length) {
    let key: number
    ;[key, pos] = varint(buf, pos)
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) {
      let value: number
      ;[value, pos] = varint(buf, pos)
      out.push({ field, wire, value, bytes: null })
    } else if (wire === 2) {
      let len: number
      ;[len, pos] = varint(buf, pos)
      if (pos + len > buf.length) throw new Error('truncated field')
      out.push({ field, wire, value: len, bytes: buf.subarray(pos, pos + len) })
      pos += len
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4
      out.push({ field, wire, value: 0, bytes: null })
    } else throw new Error(`wire type ${wire}`)
  }
  return out
}

/** The packed numbers of a length-delimited field, or a number field's value; null when it isn't there. */
function numbersOf(buf: Buffer, field: number): number[] | null {
  for (const f of fields(buf)) {
    if (f.field !== field) continue
    if (f.wire === 0) return [f.value]
    if (f.bytes) {
      const out: number[] = []
      let pos = 0
      while (pos < f.bytes.length) {
        let value: number
        ;[value, pos] = varint(f.bytes, pos)
        out.push(value)
      }
      return out
    }
  }
  return null
}

/** When a step was made: field 1 of its metadata, a `google.protobuf.Timestamp` (seconds, nanos). */
export function stepTime(metadata: Uint8Array | null | undefined): number | null {
  if (!metadata?.length) return null
  try {
    const created = fields(Buffer.from(metadata)).find((f) => f.field === 1 && f.bytes)
    if (!created?.bytes) return null
    const time = fields(created.bytes)
    const seconds = time.find((f) => f.field === 1 && f.wire === 0)?.value
    const nanos = time.find((f) => f.field === 2 && f.wire === 0)?.value ?? 0
    return seconds === undefined ? null : seconds * 1000 + Math.floor(nanos / 1e6)
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------------------------
// Reading and copying

function open(file: string, readOnly: boolean): DatabaseSync {
  // Antigravity may be writing to it: wait a while for its lock instead of failing at once.
  return new DatabaseSync(file, { readOnly, timeout: 5000 })
}

/** The steps of a conversation in their order; empty when its database can't be read. */
export function readSteps(file: string): AntigravityStep[] {
  let db: DatabaseSync | null = null
  try {
    db = open(file, true)
    return db
      .prepare('SELECT step_type AS type, metadata FROM steps ORDER BY idx')
      .all()
      .map((row) => ({ type: Number(row.type), at: stepTime(row.metadata as Uint8Array | null) }))
  } catch {
    return []
  } finally {
    db?.close()
  }
}

/** The times of the user's prompts in a conversation, in order; null when one of them is unreadable. */
export function promptTimes(steps: readonly AntigravityStep[]): number[] | null {
  const times = steps.filter((s) => s.type === USER_STEP).map((s) => s.at)
  return times.every((t): t is number => t !== null) ? times : null
}

/**
 * Where a conversation is cut to end before `at` (ms): at its first prompt made then or later; its
 * length when none was. Null when a prompt's time is unreadable.
 */
export function cutIndex(steps: readonly AntigravityStep[], at: number): number | null {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    if (step.type !== USER_STEP) continue
    if (step.at === null) return null
    if (step.at >= at) return i
  }
  return steps.length
}

/** Swaps ids of the same length in every blob of the database (ids sit in the steps' protobuf). */
function swapIds(db: DatabaseSync, swaps: [string, string][]): void {
  const pairs = swaps.filter(([a, b]) => a !== b && a.length === b.length).map(([a, b]) => [Buffer.from(a), Buffer.from(b)] as const)
  if (!pairs.length) return
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  for (const { name } of tables) {
    const table = String(name)
    for (const column of db.prepare(`PRAGMA table_info("${table}")`).all()) {
      const col = String(column.name)
      const update = db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE rowid = ?`)
      for (const row of db.prepare(`SELECT rowid AS id, "${col}" AS v FROM "${table}" WHERE typeof("${col}") = 'blob'`).all()) {
        const buf = Buffer.from(row.v as Uint8Array)
        let changed = false
        for (const [from, to] of pairs) {
          for (let at = buf.indexOf(from); at >= 0; at = buf.indexOf(from, at + to.length)) {
            to.copy(buf, at)
            changed = true
          }
        }
        if (changed) update.run(buf, row.id as number)
      }
    }
  }
}

/**
 * Drops the steps from `index` on, with the records of the model's answers (`gen_metadata`, field 2:
 * the steps an answer made) and of the turns (`executor_metadata`, field 3: a turn's last step) that
 * belong to them.
 */
function cutAt(db: DatabaseSync, index: number): void {
  db.prepare('DELETE FROM steps WHERE idx >= ?').run(index)
  const drop = (table: string, field: number, gone: (numbers: number[]) => boolean) => {
    const remove = db.prepare(`DELETE FROM ${table} WHERE idx = ?`)
    for (const row of db.prepare(`SELECT idx, data FROM ${table}`).all()) {
      const numbers = row.data ? numbersOf(Buffer.from(row.data as Uint8Array), field) : null
      if (numbers?.length && gone(numbers)) remove.run(row.idx as number)
    }
  }
  drop('gen_metadata', 2, (steps) => Math.min(...steps) >= index)
  drop('executor_metadata', 3, ([last]) => last! >= index)
}

/**
 * Copies a conversation (its database and artifacts) to another data folder or under another id; with
 * `before`, only what came before its first prompt made at that time (ms) or later. False when there
 * is no conversation to copy, nothing of it remains, or its prompts' times can't be read.
 */
export async function copyConversation(from: { dir: string; id: string }, to: { dir: string; id: string }, before?: number): Promise<boolean> {
  const source = conversationFile(from.dir, from.id)
  if (!(await stat(source).catch(() => null))) return false
  const target = conversationFile(to.dir, to.id)
  await mkdir(antigravityPaths(to.dir).conversationsDir, { recursive: true })
  const temp = `${target}.nexa-${randomUUID()}.tmp`
  try {
    // A consistent copy even while Antigravity writes to it, its log (`-wal`) included.
    const src = open(source, true)
    try {
      src.exec(`VACUUM INTO '${temp.replace(/'/g, "''")}'`)
    } finally {
      src.close()
    }
    const db = open(temp, false)
    try {
      if (from.id !== to.id) {
        const meta = db.prepare('SELECT trajectory_id, cascade_id FROM trajectory_meta').get()
        const trajectory = String(meta?.trajectory_id ?? '')
        const fresh = randomUUID()
        swapIds(db, [
          [String(meta?.cascade_id ?? from.id), to.id],
          [trajectory, fresh],
        ])
        db.prepare('UPDATE trajectory_meta SET trajectory_id = ?, cascade_id = ?').run(fresh, to.id)
      }
      if (before !== undefined) {
        const steps = db
          .prepare('SELECT step_type AS type, metadata FROM steps ORDER BY idx')
          .all()
          .map((row) => ({ type: Number(row.type), at: stepTime(row.metadata as Uint8Array | null) }))
        const index = cutIndex(steps, before)
        if (index === null || index === 0) return false
        if (index < steps.length) cutAt(db, index)
      }
    } finally {
      db.close()
    }
    // An older copy's log would be played onto the new database when it is opened.
    await Promise.all([rm(`${target}-wal`, { force: true }), rm(`${target}-shm`, { force: true })])
    await rename(temp, target)
  } finally {
    await rm(temp, { force: true }).catch(() => undefined)
  }
  const brain = join(antigravityPaths(from.dir).brainDir, from.id)
  if (await stat(brain).catch(() => null)) {
    await cp(brain, join(antigravityPaths(to.dir).brainDir, to.id), { recursive: true, force: true }).catch(() => undefined)
  }
  return true
}
