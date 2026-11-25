import type { Rectangle } from 'electron'

/** Where a window was: its normal bounds and whether it was maximized. */
export interface SavedBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** A chat's first window, until the user gives it another size. */
const CHAT_WINDOW_SIZE = { width: 920, height: 820 }
/** How far a chat's first window sits from the main window's corner, so both stay in sight. */
const CHAT_WINDOW_OFFSET = 48

export function isSavedBounds(value: unknown): value is SavedBounds {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(b[key])) && typeof b.maximized === 'boolean'
}

/** Whether a window saved there would still show on one of the displays now connected. */
export function onScreen(saved: Rectangle, areas: readonly Rectangle[]): boolean {
  return areas.some((a) => saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 60)
}

/**
 * Where a chat's first window goes: down and right of the main window's corner (`near`), on its
 * display, as large as fits there; without a main window in the middle of the display.
 */
export function chatWindowPlace(near: Rectangle | null, area: Rectangle): Rectangle {
  const width = Math.min(CHAT_WINDOW_SIZE.width, area.width)
  const height = Math.min(CHAT_WINDOW_SIZE.height, area.height)
  const fromX = near ? near.x + CHAT_WINDOW_OFFSET : area.x + Math.round((area.width - width) / 2)
  const fromY = near ? near.y + CHAT_WINDOW_OFFSET : area.y + Math.round((area.height - height) / 2)
  const x = Math.max(area.x, Math.min(fromX, area.x + area.width - width))
  const y = Math.max(area.y, Math.min(fromY, area.y + area.height - height))
  return { x, y, width, height }
}
