<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import { computed } from 'vue'
import { Toaster as Sonner } from 'vue-sonner'
import { buttonVariants } from '@/components/ui/button'

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions')

/*
 * Beside the text, as on the banners; under it once there is a description, so the text keeps its width.
 * Spelled out: Tailwind only finds whole class names in the source.
 */
const buttonPlace =
  'col-start-3 row-start-1 ml-3 group-has-[[data-description]]/toast:col-start-2 group-has-[[data-description]]/toast:row-start-2 group-has-[[data-description]]/toast:mt-2 group-has-[[data-description]]/toast:ml-0 group-has-[[data-description]]/toast:justify-self-start'

/*
 * Unstyled: Sonner keeps positioning, stacking and swiping, the look comes from here. Like the cards
 * and banners that float over the chat above the composer (AgentDock, LimitBanner): their surface and
 * border, small text, a small coloured icon, xs buttons; errors and warnings tinted as the banners are.
 * One grid: icon, text, action, close. The 24px row of the buttons centres a one-line text.
 */
const toastOptions = computed<ToasterProps['toastOptions']>(() => ({
  unstyled: true,
  closeButtonAriaLabel: 'Schließen',
  ...props.toastOptions,
  classes: {
    toast: cn(
      'group/toast toast-surface grid w-(--width) grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start rounded-xl border py-2 pr-2 pl-3 font-sans text-[0.8rem] text-card-foreground shadow-lg shadow-black/15 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
      // Collapsed stack: the toasts behind show only their edge.
      'data-[expanded=false]:data-[front=false]:*:opacity-0',
    ),
    icon: 'col-start-1 row-start-1 mr-2.5 flex h-6 items-center [&_svg]:size-3.5',
    content: 'col-start-2 row-start-1 flex min-w-0 flex-col gap-0.5 py-0.5',
    title: 'leading-5 font-medium',
    description: 'text-[0.78rem] leading-snug text-muted-foreground wrap-anywhere',
    actionButton: cn(buttonVariants({ variant: 'outline', size: 'xs' }), buttonPlace),
    // No toast in Nexa has both; they would share the place.
    cancelButton: cn(buttonVariants({ variant: 'ghost', size: 'xs' }), buttonPlace),
    closeButton: cn(
      buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
      // bg-transparent and border-transparent: Sonner's dark theme paints its own close button, also on unstyled toasts.
      'col-start-4 row-start-1 ml-1 border-transparent bg-transparent text-muted-foreground hover:text-foreground',
    ),
    success: '[&_[data-icon]]:text-success',
    error: 'border-destructive/30 [--toast-tint:color-mix(in_oklab,var(--destructive)_10%,transparent)] [&_[data-icon]]:text-destructive',
    warning: 'border-warning/30 [--toast-tint:color-mix(in_oklab,var(--warning)_10%,transparent)] [&_[data-icon]]:text-warning',
    info: '[&_[data-icon]]:text-primary',
    loading: '[&_[data-icon]]:text-muted-foreground',
    ...props.toastOptions?.classes,
  },
}))
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    v-bind="delegatedProps"
    :toast-options="toastOptions"
    :container-aria-label="props.containerAriaLabel ?? 'Benachrichtigungen'"
  >
    <template #success-icon>
      <CircleCheckIcon />
    </template>
    <template #info-icon>
      <InfoIcon />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon />
    </template>
    <template #error-icon>
      <OctagonXIcon />
    </template>
    <template #loading-icon>
      <Loader2Icon class="animate-spin" />
    </template>
    <template #close-icon>
      <XIcon />
    </template>
  </Sonner>
</template>
