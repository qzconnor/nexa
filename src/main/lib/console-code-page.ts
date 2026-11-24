import { execFile } from 'node:child_process'
import { codePageDecoder, type ByteDecoder } from './text-encoding'

/**
 * How Windows' console programs (ping, ipconfig, cmd's `dir` …) write without a console: in the DOS
 * code page of the system (850 in Germany), while PowerShell, git and node write UTF-8. Asked once.
 */
let known: ByteDecoder | undefined
let asking: Promise<ByteDecoder | undefined> | undefined

/** The decoder of that code page; undefined off Windows or when the registry doesn't say. */
export function consoleDecoder(): Promise<ByteDecoder | undefined> {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  asking ??= new Promise((resolve) => {
    execFile('reg', ['query', String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`, '/v', 'OEMCP'], { windowsHide: true }, (error, stdout) => {
      const codePage = Number(/OEMCP\s+REG_SZ\s+(\d+)/.exec(stdout ?? '')?.[1])
      known = !error && codePage ? codePageDecoder(codePage) : undefined
      resolve(known)
    })
  })
  return asking
}

/** The decoder if the registry has answered already (it is asked otherwise); until then undefined. */
export function knownConsoleDecoder(): ByteDecoder | undefined {
  void consoleDecoder()
  return known
}
