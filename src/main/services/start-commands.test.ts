import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StartCommandRun } from '@shared/start-commands'
import type { Project, StartCommand } from '@shared/types'
import { StartCommands } from './start-commands'
import type { ShellLaunch } from './user-shells'

/** The commands run as Node scripts: the same everywhere, and nothing but Node starts. */
const node = (script: string): ShellLaunch => ({ name: 'Node', file: process.execPath, args: ['-e', script] })

const QUICK = "console.log('bereit in ' + process.cwd())"
const FAILS = "console.error('kaputt'); process.exit(3)"
const SERVER = "console.log('läuft'); setInterval(() => {}, 1000)"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-start-'))
  mkdirSync(join(dir, 'web'))
})

// A process that was just ended may hold its folder a moment longer (Windows).
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))

function setup(commands: StartCommand[], launch: (command: string) => ShellLaunch = node) {
  const project: Project = { id: 'p', name: 'App', path: dir, createdAt: 0, updatedAt: 0, startCommands: commands }
  const projects = {
    get: (id: string) => (id === project.id ? project : undefined),
    setStartCommands: async (_id: string, list: StartCommand[]) => {
      project.startCommands = list
      return project
    },
  }
  const service = new StartCommands(projects, launch)
  /** The first runs reported that `test` accepts. */
  const until = (test: (runs: StartCommandRun[]) => boolean) =>
    new Promise<StartCommandRun[]>((resolve) => {
      if (test(service.runs())) return resolve(service.runs())
      const off = service.on('changed', (runs) => {
        if (!test(runs)) return
        off()
        resolve(runs)
      })
    })
  const run = (id: string) => service.runs().find((r) => r.commandId === id)
  return { project, service, until, run }
}

describe('StartCommands', () => {
  it('runs a command in its folder and keeps its output once it ended', async () => {
    const { service, until, run } = setup([{ id: 'dev', name: 'Web', command: QUICK, dir: 'web' }])
    service.start('p', 'dev')
    expect(run('dev')).toMatchObject({ status: 'running', name: 'Web', shell: 'Node', cwd: join(dir, 'web') })
    await until((runs) => runs[0]?.status !== 'running')
    expect(run('dev')).toMatchObject({ status: 'done', exitCode: 0 })
    expect(service.output('p', 'dev')).toEqual({ text: expect.stringContaining(`bereit in ${join(dir, 'web')}`), truncated: false })
  }, 20_000)

  it('reports a command that fails, with its exit code', async () => {
    const { service, until, run } = setup([{ id: 'x', name: '', command: FAILS }])
    service.start('p', 'x')
    await until((runs) => runs[0]?.status !== 'running')
    expect(run('x')).toMatchObject({ status: 'error', exitCode: 3 })
    expect(service.output('p', 'x').text).toContain('kaputt')
  }, 20_000)

  it('stops one that runs, and starts it again', async () => {
    const { service, until, run } = setup([{ id: 'srv', name: '', command: SERVER }])
    service.start('p', 'srv')
    const first = run('srv')!.startedAt
    // Started twice, it still runs once.
    service.start('p', 'srv')
    await new Promise((resolve) => setTimeout(resolve, 300))
    service.restart('p', 'srv')
    await until((runs) => runs[0]?.status === 'running' && runs[0].startedAt !== first)
    service.stop('p', 'srv')
    await until((runs) => runs[0]?.status === 'stopped')
    expect(run('srv')!.exitCode).toBeUndefined()
  }, 20_000)

  it('says why one could not start', () => {
    const { service, run } = setup(
      [
        { id: 'gone', name: '', command: QUICK, dir: 'fehlt' },
        { id: 'shell', name: '', command: QUICK },
      ],
      () => {
        throw new Error('Git Bash ist nicht installiert')
      },
    )
    service.start('p', 'gone')
    service.start('p', 'shell')
    expect(run('gone')).toMatchObject({ status: 'error', error: `Den Ordner „${join(dir, 'fehlt')}“ gibt es nicht.` })
    expect(run('shell')).toMatchObject({ status: 'error', error: 'Git Bash ist nicht installiert', shell: '' })
    expect(() => service.start('p', 'unbekannt')).toThrow('Den Startbefehl gibt es nicht mehr.')
    expect(() => service.start('q', 'gone')).toThrow('Das Projekt gibt es nicht mehr.')
  })

  it('starts the commands with autoStart once, as the first chat of the project opens', async () => {
    const { service, until, run } = setup([
      { id: 'srv', name: '', command: SERVER, autoStart: true },
      { id: 'manual', name: '', command: QUICK },
    ])
    service.chatOpened('p')
    expect(run('srv')?.status).toBe('running')
    expect(run('manual')).toBeUndefined()
    service.stop('p', 'srv')
    await until((runs) => runs[0]?.status === 'stopped')
    // Stopped by the user: another chat of the project doesn't start it again.
    service.chatOpened('p')
    expect(run('srv')?.status).toBe('stopped')
  }, 20_000)

  it('ends and forgets a run whose command is gone', async () => {
    const { project, service, until, run } = setup([
      { id: 'srv', name: '', command: SERVER },
      { id: 'other', name: '', command: QUICK },
    ])
    service.start('p', 'srv')
    service.start('p', 'other')
    await until((runs) => runs.find((r) => r.commandId === 'other')?.status === 'done')
    const saved = await service.save('p', [{ id: 'other', name: ' Andere ', command: QUICK }])
    expect(saved.startCommands).toEqual([{ id: 'other', name: 'Andere', command: QUICK }])
    expect(run('srv')).toBeUndefined()
    expect(run('other')).toBeDefined()
    // The project went: so do its runs.
    service.projectsChanged([{ ...project, id: 'q' }])
    expect(service.runs()).toEqual([])
    await expect(service.save('p', [{ id: 'a', name: '', command: '' }])).rejects.toThrow('Startbefehl 1: Gib den Befehl an')
  }, 20_000)

  it('ends what runs as Nexa quits', async () => {
    const { service, run } = setup([{ id: 'srv', name: '', command: SERVER }])
    service.start('p', 'srv')
    await service.dispose()
    expect(run('srv')?.status).toBe('stopped')
    // Nothing starts any more.
    service.start('p', 'srv')
    expect(run('srv')?.status).toBe('stopped')
  }, 20_000)
})
