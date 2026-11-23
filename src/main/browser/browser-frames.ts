import type { NativeImage, WebContents } from 'electron'
import { BrowserEvent } from '@shared/browser-ipc'

/** At most this many pictures a second per page; the chat's preview needs no more. */
const FRAME_INTERVAL_MS = 300
/** Wide enough for the preview in the chat on a sharp screen, small enough to send a few a second. */
const FRAME_WIDTH = 1280
const JPEG_QUALITY = 72
/** How often a watched tab without a page (asleep, not attached yet) is looked at again. */
const RETRY_MS = 1000

interface Watch {
  /** The windows that watch, with how many of their parts do. */
  hosts: Map<WebContents, number>
  contents: WebContents | null
  latest: NativeImage | null
  sentAt: number
  timer: NodeJS.Timeout | null
  retry: NodeJS.Timeout | null
}

/**
 * Live pictures of browser pages for the chat's browser cards, which only look on (the page itself
 * stays in its `<webview>`). While a window watches a tab, each painted frame of its page goes there
 * as a small JPEG, a few a second at most. A page that isn't drawn (no panel shows it and no agent
 * drives it) paints nothing: the window keeps the last picture.
 */
export class BrowserFrames {
  private readonly watches = new Map<string, Watch>()

  constructor(private readonly contentsOf: (browserId: string) => WebContents | null) {}

  /** A part of the window starts or stops watching a tab; counted, as several cards may show one. */
  watch(browserId: string, host: WebContents, on: boolean): void {
    let watch = this.watches.get(browserId)
    if (on) {
      if (!watch) {
        watch = { hosts: new Map(), contents: null, latest: null, sentAt: 0, timer: null, retry: null }
        this.watches.set(browserId, watch)
      }
      const known = watch.hosts.has(host)
      watch.hosts.set(host, (watch.hosts.get(host) ?? 0) + 1)
      if (!known) host.once('destroyed', () => this.dropHost(browserId, host))
      this.subscribe(browserId, watch)
      return
    }
    if (!watch) return
    const count = (watch.hosts.get(host) ?? 0) - 1
    if (count > 0) watch.hosts.set(host, count)
    else watch.hosts.delete(host)
    if (!watch.hosts.size) this.end(browserId, watch)
  }

  dispose(): void {
    for (const [id, watch] of this.watches) this.end(id, watch)
  }

  private dropHost(browserId: string, host: WebContents): void {
    const watch = this.watches.get(browserId)
    if (!watch) return
    watch.hosts.delete(host)
    if (!watch.hosts.size) this.end(browserId, watch)
  }

  /** Follows the tab's page, also when it comes later or anew (a tab wakes, the window reloads). */
  private subscribe(browserId: string, watch: Watch): void {
    const contents = this.contentsOf(browserId)
    if (contents && contents !== watch.contents) {
      this.unsubscribe(watch)
      watch.contents = contents
      try {
        contents.beginFrameSubscription(false, (image) => this.onFrame(browserId, watch, image))
      } catch {
        watch.contents = null
      }
      contents.once('destroyed', () => {
        if (watch.contents === contents) watch.contents = null
      })
      // The page as it is now, before it paints again (if it is drawn at all).
      void contents
        .capturePage()
        .then((image) => {
          if (watch.contents === contents && !image.isEmpty()) this.onFrame(browserId, watch, image)
        })
        .catch(() => undefined)
    }
    if (!watch.retry) {
      watch.retry = setInterval(() => {
        if (!watch.contents || watch.contents.isDestroyed() || watch.contents !== this.contentsOf(browserId)) this.subscribe(browserId, watch)
      }, RETRY_MS)
    }
  }

  private unsubscribe(watch: Watch): void {
    const contents = watch.contents
    watch.contents = null
    if (!contents || contents.isDestroyed()) return
    try {
      contents.endFrameSubscription()
    } catch {
      // Gone meanwhile.
    }
  }

  private end(browserId: string, watch: Watch): void {
    this.unsubscribe(watch)
    if (watch.timer) clearTimeout(watch.timer)
    if (watch.retry) clearInterval(watch.retry)
    this.watches.delete(browserId)
  }

  /** The newest frame goes out at once, or when the interval allows; frames in between are dropped. */
  private onFrame(browserId: string, watch: Watch, image: NativeImage): void {
    watch.latest = image
    if (watch.timer) return
    const wait = Math.max(0, watch.sentAt + FRAME_INTERVAL_MS - Date.now())
    watch.timer = setTimeout(() => {
      watch.timer = null
      const latest = watch.latest
      watch.latest = null
      if (!latest || !this.watches.has(browserId)) return
      watch.sentAt = Date.now()
      this.send(browserId, watch, latest)
    }, wait)
  }

  private send(browserId: string, watch: Watch, image: NativeImage): void {
    const size = image.getSize()
    if (!size.width || !size.height) return
    const scaled = size.width > FRAME_WIDTH ? image.resize({ width: FRAME_WIDTH, quality: 'good' }) : image
    const frame = { url: `data:image/jpeg;base64,${scaled.toJPEG(JPEG_QUALITY).toString('base64')}`, width: size.width, height: size.height }
    for (const host of watch.hosts.keys()) {
      if (!host.isDestroyed()) host.send(BrowserEvent.frame, browserId, frame)
    }
  }
}
