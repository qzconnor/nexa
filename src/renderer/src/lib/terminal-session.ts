import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { terminalKey } from './terminal-keys'

/** How a terminal looks: the theme's palette and the code font of the settings. */
export interface TerminalLook {
  theme: ITheme
  fontFamily: string
  fontSize: number
}

/**
 * One terminal's xterm in the window, kept for as long as its shell runs: leaving the chat or closing
 * the panel only takes its element out of the page, and it comes back with all it showed. What the
 * shell wrote before there was a view (after a reload) comes from main's buffer first; output that
 * arrives meanwhile and is in the buffer already is dropped by where it ends.
 */
export class TerminalSession {
  /** Moved into the panel while the terminal is shown. */
  readonly element = document.createElement('div')
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private opened = false
  /** Where the output drawn ends (`TerminalBuffer.end`); null until the buffer came. */
  private end: number | null = null
  private early: { data: string; end: number }[] = []
  private exited = false

  constructor(
    readonly id: string,
    look: TerminalLook,
    /** A link Ctrl+clicked in the output. */
    openLink: (url: string) => void,
  ) {
    this.element.className = 'h-full w-full'
    this.term = new Terminal({
      allowTransparency: true,
      // The Unicode 11 widths (emoji) are a proposed API of xterm.
      allowProposedApi: true,
      cursorBlink: true,
      scrollback: 10_000,
      lineHeight: 1.15,
      fontFamily: look.fontFamily,
      fontSize: look.fontSize,
      theme: look.theme,
    })
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    // As in VS Code: a plain click selects, Ctrl+click follows the link.
    this.term.loadAddon(
      new WebLinksAddon((event, url) => {
        if (event.ctrlKey || event.metaKey) openLink(url)
      }),
    )
    this.term.attachCustomKeyEventHandler((event) => this.onKey(event))
    this.term.onData((data) => void window.api.terminals.write(id, data).catch(() => {}))
    this.term.onResize(({ cols, rows }) => void window.api.terminals.resize(id, { cols, rows }).catch(() => {}))
    void this.load()
  }

  private async load(): Promise<void> {
    try {
      const buffer = await window.api.terminals.buffer(this.id)
      this.term.write(buffer.text)
      this.end = buffer.end
    } catch {
      // Gone in between: the list takes it away.
      this.end = 0
    }
    const early = this.early
    this.early = []
    for (const chunk of early) this.receive(chunk.data, chunk.end)
  }

  /** Output from main; `end` counts all the shell ever wrote, up to the chunk's end. */
  receive(data: string, end: number): void {
    if (this.end === null) {
      this.early.push({ data, end })
      return
    }
    if (end <= this.end) return
    const start = end - data.length
    this.term.write(start < this.end ? data.slice(this.end - start) : data)
    this.end = end
  }

  /** Shows the terminal in `container`; xterm draws once it is in the page, with its font loaded. */
  async attach(container: HTMLElement): Promise<void> {
    container.appendChild(this.element)
    if (!this.opened) {
      this.opened = true
      // xterm measures its cells once, with the font of the moment: it has to be there by then.
      await document.fonts.load(`${this.term.options.fontSize}px ${this.term.options.fontFamily}`).catch(() => undefined)
      if (!this.element.isConnected) {
        this.opened = false
        return
      }
      this.term.open(this.element)
    }
    this.fit()
  }

  detach(): void {
    this.element.remove()
  }

  /** As many columns and rows as fit its place; the shell learns of them (onResize). */
  fit(): void {
    if (!this.opened || !this.element.isConnected || this.element.clientWidth === 0) return
    try {
      this.fitAddon.fit()
    } catch {
      // Not drawn yet.
    }
  }

  focus(): void {
    this.term.focus()
  }

  setLook(look: TerminalLook): void {
    const fontChanged = this.term.options.fontFamily !== look.fontFamily || this.term.options.fontSize !== look.fontSize
    this.term.options.theme = look.theme
    if (!fontChanged) return
    this.term.options.fontFamily = look.fontFamily
    this.term.options.fontSize = look.fontSize
    this.fit()
  }

  /** The shell ended with an error: it says so, and takes no more input. */
  markExited(code: number | null): void {
    if (this.exited) return
    this.exited = true
    this.term.write(`\r\n\x1b[2m[Shell beendet${code === null ? '' : ` mit Code ${code}`}]\x1b[0m\r\n`)
    this.term.options.disableStdin = true
    this.term.options.cursorBlink = false
  }

  dispose(): void {
    this.element.remove()
    this.term.dispose()
  }

  private onKey(event: KeyboardEvent): boolean {
    const action = terminalKey(event, this.term.hasSelection())
    if (!action) return true
    if (action === 'copy') {
      event.preventDefault()
      const text = this.term.getSelection()
      if (text) void navigator.clipboard.writeText(text)
      this.term.clearSelection()
    }
    // Paste: the browser's own paste reaches xterm's text field, which hands it to the shell. The
    // window's shortcuts: on to its listener, as if the terminal weren't there.
    return false
  }
}
