import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { antigravityPaths } from '../../accounts/cli-files'
import { conversationFile, USER_STEP } from './antigravity-conversations'

/**
 * Tests only: a conversation database as Antigravity CLI 1.5.16 writes one, as far as Nexa reads it
 * (antigravity-conversations.ts), with an artifact in its brain folder.
 */

function varint(n: number): Buffer {
  const out: number[] = []
  while (n > 127) {
    out.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}

export function protoField(f: number, value: number | string | Buffer): Buffer {
  if (typeof value === 'number') return Buffer.concat([varint(f * 8), varint(value)])
  const bytes = Buffer.from(value)
  return Buffer.concat([varint(f * 8 + 2), varint(bytes.length), bytes])
}

const packed = (f: number, values: number[]) => protoField(f, Buffer.concat(values.map(varint)))

/** A step's metadata: when it was made (field 1, a Timestamp) and whose it is (field 20, with the ids). */
function metadata(ms: number, index: number, id: string, trajectory: string): Buffer {
  return Buffer.concat([
    protoField(1, Buffer.concat([protoField(1, Math.floor(ms / 1000)), protoField(2, (ms % 1000) * 1e6)])),
    protoField(12, 'turn-id'),
    protoField(20, Buffer.concat([protoField(1, trajectory), protoField(2, index), protoField(4, id)])),
  ])
}

/**
 * Writes `conversations/<id>.db` with the steps given (kind, time in ms). Each prompt's answers get a
 * record in `gen_metadata` and its turn one in `executor_metadata`, as Antigravity keeps them.
 */
export async function writeConversation(dir: string, id: string, trajectory: string, steps: [number, number][]): Promise<string> {
  const paths = antigravityPaths(dir)
  await mkdir(paths.conversationsDir, { recursive: true })
  const file = conversationFile(dir, id)
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer, PRIMARY KEY (trajectory_id));
    CREATE TABLE steps (idx integer, step_type integer NOT NULL DEFAULT 0, status integer NOT NULL DEFAULT 0, metadata blob, step_payload blob, PRIMARY KEY (idx));
    CREATE TABLE gen_metadata (idx integer, data blob, size integer NOT NULL DEFAULT 0, PRIMARY KEY (idx));
    CREATE TABLE executor_metadata (idx integer, data blob, PRIMARY KEY (idx));
    CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob, PRIMARY KEY (id));
  `)
  db.prepare('INSERT INTO trajectory_meta VALUES (?, ?, 4, 17)').run(trajectory, id)
  steps.forEach(([type, ms], i) => db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, 3, ?, ?)').run(i, type, metadata(ms, i, id, trajectory), Buffer.from(`payload ${i}`)))
  // A turn runs from its prompt to the step before the next one; its answers made the steps after the prompt.
  const starts = steps.map(([type], i) => (type === USER_STEP ? i : -1)).filter((i) => i >= 0)
  starts.forEach((start, n) => {
    const end = (starts[n + 1] ?? steps.length) - 1
    const made = Array.from({ length: end - start }, (_, k) => start + 1 + k)
    if (made.length) db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(n, Buffer.concat([protoField(1, 'x'), packed(2, made), protoField(4, id)]))
    db.prepare('INSERT INTO executor_metadata VALUES (?, ?)').run(n, Buffer.concat([protoField(1, 4), protoField(3, end), protoField(9, trajectory)]))
  })
  db.prepare('INSERT INTO trajectory_metadata_blob VALUES (?, ?)').run('main', Buffer.concat([protoField(1, 'file:///F:/app'), protoField(2, trajectory)]))
  db.close()
  await mkdir(join(paths.brainDir, id), { recursive: true })
  await writeFile(join(paths.brainDir, id, 'walkthrough.md'), '# Fertig')
  return file
}
