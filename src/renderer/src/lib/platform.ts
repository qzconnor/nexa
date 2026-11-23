/** What differs between the Windows and the other builds, known before the app info has loaded. */
export const isWindows = window.api.platform === 'win32'

/** Acrylic and Mica are Windows 11 backdrops; elsewhere the window is opaque. */
export const supportsMaterial = isWindows

/** What opens a folder. */
export const fileManagerLabel = isWindows ? 'Explorer' : 'Dateimanager'
