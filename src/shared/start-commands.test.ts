import { describe, expect, it } from 'vitest'
import { MAX_START_COMMANDS, normalizeStartDir, parseStartCommands, relativeDir, startCommandError, startCommandLabel } from './start-commands'

describe('normalizeStartDir', () => {
  it('keeps a folder in the project relative, with slashes', () => {
    expect(normalizeStartDir('packages\\web\\')).toBe('packages/web')
    expect(normalizeStartDir(' ./apps//api ')).toBe('apps/api')
    expect(normalizeStartDir('')).toBe('')
    expect(normalizeStartDir('.')).toBe('')
  })

  it('refuses folders outside the project', () => {
    for (const dir of ['C:\\Windows', 'c:tools', '/etc', '\\\\server\\share', '~/code', '..', 'web/../../other']) expect(normalizeStartDir(dir)).toBeNull()
  })
})

describe('relativeDir', () => {
  it('gives a folder picked in the project relative to it', () => {
    expect(relativeDir('F:\\Projekte\\nexa', 'f:\\projekte\\nexa\\packages\\web')).toBe('packages/web')
    expect(relativeDir('F:\\Projekte\\nexa\\', 'F:\\Projekte\\nexa')).toBe('')
    expect(relativeDir('/home/me/app', '/home/me/app/server/')).toBe('server')
  })

  it('has none for a folder outside', () => {
    expect(relativeDir('F:\\Projekte\\nexa', 'F:\\Projekte\\nexa-alt')).toBeNull()
    expect(relativeDir('/home/me/app', '/home/me')).toBeNull()
  })
})

describe('parseStartCommands', () => {
  it('trims the commands and leaves out what is empty', () => {
    expect(
      parseStartCommands([
        { id: 'dev', name: ' Dev-Server ', command: ' npm run dev ', dir: './', autoStart: true },
        { id: 'api', name: '', command: 'npm start', dir: 'server\\', autoStart: false, extra: 1 },
      ]),
    ).toEqual([
      { id: 'dev', name: 'Dev-Server', command: 'npm run dev', autoStart: true },
      { id: 'api', name: '', command: 'npm start', dir: 'server' },
    ])
  })

  it('says what is wrong with one', () => {
    expect(() => parseStartCommands({})).toThrow('Die Startbefehle fehlen.')
    expect(() => parseStartCommands([{ id: 'a', name: '', command: '  ' }])).toThrow('Startbefehl 1: Gib den Befehl an')
    expect(() => parseStartCommands([{ id: 'a', name: '', command: 'npm i\nnpm run dev' }])).toThrow('Der Befehl ist eine Zeile.')
    expect(() => parseStartCommands([{ id: 'a', name: '', command: 'x', dir: '../other' }])).toThrow('Startbefehl 1: Der Ordner „../other“ liegt nicht im Projekt.')
    expect(() =>
      parseStartCommands([
        { id: 'a', name: '', command: 'x' },
        { id: 'a', name: '', command: 'y' },
      ]),
    ).toThrow('Startbefehl 2 hat keine gültige ID.')
    expect(() => parseStartCommands([{ id: 'a b', name: '', command: 'x' }])).toThrow('keine gültige ID')
    const many = Array.from({ length: MAX_START_COMMANDS + 1 }, (_, i) => ({ id: `c${i}`, name: '', command: 'x' }))
    expect(() => parseStartCommands(many)).toThrow(`höchstens ${MAX_START_COMMANDS}`)
  })
})

describe('start command texts', () => {
  it('names a command by its name, else by itself', () => {
    expect(startCommandLabel({ name: 'Web', command: 'npm run dev' })).toBe('Web')
    expect(startCommandLabel({ name: ' ', command: 'npm run dev' })).toBe('npm run dev')
  })

  it('checks a command', () => {
    expect(startCommandError('npm run dev')).toBeNull()
    expect(startCommandError('x'.repeat(2001))).toMatch('zu lang')
  })
})
