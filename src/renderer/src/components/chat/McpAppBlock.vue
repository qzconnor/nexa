<script setup lang="ts">
import { CircleAlertIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ToolItem } from '@shared/chat'
import type { McpAppOpened, McpAppToolResult } from '@shared/mcp-apps'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '@/lib/errors'
import { CODE_FONT_FALLBACKS, fontStack, UI_FONT_FALLBACKS } from '@/lib/fonts'
import { appStyleVariables, MAX_APP_HEIGHT, McpAppHost, type McpAppHostContext } from '@/lib/mcp-app-host'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useComposerStore } from '@/stores/composer'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import ToolRow from './ToolRow.vue'

/**
 * An MCP tool with a page of its own (MCP Apps): its row, and below it the page in a sandboxed frame,
 * served by main/mcp-apps (each page its own address and CSP). The page talks to Nexa only through
 * `postMessage`; McpAppHost answers it. It is read the first time it comes into view. In a chat of
 * another device main fetches the page from there and serves it here; the tool's result comes with it,
 * and what the page asks of its server goes there.
 */
const props = defineProps<{ tool: ToolItem; sessionId: string }>()
const settings = useSettingsStore()
const themes = useThemesStore()
const app = useAppStore()
const composer = useComposerStore()
const device = useDevice()
const api = useDeviceApi()
/** The result as the page of another device's chat got it (its chat here leaves results out). */
const remoteResult = ref<McpAppToolResult | null>(null)

const root = ref<HTMLElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
const url = ref<string | null>(null)
const error = ref<string | null>(null)
const height = ref(160)
const width = ref<number | undefined>(undefined)
const bordered = ref(true)
let host: McpAppHost | null = null
let observer: IntersectionObserver | null = null
let sizer: ResizeObserver | null = null

const theme = computed(() => themes.find(settings.settings.appearance.theme))

function context(): McpAppHostContext {
  const appearance = settings.settings.appearance
  return {
    theme: theme.value.mode,
    styles: {
      variables: appStyleVariables(theme.value.colors, {
        sans: fontStack(appearance.uiFont, UI_FONT_FALLBACKS),
        mono: fontStack(appearance.codeFont, CODE_FONT_FALLBACKS),
      }),
    },
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: { maxHeight: MAX_APP_HEIGHT, ...(width.value ? { width: width.value } : {}) },
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
    context,
    version: app.info?.version ?? '',
  })
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
  host?.teardown()
  host = null
})
</script>

<template>
  <div ref="root" class="py-0.5">
    <ToolRow :tool="tool" />
    <div v-if="error" class="mt-1 mb-2 ml-7 flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-[0.8rem] text-muted-foreground">
      <CircleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <span class="min-w-0">Die Oberfläche von „{{ tool.app?.tool }}“ lässt sich nicht zeigen: {{ error }}</span>
    </div>
    <div v-else :class="cn('mt-1 mb-2 overflow-hidden', bordered && 'rounded-xl border bg-card/60')">
      <!-- The height on the frame itself: the page's size is its content's, without the border around it. -->
      <iframe
        v-if="url"
        ref="frame"
        :src="url"
        :title="`Oberfläche von ${tool.app?.tool ?? tool.name}`"
        sandbox="allow-scripts allow-forms"
        referrerpolicy="no-referrer"
        class="block w-full border-0 bg-transparent"
        :style="{ height: `${height}px` }"
      />
      <div v-else class="flex items-center justify-center gap-2 text-[0.8rem] text-muted-foreground" :style="{ height: `${height}px` }">
        <Spinner class="size-3.5" />
        Oberfläche wird geladen …
      </div>
    </div>
  </div>
</template>
