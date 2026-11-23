import { describe, expect, it } from 'vitest'
import { folderKey, inFolder, innermostFolder, movedPath, subfolderSegments, windowsPath } from './folders'

describe('windowsPath', () => {
  it('writes every drive as Windows does, also from Git Bash and Cygwin', () => {
    expect(windowsPath('/f/Projekte/autodartsapi')).toBe('F:\\Projekte\\autodartsapi')
    expect(windowsPath('/cygdrive/c/Users/me')).toBe('C:\\Users\\me')
    expect(windowsPath('/d')).toBe('D:\\')
    expect(windowsPath('f:\\Projekte\\Flowtech')).toBe('F:\\Projekte\\Flowtech')
    expect(windowsPath('e:/Daten')).toBe('E:\\Daten')
  })

  it('leaves other paths alone', () => {
    for (const path of ['/home/me', '/fo/bar', '\\\\server\\share', 'relativ\\pfad', '']) expect(windowsPath(path)).toBe(path)
  })
})

describe('folderKey', () => {
  it('compares Windows folders without regard to case, slash and a trailing separator', () => {
    expect(folderKey('F:\\Code\\')).toBe(folderKey('f:/code'))
    expect(folderKey('C:\\')).toBe('c:\\')
    expect(folderKey('/home/Dev/')).toBe('/home/Dev')
  })
})

describe('inFolder', () => {
  it('is true for the folder itself and what lies in it', () => {
    expect(inFolder('C:\\dev\\app', 'c:/dev/app/')).toBe(true)
    expect(inFolder('c:/dev/app/src', 'C:\\dev\\app')).toBe(true)
    expect(inFolder('C:\\dev', 'C:\\')).toBe(true)
    expect(inFolder('/home/dev/app/src', '/home/dev/app')).toBe(true)
    expect(inFolder('/home/dev', '/')).toBe(true)
  })

  it('is false for neighbours with the same beginning and for no folder', () => {
    expect(inFolder('C:\\dev\\app-old', 'C:\\dev\\app')).toBe(false)
    expect(inFolder('/home/dev/App', '/home/dev/app')).toBe(false)
    expect(inFolder('C:\\dev', 'C:\\dev\\app')).toBe(false)
    expect(inFolder('C:\\dev', ' ')).toBe(false)
  })
})

describe('movedPath', () => {
  it('moves what lies in the folder along with it', () => {
    expect(movedPath('F:\\Kunden\\shop', 'F:\\Kunden\\shop', 'F:\\Andere\\shop')).toBe('F:\\Andere\\shop')
    expect(movedPath('f:/kunden/Shop/src/', 'F:\\Kunden\\shop', 'F:\\Andere\\shop')).toBe('F:\\Andere\\shop\\src')
    expect(movedPath('/home/dev/app/src', '/home/dev/app', '/srv/app')).toBe('/srv/app/src')
    expect(movedPath('C:\\x\\y', 'C:\\', 'D:\\')).toBe('D:\\x\\y')
  })

  it('is null outside of it', () => {
    expect(movedPath('F:\\Kunden\\shop-alt', 'F:\\Kunden\\shop', 'F:\\Andere\\shop')).toBeNull()
    expect(movedPath('F:\\Kunden', 'F:\\Kunden\\shop', 'F:\\Andere\\shop')).toBeNull()
  })
})

describe('innermostFolder', () => {
  it('finds the deepest folder a path lies in, as with nested workspaces', () => {
    const folders = ['F:\\Projekte', 'f:/projekte/apps', 'F:\\Andere']
    expect(innermostFolder('F:\\Projekte\\Apps\\nexa\\src', folders, (f) => f)).toBe('f:/projekte/apps')
    expect(innermostFolder('F:\\Projekte\\Flowtech', folders, (f) => f)).toBe('F:\\Projekte')
    expect(innermostFolder('F:\\Projekte', folders, (f) => f)).toBe('F:\\Projekte')
    expect(innermostFolder('F:\\Projekte2', folders, (f) => f)).toBeUndefined()
  })
})

describe('subfolderSegments', () => {
  it('names the folders between a folder and a path in it, as the path writes them', () => {
    expect(subfolderSegments('F:\\Projekte\\Apps\\Nexa\\src', 'f:/projekte/apps')).toEqual(['Nexa', 'src'])
    expect(subfolderSegments('F:\\Projekte\\Apps\\', 'F:\\Projekte\\Apps')).toEqual([])
    expect(subfolderSegments('F:\\Anders', 'F:\\Projekte')).toEqual([])
  })
})
