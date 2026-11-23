import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

/** `nexa-file://image?path=<path>`: images on disk (attachments, screenshots) for the chat. */
export const FILE_SCHEME = 'nexa-file'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** Before the app is ready. */
export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } }])
}

/** Serves image files only; anything else is refused. */
export function handleFileProtocol(): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    const path = new URL(request.url).searchParams.get('path')
    if (!path || !IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return new Response('Not found', { status: 404 })
    try {
      return await net.fetch(pathToFileURL(path).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
