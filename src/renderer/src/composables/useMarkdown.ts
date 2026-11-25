import MarkdownIt from 'markdown-it'
import { fenceLanguage, hasLanguage, highlightCode, loadLanguage } from '@/lib/syntax'

function createRenderer(breaks: boolean) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks,
    typographer: false,
    // Code blocks in a loaded language come highlighted (escaped by highlight.js), the others plain.
    highlight: (code, info) => {
      const language = fenceLanguage(info)
      const html = language ? highlightCode(code, language) : null
      return html ? `<pre><code class="hljs language-${language}">${html}</code></pre>` : ''
    },
  })
  // markdown-it drops `file:` links to plain text. The CLIs link files they wrote that way (Antigravity
  // its walkthroughs, Codex the files it touched); a click never navigates (`handleMarkdownClick`).
  const defaultValidateLink = md.validateLink.bind(md)
  md.validateLink = (url) => /^file:/i.test(url.trim()) || defaultValidateLink(url)
  const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
    return defaultLinkOpen(tokens, idx, options, env, self)
  }
  // Every code block gets a copy button (Markdown.vue handles the click).
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) =>
    defaultFence(tokens, idx, options, env, self).replace(/^<pre>/, '<pre><button type="button" data-copy class="code-copy" aria-label="Code kopieren"></button>')
  // Tables in a frame of their own that scrolls (the header stays), sorted by a click on a header
  // cell (Markdown.vue). Only header cells are `th` in markdown.
  md.renderer.rules.table_open = () => '<div class="md-table"><table>\n'
  md.renderer.rules.table_close = () => '</table></div>\n'
  md.renderer.rules.th_open = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('tabindex', '0')
    tokens[idx].attrSet('aria-sort', 'none')
    return self.renderToken(tokens, idx, options)
  }
  return md
}

const instances = new Map<boolean, ReturnType<typeof createRenderer>>()

/**
 * Shared markdown renderer. Raw HTML is disabled, so the output is safe for v-html. `breaks`: every
 * line break counts, as in what a user typed; Claude's answers are markdown where it doesn't.
 */
export function useMarkdown(breaks = false) {
  let md = instances.get(breaks)
  if (!md) instances.set(breaks, (md = createRenderer(breaks)))
  return { render: (source: string) => md.render(source) }
}

/** The languages of the code blocks in a markdown text, as highlight.js names them. */
export function fenceLanguages(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(/^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`]+)/gm)) {
    const language = fenceLanguage(match[1]!)
    if (language) found.add(language)
  }
  return [...found]
}

/**
 * Loads the languages of a text's code blocks that aren't loaded yet; true when one was, so the text is
 * rendered again with them highlighted.
 */
export async function loadFenceLanguages(source: string): Promise<boolean> {
  const missing = fenceLanguages(source).filter((language) => !hasLanguage(language))
  if (missing.length === 0) return false
  const loaded = await Promise.all(missing.map(loadLanguage))
  return loaded.some(Boolean)
}

/**
 * The file a link in an answer points to: an absolute path or a `file://` URL (Windows `file:///C:/…`,
 * elsewhere `file:///home/…`), without a line anchor (`#L12`); null for anything else. Not a share
 * (`//server/…`): opening it would make Windows sign in to that server with the user's account.
 */
export function linkedFile(href: string): string | null {
  const match = /^(?:file:\/\/)?(\/?[a-z]:[\\/].*|\/(?!\/).*)$/i.exec(href.trim())
  if (!match) return null
  let path = match[1]!.replace(/#L\d+.*$/, '')
  // `file:///C:/x` leaves `/C:/x`: the drive comes first on Windows.
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1)
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}

/**
 * Opens markdown links in the system browser instead of navigating the app window; a linked file
 * through `openFile`, which asks before running a program or script.
 */
export function handleMarkdownClick(event: MouseEvent, openFile: (path: string) => Promise<void>): void {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  if (!anchor) return
  event.preventDefault()
  const href = anchor.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) {
    void window.api.app.openExternal(href)
    return
  }
  const file = linkedFile(href)
  if (file) void openFile(file)
}
