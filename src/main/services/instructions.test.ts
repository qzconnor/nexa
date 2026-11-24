import { describe, expect, it } from 'vitest'
import type { ToolItem } from '@shared/chat'
import { handoffContext, userShellContext } from './instructions'

function command(detail: string, patch: Partial<ToolItem> = {}): ToolItem {
  return { kind: 'tool', id: detail, ts: 1, provider: 'claude', tool: 'bash', name: 'NexaShell', title: 'PowerShell 7', detail, status: 'done', exitCode: 0, byUser: true, startedAt: 1, ...patch }
}

describe('userShellContext', () => {
  it('gives each command with its output and how it ended', () => {
    const text = userShellContext([
      command('git status', { output: 'On branch main\n\n' }),
      command('npm test', { output: '1 failed', status: 'error', exitCode: 1 }),
      command('npm run dev', { output: 'ready', status: 'running', exitCode: undefined }),
      command('sleep 60', { status: 'denied', exitCode: undefined }),
    ])
    expect(text).toBe(
      [
        '<nexa-shell>',
        "The user ran these commands themselves in this chat's working directory (Nexa's shell mode) since their last message. You did not run them; Nexa replaced secrets in commands and output with ••••.",
        '',
        '$ git status\nOn branch main\n[exit code 0]',
        '',
        '$ npm test\n1 failed\n[exit code 1]',
        '',
        '$ npm run dev\nready\n[still running]',
        '',
        '$ sleep 60\n[stopped by the user]',
        '</nexa-shell>',
      ].join('\n'),
    )
  })

  it('keeps the end of long output, and the latest commands', () => {
    const one = userShellContext([command('build', { output: `start\n${'x'.repeat(20_000)}\nend` })])!
    expect(one).toContain('$ build\n…\n')
    expect(one).not.toContain('start')
    expect(one).toContain('end\n[exit code 0]')

    const many = userShellContext(Array.from({ length: 6 }, (_, i) => command(`cmd ${i}`, { output: 'y'.repeat(7_000) })))!
    expect(many.length).toBeLessThan(25_000)
    expect(many).not.toContain('$ cmd 0')
    expect(many).toContain('$ cmd 5')
  })

  it('is nothing without commands', () => {
    expect(userShellContext([])).toBeNull()
  })
})

describe('handoffContext', () => {
  it('names the user’s own commands as theirs', () => {
    expect(handoffContext([command('git pull', { exitCode: 1, status: 'error' })], 'codex')).toContain('[User ran in the shell: git pull → exit code 1]')
  })
})
