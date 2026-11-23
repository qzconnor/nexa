import { join } from 'node:path'

export const APP_NAME = 'Nexa'

/** The app's data: `%APPDATA%\Nexa`; development builds get `Nexa Dev`, so both can run side by side. */
export function userDataFolder(appData: string, dev: boolean): string {
  return join(appData, dev ? `${APP_NAME} Dev` : APP_NAME)
}
