import { execFile } from 'node:child_process'

let cached: Promise<string[]> | null = null

/**
 * Installed font families (Windows: via .NET, Linux: via fontconfig), for the font pickers of the
 * settings; read once per app session. A list that couldn't be read (PowerShell busy, timed out) is
 * read again the next time. Elsewhere none: the pickers still take a typed name.
 */
export function listFontFamilies(): Promise<string[]> {
  if (!cached) {
    const loading = load()
    cached = loading
    loading.catch(() => {
      if (cached === loading) cached = null
    })
  }
  return cached.catch(() => [])
}

function load(): Promise<string[]> {
  if (process.platform === 'win32') {
    const script =
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;' +
      'Add-Type -AssemblyName System.Drawing;' +
      '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'
    return listed('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script])
  }
  // One line per font file with its first (English) family name; fontconfig is part of every desktop.
  if (process.platform === 'linux') return listed('fc-list', ['--format', '%{family[0]}\\n'])
  return Promise.resolve([])
}

function listed(file: string, args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 20000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) =>
      error ? reject(error) : resolve(fontFamilies(stdout)),
    )
  })
}

/** The families in a listing with one per line: each once, sorted by name. */
export function fontFamilies(stdout: string): string[] {
  const names = stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}
