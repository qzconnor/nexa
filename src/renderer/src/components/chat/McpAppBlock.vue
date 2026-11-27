<script setup lang="ts">
import { CircleAlertIcon, Maximize2Icon, Minimize2Icon, PictureInPicture2Icon, SparklesIcon } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ToolItem } from '@shared/chat'
import { appContextText, MCP_APP_DISPLAY_MODES, type McpAppDisplayMode, type McpAppOpened, type McpAppToolResult } from '@shared/mcp-apps'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage, toastError } from '@/lib/errors'
import { CODE_FONT_FALLBACKS, fontStack, UI_FONT_FALLBACKS } from '@/lib/fonts'
import { appStyleVariables, displayModeAllowed, MAX_APP_HEIGHT, McpAppHost, type McpAppHostContext } from '@/lib/mcp-app-host'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useComposerStore } from '@/stores/composer'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import ToolRow from './ToolRow.vue'

/**
 * An MCP tool with a page of its own (MCP Apps): its row, and below it the page in a sandboxed frame,
 * served by main/mcp-apps (each page its own address and CSP). The page talks to Nexa only through
 * `postMessage`; McpAppHost answers it. It is read the first time it comes into view. In a chat of
 * another device main fetches the page from there and serves it here; the tool's result comes with it,
 * and what the page asks of its server goes there.
 *
 * Over the window (`fullscreen`) or floating in its corner (`pip`) the frame moves into a layer of its
 * own on the body: the chat's column is a size container with a mask, which would hold a `fixed` frame
 * in and fade it. `moveBefore` keeps the page as it is while it moves; without it the page loads anew
 * and asks `ui/initialize` again, which the host answers as the first time.
 */
const props = defineProps<{ tool: ToolItem; sessionId: string }>()
const settings = useSettingsStore()
const themes = useThemesStore()
const app = useAppStore()
const composer = useComposerStore()
const sessions = useSessionsStore()
const device = useDevice()
const api = useDeviceApi()
/** The result as the page of another device's chat got it (its chat here leaves results out). */
const remoteResult = ref<McpAppToolResult | null>(null)

const root = ref<HTMLElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
/** Where the frame is in the chat; empty while it shows over the window or in its corner. */
const frameSlot = ref<HTMLElement | null>(null)
/** Where it is in the layer over the window. */
const layerSlot = ref<HTMLElement | null>(null)
const url = ref<string | null>(null)
const error = ref<string | null>(null)
const height = ref(160)
const width = ref<number | undefined>(undefined)
const bordered = ref(true)
const mode = ref<McpAppDisplayMode>('inline')
/** The modes the page declared (`appCapabilities.availableDisplayModes`); null: none. */
const pageModes = ref<McpAppDisplayMode[] | null>(null)
/** The size of the place over the window or in the corner, for `containerDimensions`. */
const layerSize = ref<{ width: number; height: number } | null>(null)
/** Where the floating page was dragged to, from the window's lower right corner. */
const pipOffset = ref({ right: 16, bottom: 16 })
/** What the page last wanted the agent to know, and the user's last prompt then: it goes with the next one. */
const pendingContext = ref<{ text: string; lastPrompt: string | null } | null>(null)
let host: McpAppHost | null = null
let observer: IntersectionObserver | null = null
let sizer: ResizeObserver | null = null
let layerSizer: ResizeObserver | null = null

const theme = computed(() => themes.find(settings.settings.appearance.theme))
const allows = (next: McpAppDisplayMode) => !!url.value && displayModeAllowed(next, MCP_APP_DISPLAY_MODES, pageModes.value)

function lastPromptId(): string | null {
  return sessions.chats.get(props.sessionId)?.items.findLast((item) => item.kind === 'user')?.id ?? null
}
/** Shown under the page until a prompt took it along. */
const contextNote = computed(() => {
  const pending = pendingContext.value
  return pending && lastPromptId() === pending.lastPrompt ? pending.text : null
})

function context(): McpAppHostContext {
  const appearance = settings.settings.appearance
  const layer = mode.value !== 'inline' ? layerSize.value : null
  return {
    theme: theme.value.mode,
    styles: {
      variables: appStyleVariables(theme.value.colors, {
        sans: fontStack(appearance.uiFont, UI_FONT_FALLBACKS),
        mono: fontStack(appearance.codeFont, CODE_FONT_FALLBACKS),
      }),
    },
    displayMode: mode.value,
    availableDisplayModes: [...MCP_APP_DISPLAY_MODES],
    containerDimensions: layer
      ? { width: layer.width, height: layer.height }
      : { maxHeight: MAX_APP_HEIGHT, ...(width.value ? { width: width.value } : {}) },
    locale: navigator.language || 'de-DE',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: 'desktop',
    userAgent: `Nexa/${app.info?.version ?? ''}`,
    deviceCapabilities: { touch: false, hover: true },
    toolInfo: { tool: { name: props.tool.app?.tool ?? props.tool.name } },
  }
}

function makeHost(): McpAppHost {
  return new McpAppHost({
    // A copy as JSON: the tool's input and result are the store's reactive proxies, which postMessage
    // can't clone; JSON-RPC is JSON anyway.
    post: (message) => frame.value?.contentWindow?.postMessage(JSON.parse(JSON.stringify(message)), '*'),
    callTool: (name, args) => api.mcpApps.callTool(props.sessionId, props.tool.id, name, args),
    readResource: (uri) => api.mcpApps.readResource(props.sessionId, props.tool.id, uri),
    openLink: (link) => void window.api.app.openExternal(link),
    message: (text) => composer.insert(props.sessionId, text),
    resize: (next) => (height.value = next),
    setDisplayMode,
    declaredModes: (modes) => (pageModes.value = modes),
    modelContext: async (params) => {
      await api.mcpApps.modelContext(props.sessionId, props.tool.id, params)
      const text = appContextText(params)
      pendingContext.value = text ? { text, lastPrompt: lastPromptId() } : null
    },
    context,
    version: app.info?.version ?? '',
  })
}

/** Puts the frame into `target`, keeping its page where the browser can (`moveBefore`). */
function moveFrame(target: HTMLElement | null): void {
  const el = frame.value
  if (!el || !target || el.parentElement === target) return
  const move = (target as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore
  if (typeof move === 'function') {
    try {
      return move.call(target, el, null)
    } catch {
      // Not movable this way (another document): it loads anew below.
    }
  }
  target.appendChild(el)
}

/** Shows the page in the chat, over the window or in its corner; the page hears of it (`host-context-changed`). */
function setDisplayMode(next: McpAppDisplayMode): void {
  if (next === mode.value || !allows(next)) return
  if (next === 'inline') {
    // Back first: the layer goes with the mode, and a frame still in it would go with it.
    moveFrame(frameSlot.value)
    layerSizer?.disconnect()
    layerSize.value = null
    mode.value = 'inline'
  } else {
    const wasInline = mode.value === 'inline'
    mode.value = next
    if (wasInline) void nextTick(() => moveFrame(layerSlot.value))
  }
  void nextTick(() => host?.contextChanged())
}

watch(layerSlot, (slot) => {
  layerSizer?.disconnect()
  if (!slot) return
  layerSizer = new ResizeObserver(([entry]) => {
    const next = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }
    if (next.width === layerSize.value?.width && next.height === layerSize.value?.height) return
    layerSize.value = next
    host?.contextChanged()
  })
  layerSizer.observe(slot)
})

// Esc leaves the page over the window, as a video's full screen; inside the frame the page keeps its keys.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (mode.value !== 'fullscreen' || event.key !== 'Escape' || event.defaultPrevented) return
  event.preventDefault()
  setDisplayMode('inline')
})

/** The floating page goes where its bar is dragged, kept in the window. */
function dragPip(event: PointerEvent): void {
  if (mode.value !== 'pip' || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  const bar = event.currentTarget as HTMLElement
  const box = bar.parentElement!.getBoundingClientRect()
  const start = { x: event.clientX, y: event.clientY, ...pipOffset.value }
  bar.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    const right = start.right - (e.clientX - start.x)
    const bottom = start.bottom - (e.clientY - start.y)
    pipOffset.value = {
      right: Math.min(Math.max(0, right), window.innerWidth - box.width),
      bottom: Math.min(Math.max(0, bottom), window.innerHeight - box.height),
    }
  }
  const end = () => {
    bar.removeEventListener('pointermove', move)
    bar.removeEventListener('pointerup', end)
    bar.removeEventListener('pointercancel', end)
  }
  bar.addEventListener('pointermove', move)
  bar.addEventListener('pointerup', end)
  bar.addEventListener('pointercancel', end)
}

/** Takes the page's context back: it doesn't go with the next prompt. */
async function dropContext(): Promise<void> {
  try {
    await api.mcpApps.modelContext(props.sessionId, props.tool.id, {})
    pendingContext.value = null
  } catch (cause) {
    toastError(cause, 'Kontext nicht verworfen')
  }
}

/** The tool's state as the page learns it: arguments, then the result or why there is none. */
function sync(): void {
  if (!host) return
  host.setInput(props.tool.input)
  const tool = props.tool
  const result = tool.appResult ?? remoteResult.value
  if (result) host.setResult(result)
  else if (tool.status === 'error') host.setResult({ content: [{ type: 'text', text: tool.output ?? '' }], isError: true })
  else if (tool.status === 'denied') host.cancel('Abgelehnt')
}

function onMessage(event: MessageEvent): void {
  // Only the frame's own window; its origin is opaque ("null"), so the window is what tells.
  if (!host || !frame.value || event.source !== frame.value.contentWindow) return
  host.receive(event.data)
}

async function open(): Promise<void> {
  if (url.value || error.value) return
  try {
    let opened: McpAppOpened
    if (device) {
      const remote = await window.api.mcpApps.openRemote(device, props.sessionId, props.tool.id)
      remoteResult.value = remote.result
      opened = remote
    } else opened = await window.api.mcpApps.open(props.sessionId, props.tool.id)
    bordered.value = opened.prefersBorder !== false
    host = makeHost()
    url.value = opened.url
    sync()
  } catch (e) {
    error.value = errorMessage(e)
  }
}

watch(() => [props.tool.input, props.tool.appResult, props.tool.status], sync)
// In another device's chat the result isn't in the item: once the tool is done, it comes with the page again.
watch(
  () => props.tool.status,
  (status) => {
    if (!device || !url.value || status === 'running' || remoteResult.value) return
    void window.api.mcpApps
      .openRemote(device, props.sessionId, props.tool.id)
      .then((opened) => {
        remoteResult.value = opened.result
        sync()
      })
      .catch(() => undefined)
  },
)
watch([theme, () => settings.settings.appearance.uiFont, () => settings.settings.appearance.codeFont], () => host?.contextChanged())

onMounted(() => {
  window.addEventListener('message', onMessage)
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    observer?.disconnect()
    observer = null
    void open()
  })
  if (root.value) observer.observe(root.value)
  sizer = new ResizeObserver(([entry]) => {
    const next = Math.round(entry.contentRect.width)
    if (next && next !== width.value) {
      width.value = next
      host?.contextChanged()
    }
  })
  if (root.value) sizer.observe(root.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  observer?.disconnect()
  sizer?.disconnect()
  layerSizer?.disconnect()
  host?.teardown()
  host = null
})

const MODE_TEXT: Record<Exclude<McpAppDisplayMode, 'inline'>, string> = { fullscreen: 'Im Vollbild', pip: 'Als Bild im Bild' }
const appName = computed(() => props.tool.app?.tool ?? props.tool.name)
</script>

<template>
  <div ref="root" class="py-0.5">
    <ToolRow :tool="tool" />
    <div v-if="error" class="mt-1 mb-2 ml-7 flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-[0.8rem] text-muted-foreground">
      <CircleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <span class="min-w-0">Die Oberfläche von „{{ tool.app?.tool }}“ lässt sich nicht zeigen: {{ error }}</span>
    </div>
    <div v-else :class="cn('group/app relative mt-1 mb-2 overflow-hidden', bordered && 'rounded-xl border bg-card/60')">
      <!-- The frame alone in its slot: it moves out of it and back (setDisplayMode), nothing else may be placed beside it. -->
      <div ref="frameSlot">
        <!-- The height on the frame itself: the page's size is its content's, without the border around it. -->
        <iframe
          v-if="url"
          ref="frame"
          :src="url"
          :title="`Oberfläche von ${appName}`"
          sandbox="allow-scripts allow-forms"
          referrerpolicy="no-referrer"
          class="block w-full border-0 bg-transparent"
          :style="mode === 'inline' ? { height: `${height}px` } : { position: 'absolute', inset: '0', width: '100%', height: '100%' }"
        />
      </div>
      <div v-if="!url" class="flex items-center justify-center gap-2 text-[0.8rem] text-muted-foreground" :style="{ height: `${height}px` }">
        <Spinner class="size-3.5" />
        Oberfläche wird geladen …
      </div>
      <div v-else-if="mode !== 'inline'" class="flex items-center gap-2 px-3 py-2 text-[0.8rem] text-muted-foreground">
        {{ MODE_TEXT[mode] }} geöffnet
        <Button variant="ghost" size="xs" class="ml-auto" @click="setDisplayMode('inline')">
          <Minimize2Icon data-icon="inline-start" />
          Zurückholen
        </Button>
      </div>
      <!-- The user's own way to the other modes, where the page allows them. -->
      <div
        v-if="mode === 'inline' && (allows('fullscreen') || allows('pip'))"
        class="absolute top-1.5 right-1.5 flex gap-0.5 rounded-md bg-popover/90 p-0.5 opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover/app:opacity-100 focus-within:opacity-100"
      >
        <Button v-if="allows('pip')" variant="ghost" size="icon-xs" aria-label="Bild im Bild" v-tooltip="'Bild im Bild'" @click="setDisplayMode('pip')">
          <PictureInPicture2Icon />
        </Button>
        <Button v-if="allows('fullscreen')" variant="ghost" size="icon-xs" aria-label="Vollbild" v-tooltip="'Vollbild'" @click="setDisplayMode('fullscreen')">
          <Maximize2Icon />
        </Button>
      </div>
    </div>
    <div v-if="contextNote" class="-mt-1 mb-2 ml-1 flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground">
      <SparklesIcon class="size-3 shrink-0" />
      <span class="min-w-0 truncate" :title="contextNote">Geht mit deiner nächsten Nachricht an den Agent: {{ contextNote }}</span>
      <Button variant="ghost" size="xs" class="shrink-0" @click="dropContext">Verwerfen</Button>
    </div>

    <!-- Over the window (below the title bar, under dialogs) or floating in its corner. -->
    <Teleport to="body">
      <div
        v-if="mode !== 'inline'"
        :class="
          cn(
            'fixed z-40 flex flex-col overflow-hidden bg-background',
            mode === 'fullscreen' ? 'inset-x-0 top-(--titlebar-height) bottom-0' : 'h-[min(18rem,50vh)] w-[min(26rem,calc(100vw-2rem))] rounded-xl border shadow-xl',
          )
        "
        :style="mode === 'pip' ? { right: `${pipOffset.right}px`, bottom: `${pipOffset.bottom}px` } : undefined"
        role="region"
        :aria-label="`Oberfläche von ${appName}`"
      >
        <div
          :class="cn('flex h-8 shrink-0 items-center gap-1 border-b bg-card/60 pr-1 pl-3 text-[0.8rem]', mode === 'pip' && 'cursor-grab active:cursor-grabbing')"
          @pointerdown="dragPip"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{{ appName }}</span>
          <span v-if="mode === 'fullscreen'" class="mr-1 shrink-0 text-xs text-muted-foreground">Esc zum Verlassen</span>
          <Button v-if="mode === 'fullscreen' && allows('pip')" variant="ghost" size="icon-xs" aria-label="Bild im Bild" v-tooltip="'Bild im Bild'" @click="setDisplayMode('pip')">
            <PictureInPicture2Icon />
          </Button>
          <Button v-if="mode === 'pip' && allows('fullscreen')" variant="ghost" size="icon-xs" aria-label="Vollbild" v-tooltip="'Vollbild'" @click="setDisplayMode('fullscreen')">
            <Maximize2Icon />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Zurück in den Chat" v-tooltip="'Zurück in den Chat'" @click="setDisplayMode('inline')">
            <Minimize2Icon />
          </Button>
        </div>
        <div ref="layerSlot" class="relative min-h-0 flex-1" />
      </div>
    </Teleport>
  </div>
</template>
