import { homedir } from 'node:os'
import { join } from 'node:path'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, DeepPartial } from '@shared/types'
import { mergeKnown } from '@shared/utils'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'
import { migrateSettings } from './provider-migration'

export class SettingsService extends TypedEmitter<{ changed: [AppSettings] }> {
  private readonly file: string
  private current: AppSettings

  constructor(dataDir: string) {
    super()
    this.file = join(dataDir, 'settings.json')
    const base = defaultSettings()
    base.defaults.projectsFolder = join(homedir(), 'Projekte')
    // Settings of a CLI that is gone (Gemini CLI) fall away with mergeKnown; a default naming it goes too.
    this.current = migrateSettings(mergeKnown(base, readJsonGuardedSync<unknown>(this.file) ?? {}))
  }

  get(): AppSettings {
    return this.current
  }

  async update(patch: DeepPartial<AppSettings>): Promise<AppSettings> {
    this.current = mergeKnown(this.current, patch)
    await writeJsonAtomic(this.file, this.current, { guarded: true })
    this.emit('changed', this.current)
    return this.current
  }
}
