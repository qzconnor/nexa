import { describe, expect, it } from 'vitest'
import type { ChatItem, ToolItem } from '@shared/chat'
import { dockShells, plainOutput, runningShells, shellCommand, shellStatus } from './shells'

const tool = (over: Partial<ToolItem>): ToolItem => ({
  kind: 'tool',
  id: over.id ?? 't',
  ts: 0,
  provider: 'claude',
  tool: 'bash',
  name: 'Bash',
  title: 'Befehl ausführen',
  status: 'done',
  startedAt: 0,
  ...over,
})

describe('runningShells', () => {
  it('lists the commands running right now, in the background or not', () => {
    const items: ChatItem[] = [
      tool({ id: 'old', status: 'done' }),
      tool({ id: 'bg-done', shell: { taskId: 'a', background: true, status: 'done' } }),
      tool({ id: 'bg-running', status: 'done', shell: { taskId: 'c', background: true, status: 'running' } }),
      tool({ id: 'fg-running', status: 'running' }),
      tool({ id: 'codex', provider: 'codex', name: 'commandExecution', tool: 'read', status: 'running' }),
      tool({ id: 'read', tool: 'read', name: 'Read', status: 'running' }),
      tool({ id: 'fg-ended', shell: { taskId: 'b', background: false, status: 'done' } }),
    ]
    expect(runningShells(items).map((t) => t.id)).toEqual(['bg-running', 'fg-running', 'codex'])
  })
})

describe('dockShells', () => {
  const bg = (id: string, status: 'running' | 'done') => tool({ id, shell: { taskId: id, background: true, status } })
  const prompt: ChatItem = { kind: 'user', id: 'u', ts: 0, provider: 'claude', text: 'weiter' }

  it('keeps those of the last prompt and the ones still running from before', () => {
    const items: ChatItem[] = [bg('old-done', 'done'), bg('server', 'running'), prompt, bg('build', 'done'), tool({ id: 'fg', status: 'running' })]
    expect(dockShells(items).map((t) => t.id)).toEqual(['server', 'build'])
  })

  it('is empty once none runs', () => {
    expect(dockShells([prompt, bg('build', 'done')])).toEqual([])
  })
})

describe('shellStatus', () => {
  it('takes the process state over the call state', () => {
    expect(shellStatus(tool({ status: 'done', shell: { taskId: 'a', background: true, status: 'running' } }))).toBe('running')
    expect(shellStatus(tool({ status: 'denied' }))).toBe('stopped')
    expect(shellStatus(tool({ status: 'pending' }))).toBe('running')
  })
})

describe('shellCommand', () => {
  it('prefers the command line of the input', () => {
    expect(shellCommand(tool({ input: { command: 'npm run dev' }, detail: 'npm …' }))).toBe('npm run dev')
    expect(shellCommand(tool({ input: {}, detail: 'ls' }))).toBe('ls')
  })
})

describe('plainOutput', () => {
  it('drops colours, titles and carriage-return redraws', () => {
    expect(plainOutput('\x1b[32mok\x1b[0m\x1b]0;title\x07 done\r50%\r\n')).toBe('ok done\n50%\r\n')
  })
})
