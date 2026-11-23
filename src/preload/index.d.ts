import type { NexaApi } from '@shared/ipc'

declare global {
  interface Window {
    api: NexaApi
  }
}

export {}
