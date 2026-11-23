<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { RenderSpec } from '@shared/chat'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'

type DiagramSpec = Extract<RenderSpec, { type: 'diagram' }>

/** A Mermaid diagram in the theme's colours; Mermaid is loaded the first time one is shown. */
const props = defineProps<{ spec: DiagramSpec }>()
const settings = useSettingsStore()
const themes = useThemesStore()
const svg = ref('')
const error = ref<string | null>(null)
let counter = 0

async function draw(): Promise<void> {
  const theme = themes.find(settings.settings.appearance.theme)
  const c = theme.colors
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Geist Variable, Segoe UI, sans-serif',
      themeVariables: {
        darkMode: theme.mode === 'dark',
        background: 'transparent',
        primaryColor: c.surface,
        primaryTextColor: c.foreground,
        primaryBorderColor: c.primary,
        secondaryColor: c.popover,
        tertiaryColor: c.background,
        lineColor: c.mutedForeground,
        textColor: c.foreground,
        mainBkg: c.surface,
        nodeBorder: c.primary,
        clusterBkg: c.popover,
        clusterBorder: c.mutedForeground,
        edgeLabelBackground: c.background,
        noteBkgColor: c.popover,
        noteTextColor: c.foreground,
        actorBkg: c.surface,
        actorBorder: c.primary,
        actorTextColor: c.foreground,
        signalColor: c.foreground,
        signalTextColor: c.foreground,
      },
    })
    const id = `nexa-diagram-${Date.now().toString(36)}-${counter++}`
    const result = await mermaid.render(id, props.spec.mermaid)
    svg.value = result.svg
    error.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    // Mermaid leaves its error drawing in the body.
    document.querySelectorAll('[id^="dnexa-diagram-"]').forEach((el) => el.remove())
  }
}

onMounted(draw)
watch(() => [props.spec.mermaid, settings.settings.appearance.theme], draw)
</script>

<template>
  <div class="mermaid-host flex justify-center overflow-x-auto py-2">
    <div v-if="svg && !error" class="w-full" v-html="svg" />
    <div v-else-if="error" class="flex w-full flex-col gap-2">
      <p class="text-[0.8rem] text-destructive">Das Diagramm ließ sich nicht zeichnen: {{ error }}</p>
      <pre class="selectable overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.78rem] text-(--code-fg)">{{ spec.mermaid }}</pre>
    </div>
    <div v-else class="h-24 w-full animate-pulse rounded-md bg-muted/40" />
  </div>
</template>
