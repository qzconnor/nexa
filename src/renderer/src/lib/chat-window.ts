import { chatWindowSession } from '@shared/chat-windows'

/**
 * The chat this window is for, when it is a chat's own window (opened with `?chat=<id>`, see
 * shared/chat-windows.ts); null in the main window. It never changes while the window lives.
 */
// Optional: tests stand in a `window` of their own without a location.
export const ownChat: string | null = chatWindowSession(window.location?.search ?? '')

/** This window shows one chat only: no sidebar, no start page, no quick open. */
export const isChatWindow = ownChat !== null
