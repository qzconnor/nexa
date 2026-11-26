import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

/**
 * `nexa-file://image?path=<path>`: images on disk (attachments, screenshots) for the chat;
 * `nexa-file://device?instance=<device>&session=<chat>&path=<path>`: one of a chat of another device.
 */
export const FILE_SCHEME = 'nexa-file'

/** A picture as another device gives it (`sessions:image`). */
export interface RemoteImage {
  type: string
  data: string
}

type RemoteImages = (device: string, sessionId: string, path: string) => Promise<RemoteImage | null>

let remoteImages: RemoteImages | null = null
/** The pictures of another device's chats, kept a while: a chat shows the same ones again and again. */
const remoteCache = new Map<string, RemoteImage>()
const REMOTE_CACHE_BYTES = 64 * 1024 * 1024
let remoteCacheBytes = 0

/** How pictures of other devices' chats come here (Remote Control); null: not at all. */
export function setRemoteImages(fetch: RemoteImages | null): void {
  remoteImages = fetch
  remoteCache.clear()
  remoteCacheBytes = 0
}

async function remoteImage(url: URL): Promise<Response> {
  const device = url.searchParams.get('instance')
  const sessionId = url.searchParams.get('session')
  const path = url.searchParams.get('path')
  if (!device || !sessionId || !path || !remoteImages) return new Response('Not found', { status: 404 })
  const key = `${device}\0${sessionId}\0${path}`
  let image = remoteCache.get(key) ?? null
  if (image) {
    remoteCache.delete(key)
    remoteCache.set(key, image)
  } else {
    image = await remoteImages(device, sessionId, path).catch(() => null)
    if (!image || typeof image.data !== 'string' || !/^image\/[\w.+-]+$/.test(image.type)) return new Response('Not found', { status: 404 })
    remoteCache.set(key, image)
    remoteCacheBytes += image.data.length
    for (const [old, kept] of remoteCache) {
      if (remoteCacheBytes <= REMOTE_CACHE_BYTES) break
      remoteCache.delete(old)
      remoteCacheBytes -= kept.data.length
    }
  }
  return new Response(Buffer.from(image.data, 'base64'), { headers: { 'content-type': image.type } })
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

/** Before the app is ready, with the app's other schemes: Electron keeps only the last call's list. */
export function registerFileScheme(others: Electron.CustomScheme[] = []): void {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } }, ...others])
}

/** Serves image files only; anything else is refused. */
export function handleFileProtocol(): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'device') return remoteImage(url)
    const path = url.searchParams.get('path')
    if (!path || !IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return new Response('Not found', { status: 404 })
    try {
      return await net.fetch(pathToFileURL(path).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
