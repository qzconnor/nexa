<script setup lang="ts">
import { CircleStopIcon, PencilIcon, PlayIcon, SquareTerminalIcon, XIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { ShellStatus } from '@shared/chat'
import { startCommandLabel } from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { startShellId } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'

/**
 * The project's start commands in the chat's header (once it has some), with a dot while one runs. A
 * command starts with a click and unfolds in the dock above the composer; there it can be restarted
 * or ended.
 */
const props = defineProps<{ projectId: string }>()
const startCommands = useStartCommandsStore()
const ui = useUiStore()

const STATE: Partial<Record<ShellStatus, string>> = { running: 'läuft', error: 'fehlgeschlagen' }

const commands = computed(() => startCommands.commandsOf(props.projectId))
const running = computed(() => startCommands.runningIn(props.projectId))
const idle = computed(() => commands.value.filter((c) => !startCommands.isRunning(props.projectId, c.id)))
const label = computed(() => {
  const text = startCommands.runningText(props.projectId)
  return text ? `Startbefehle: ${text}` : 'Startbefehle'
})
const status = (c: StartCommand) => startCommands.runOf(props.projectId, c.id)?.status ?? null

/** Shows it beside the chat, started if it doesn't run. */
function open(c: StartCommand): void {
  ui.shellId = startShellId(c.id)
  if (status(c) !== 'running') void startCommands.start(props.projectId, c.id)
}

async function startAll(): Promise<void> {
  const first = await startCommands.startAll(props.projectId)
  if (first) ui.shellId = startShellId(first.id)
}
</script>

<template>
  <DropdownMenu v-if="commands.length">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" :aria-label="label" v-tooltip.bottom="label" class="relative">
        <SquareTerminalIcon :class="cn(running.length && 'text-(--tool-run)')" />
        <span v-if="running.length" aria-hidden="true" class="absolute top-1 right-1 size-1.5 rounded-full bg-(--tool-run) ring-2 ring-background" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72">
      <DropdownMenuLabel>Startbefehle</DropdownMenuLabel>
      <DropdownMenuItem v-for="c in commands" :key="c.id" @select="open(c)">
        <Spinner v-if="status(c) === 'running'" class="text-(--tool-run)" />
        <XIcon v-else-if="status(c) === 'error'" class="text-destructive" />
        <PlayIcon v-else />
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate">{{ startCommandLabel(c) }}</span>
          <span v-if="c.name" class="truncate font-mono text-[0.72rem] text-muted-foreground">{{ c.command }}</span>
        </span>
        <span
          v-if="status(c) && STATE[status(c)!]"
          :class="cn('shrink-0 text-xs text-muted-foreground', status(c) === 'error' && 'text-destructive')"
        >
          {{ STATE[status(c)!] }}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem v-if="commands.length > 1 && idle.length" @select="startAll">
        <PlayIcon /> {{ idle.length === commands.length ? 'Alle starten' : 'Übrige starten' }}
      </DropdownMenuItem>
      <DropdownMenuItem v-if="running.length" @select="startCommands.stopAll(projectId)">
        <CircleStopIcon /> {{ running.length > 1 ? 'Alle beenden' : `„${startCommandLabel(running[0])}“ beenden` }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="ui.startCommandsProject = projectId"><PencilIcon /> Startbefehle bearbeiten …</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
