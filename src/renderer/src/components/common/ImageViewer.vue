<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, ImageOffIcon, XIcon, ZoomInIcon, ZoomOutIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { DialogClose, DialogContent, DialogDescription, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import DialogOverlay from '@/components/ui/dialog/DialogOverlay.vue'
import { canPan, clampView, detailScale, fitScale, wheelFactor, zoomAt, type Point, type Size, type View } from '@/lib/image-zoom'
import { fileImageUrl, type ImageSource } from '@/lib/tools'
import { cn } from '@/lib/utils'

/**
 * Pictures large, over the window below its title bar: each opens fitted, the wheel zooms where the
 * pointer is, dragging moves a zoomed one, a double click goes between fitted and close up. With more
 * than one, the arrows (buttons and keys) go through them. A click beside the picture closes.
 */
/** `source`: the pictures of a chat on another device, fetched from there; they don't open in a program here. */
const props = defineProps<{ images: string[]; source?: ImageSource | null }>()
/** The picture shown; null while closed. */
const index = defineModel<number | null>('index', { required: true })

const path = computed(() => (index.value === null ? undefined : props.images[index.value]))
const open = computed({
  get: () => path.value !== undefined,
  set: (value) => {
    if (!value) index.value = null
  },
})

const stage = ref<HTMLElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const { width, height } = useElementSize(stage)
const stageSize = computed<Size>(() => ({ width: width.value, height: height.value }))

/** The picture's own pixels, once it loaded. */
const natural = ref<Size | null>(null)
const broken = ref(false)
const view = ref<View>({ scale: 1, x: 0, y: 0 })
/** The next change glides (buttons, keys, double click); the wheel and dragging follow at once. */
const gliding = ref(false)
const dragging = ref(false)
/** Fitted until zoomed: a resized window fits it anew instead of keeping a scale chosen for another size. */
let keepFitted = true

/** Fitted, the picture keeps clear of the edges, the close button above and the toolbar below. */
const fitArea = computed<Size>(() => ({ width: Math.max(0, width.value - 64), height: Math.max(0, height.value - 152) }))
const fit = computed(() => (natural.value ? fitScale(natural.value, fitArea.value) : 1))
const fitted = computed(() => Math.abs(view.value.scale - fit.value) < 0.001)
const pannable = computed(() => !!natural.value && canPan(view.value, natural.value, stageSize.value))
const percent = computed(() => `${Math.round(view.value.scale * 100)} %`)

const imageStyle = computed(() => {
  const size = natural.value
  if (!size) return { transform: 'translate(-50%, -50%)' }
  const { scale, x, y } = view.value
  return { width: `${size.width}px`, height: `${size.height}px`, transform: `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})` }
})

// Another picture starts fitted, once it loaded.
watch(path, () => {
  natural.value = null
  broken.value = false
  gliding.value = false
  keepFitted = true
  view.value = { scale: 1, x: 0, y: 0 }
})

watch(stageSize, () => {
  if (!natural.value) return
  gliding.value = false
  if (keepFitted) view.value = { scale: fit.value, x: 0, y: 0 }
  else view.value = clampView(view.value, natural.value, stageSize.value)
})

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  natural.value = { width: img.naturalWidth, height: img.naturalHeight }
  fitToStage(false)
}

function fitToStage(glide = true): void {
  gliding.value = glide
  keepFitted = true
  view.value = { scale: fit.value, x: 0, y: 0 }
}

/** Zooms to `scale` around `point` (from the stage's centre, the centre itself without one). */
function zoomTo(scale: number, point: Point = { x: 0, y: 0 }, glide = true): void {
  if (!natural.value) return
  gliding.value = glide
  view.value = zoomAt(view.value, scale, point, natural.value, stageSize.value)
  keepFitted = fitted.value
}

const STEP = 1.25
const zoomIn = () => zoomTo(view.value.scale * STEP)
const zoomOut = () => zoomTo(view.value.scale / STEP)
/** The percentage's button and a double click: close up from fitted, fitted from anywhere else. */
const toggleZoom = (point?: Point) => (fitted.value ? zoomTo(detailScale(fit.value), point) : fitToStage())

function pointOf(event: MouseEvent): Point {
  const rect = stage.value!.getBoundingClientRect()
  return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
}

function onWheel(event: WheelEvent): void {
  zoomTo(view.value.scale * wheelFactor(event), pointOf(event), false)
}

/** A press on the stage: a drag moves the picture, a click beside it closes. */
let press: { id: number; startX: number; startY: number; from: Point; onImage: boolean; moved: boolean } | null = null

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  press = { id: event.pointerId, startX: event.clientX, startY: event.clientY, from: { x: view.value.x, y: view.value.y }, onImage: event.target === image.value, moved: false }
}

function onPointerMove(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id || !natural.value) return
  // Released where the stage didn't hear it (over the toolbar).
  if (!(event.buttons & 1)) {
    press = null
    return
  }
  const dx = event.clientX - press.startX
  const dy = event.clientY - press.startY
  // A hand's tremor is still a click.
  if (!press.moved && Math.hypot(dx, dy) < 4) return
  if (!press.moved) {
    // Captured only now: captured from the press on, a double click would go to the stage, not the picture.
    stage.value?.setPointerCapture(event.pointerId)
    press.moved = true
  }
  dragging.value = true
  gliding.value = false
  view.value = clampView({ scale: view.value.scale, x: press.from.x + dx, y: press.from.y + dy }, natural.value, stageSize.value)
}

function onPointerUp(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id) return
  const closes = !press.moved && !press.onImage && event.type === 'pointerup'
  press = null
  dragging.value = false
  if (closes) open.value = false
}

function onDoubleClick(event: MouseEvent): void {
  if (event.target === image.value) toggleZoom(pointOf(event))
}

function step(by: number): void {
  if (index.value === null || props.images.length < 2) return
  index.value = (index.value + by + props.images.length) % props.images.length
}

function onKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const actions: Record<string, () => void> = {
    '+': zoomIn,
    '=': zoomIn,
    '-': zoomOut,
    '0': () => fitToStage(),
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
  }
  const action = actions[event.key]
  if (!action) return
  event.preventDefault()
  action()
}

/** The keys work at once, without a button showing focus it wasn't given by a key. */
function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  stage.value?.focus()
}

const openExternally = () => path.value && void window.api.app.openPath(path.value)
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <!-- The title bar stays sharp above it, as the window's frame. -->
      <DialogOverlay class="top-(--titlebar-height) bg-background/85 supports-backdrop-filter:backdrop-blur-md" />
      <DialogContent
        class="fixed inset-x-0 top-(--titlebar-height) bottom-0 z-50 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100"
        @open-auto-focus="onOpenAutoFocus"
        @keydown="onKeydown"
      >
        <DialogTitle class="sr-only">Bild</DialogTitle>
        <DialogDescription class="sr-only">Mausrad zoomt, Ziehen verschiebt, Doppelklick wechselt zwischen eingepasst und vergrößert, Pfeiltasten blättern.</DialogDescription>
        <div
          ref="stage"
          tabindex="-1"
          :class="cn('absolute inset-0 touch-none overflow-hidden outline-none select-none', dragging && 'cursor-grabbing')"
          @wheel.prevent="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dblclick="onDoubleClick"
        >
          <img
            v-if="path && !broken"
            ref="image"
            :key="path"
            :src="fileImageUrl(path, source)"
            alt=""
            draggable="false"
            :class="
              cn(
                'absolute top-1/2 left-1/2 max-w-none rounded-sm shadow-2xl shadow-black/30',
                !natural && 'invisible',
                gliding && 'transition-transform duration-150 ease-out',
                !dragging && (pannable ? 'cursor-grab' : 'cursor-zoom-in'),
                // Close up, a screenshot's pixels stay crisp instead of blurring into each other.
                view.scale >= 4 && '[image-rendering:pixelated]',
              )
            "
            :style="imageStyle"
            @load="onLoad"
            @error="broken = true"
          />
          <div v-else-if="broken" class="flex size-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <ImageOffIcon class="size-8 opacity-60" />
            Das Bild ist nicht mehr da.
          </div>
        </div>

        <DialogClose as-child>
          <Button variant="secondary" size="icon-sm" class="absolute top-3 right-3 rounded-full shadow-md" aria-label="Schließen" v-tooltip="'Schließen (Esc)'">
            <XIcon />
          </Button>
        </DialogClose>

        <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-popover/90 p-1 text-popover-foreground shadow-lg backdrop-blur-md">
          <template v-if="images.length > 1">
            <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Vorheriges Bild" v-tooltip="'Vorheriges Bild (←)'" @click="step(-1)">
              <ChevronLeftIcon />
            </Button>
            <span class="min-w-10 text-center text-[0.8rem] text-muted-foreground tabular-nums">{{ (index ?? 0) + 1 }} / {{ images.length }}</span>
            <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="Nächstes Bild" v-tooltip="'Nächstes Bild (→)'" @click="step(1)">
              <ChevronRightIcon />
            </Button>
            <div class="mx-1 h-4 w-px bg-border" />
          </template>
          <Button variant="ghost" size="icon-sm" class="rounded-full" :disabled="!natural" aria-label="Verkleinern" v-tooltip="'Verkleinern (−)'" @click="zoomOut">
            <ZoomOutIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="min-w-16 rounded-full tabular-nums"
            :disabled="!natural"
            :aria-label="fitted ? 'Vergrößern' : 'Einpassen'"
            v-tooltip="fitted ? 'Vergrößern (Doppelklick aufs Bild)' : 'Einpassen (0)'"
            @click="toggleZoom()"
          >
            {{ percent }}
          </Button>
          <Button variant="ghost" size="icon-sm" class="rounded-full" :disabled="!natural" aria-label="Vergrößern" v-tooltip="'Vergrößern (+)'" @click="zoomIn">
            <ZoomInIcon />
          </Button>
          <div v-if="!source" class="mx-1 h-4 w-px bg-border" />
          <Button v-if="!source" variant="ghost" size="icon-sm" class="rounded-full" aria-label="Mit dem Standardprogramm öffnen" v-tooltip="'Mit dem Standardprogramm öffnen'" @click="openExternally">
            <ExternalLinkIcon />
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
