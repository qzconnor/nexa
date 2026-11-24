import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { CommandStatus } from '@shared/types'

const run = promisify(execFile)

/** Where Windows looks up `nx` typed into the Explorer's address bar (src/launcher/nx.cs). */
const APP_PATH_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\nx.exe'

export interface CommandSystem {
  platform: NodeJS.Platform
  /** Only the installed app has nx.exe; a development build must never register itself. */
  packaged: boolean
  /** `<install dir>\bin\nx.exe` */
  launcher: string
  exists(path: string): boolean
  /** Runs nx.exe with one of its own switches; rejects when it ends with an error. */
  launch(file: string, args: string[]): Promise<void>
  /** The program the App Path of `nx` names; null without one. */
  appPath(): Promise<string | null>
}

/**
 * The `nx` command (Windows): nx.exe ships in `<install dir>\bin`, the installer registers it
 * (build/installer.nsh), the settings page can do the same. nx.exe edits the registry itself
 * (`--nx-register`, `--nx-unregister`, `--nx-status`).
 */
export class CommandIntegration {
  constructor(private readonly system: CommandSystem = windowsSystem()) {}

  private get available(): boolean {
    return this.system.platform === 'win32' && this.system.packaged && this.system.exists(this.system.launcher)
  }

  async status(): Promise<CommandStatus> {
    if (!this.available) return { available: false, registered: false, launcherPath: null, hint: null }
    const { launcher } = this.system
    const registered = await this.system.launch(launcher, ['--nx-status']).then(
      () => true,
      () => false,
    )
    // nx.exe never takes over the `nx` of another program, and says so only in a console.
    const owner = registered ? null : await this.system.appPath()
    const hint =
      owner && !samePath(owner, launcher) && this.system.exists(owner)
        ? `„nx“ ist schon für ${owner} registriert. Nexa übernimmt keinen fremden Befehl: Entferne erst das andere Programm oder dessen Befehl.`
        : null
    return { available: true, registered, launcherPath: launcher, hint }
  }

  async setRegistered(registered: boolean): Promise<CommandStatus> {
    if (!this.available) throw new Error('Den Befehl „nx“ gibt es nur in der installierten App unter Windows.')
    await this.system.launch(this.system.launcher, [registered ? '--nx-register' : '--nx-unregister'])
    return this.status()
  }
}

function windowsSystem(): CommandSystem {
  return {
    platform: process.platform,
    packaged: app.isPackaged,
    launcher: join(dirname(process.execPath), 'bin', 'nx.exe'),
    exists: existsSync,
    launch: async (file, args) => {
      await run(file, args, { windowsHide: true, timeout: 15_000 })
    },
    appPath: windowsAppPath,
  }
}

/** The program the App Path of `nx` names; null without one. */
async function windowsAppPath(): Promise<string | null> {
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  try {
    const { stdout } = await run(reg, ['query', APP_PATH_KEY, '/ve'], { windowsHide: true, timeout: 5000 })
    return parseDefaultValue(stdout)
  } catch {
    return null
  }
}

/** The default value in the output of `reg query … /ve`; its name, (Standard) or (Default), depends on the language. */
export function parseDefaultValue(output: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const match = /^[ \t]+\S.*?[ \t]{2,}REG_(?:EXPAND_)?SZ[ \t]+(\S.*?)[ \t\r]*$/m.exec(output)
  if (!match) return null
  const value = match[1].replace(/^"(.*)"$/, '$1')
  return value.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole)
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase()
}
