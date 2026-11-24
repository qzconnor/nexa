import { onScopeDispose, readonly, ref, shallowRef } from 'vue'
import type { Unsubscribe } from '@shared/ipc'
import { VOICE_SAMPLE_RATE, type VoiceStartInput, type VoiceUpdate } from '@shared/voice'
import { errorMessage, toastError } from '@/lib/errors'
import { voiceLevel } from '@/lib/voice-text'
import workletUrl from '@/lib/voice-worklet.ts?worker&url'

/**
 * Speaking into the composer: the microphone at 16 kHz through an AudioWorklet, its pieces to the
 * main process (main/voice), the words back as they are heard. One take at a time in the whole
 * window: a second one ends the first.
 */

export type VoiceState = 'idle' | 'starting' | 'recording' | 'finishing'

/** Places in the level meter, newest last (one per 64 ms piece: about two seconds). */
export const VOICE_METER_SLOTS = 32

interface Take {
  cancel(): void
}

/** The take running somewhere in the window. */
let running: Take | null = null

export function useVoiceInput(handlers: { transcript: (text: string, final: boolean) => void }) {
  const state = ref<VoiceState>('idle')
  const levels = shallowRef<number[]>(silence())
  let id: string | null = null
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let node: AudioWorkletNode | null = null
  let off: Unsubscribe | null = null
  let flushed: (() => void) | null = null
  /** Counts the takes, so one given up while it started doesn't go on. */
  let generation = 0

  const take: Take = { cancel }

  async function start(input: VoiceStartInput): Promise<void> {
    if (state.value !== 'idle') return
    running?.cancel()
    running = take
    const mine = ++generation
    state.value = 'starting'
    levels.value = silence()
    off = window.api.voice.onUpdate((sessionId, update) => {
      if (sessionId === id) onUpdate(update)
    })
    // The connection and the microphone at once: both take a moment.
    const [session, media] = await Promise.allSettled([window.api.voice.start(input), openMicrophone()])
    const sessionId = session.status === 'fulfilled' ? session.value : null
    const mic = media.status === 'fulfilled' ? media.value : null
    if (mine !== generation || !sessionId || !mic) {
      // Given up meanwhile, or one of the two failed: the other one is let go again.
      if (sessionId) void window.api.voice.cancel(sessionId).catch(() => {})
      for (const track of mic?.getTracks() ?? []) track.stop()
      if (mine !== generation) return
      toastError(session.status === 'rejected' ? session.reason : media.status === 'rejected' ? media.reason : null, 'Spracheingabe')
      return cleanUp()
    }
    id = sessionId
    stream = mic
    try {
      await capture(mic)
    } catch (error) {
      if (mine !== generation) return
      toastError(`Die Aufnahme ließ sich nicht starten: ${errorMessage(error)}`, 'Spracheingabe')
      return abort()
    }
    if (mine === generation) state.value = 'recording'
  }

  async function capture(media: MediaStream): Promise<void> {
    context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
    await context.audioWorklet.addModule(workletUrl)
    node = new AudioWorkletNode(context, 'nexa-voice-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 })
    node.port.onmessage = (event: MessageEvent<{ pcm?: ArrayBuffer; rms?: number; flushed?: boolean }>) => {
      const data = event.data
      if (data.flushed) return flushed?.()
      if (!data.pcm || !id) return
      void window.api.voice.audio(id, new Uint8Array(data.pcm)).catch(() => {})
      levels.value = [...levels.value.slice(1), voiceLevel(data.rms ?? 0)]
    }
    context.createMediaStreamSource(media).connect(node)
    // The microphone went away (unplugged): what was said so far still counts.
    for (const track of media.getAudioTracks()) track.onended = () => void stop()
  }

  /** Ends the recording; resolves once the last words are in. */
  async function stop(): Promise<void> {
    if (state.value === 'starting') return cancel()
    if (state.value !== 'recording' || !id) return
    state.value = 'finishing'
    // The last piece still in the worklet goes out before the stream is closed.
    await new Promise<void>((resolve) => {
      flushed = resolve
      node?.port.postMessage('flush')
      setTimeout(resolve, 300)
    })
    flushed = null
    closeAudio()
    try {
      await window.api.voice.stop(id)
    } catch (error) {
      toastError(error, 'Spracheingabe')
    }
    cleanUp()
  }

  /** Ends the take at once; what was heard stays where it is. */
  function cancel(): void {
    if (state.value === 'idle') return
    generation++
    abort()
  }

  function onUpdate(update: VoiceUpdate): void {
    if (update.type === 'transcript') {
      handlers.transcript(update.text, update.final)
      return
    }
    toastError(update.message, 'Spracheingabe')
    // The main process ended the session already.
    id = null
    closeAudio()
    cleanUp()
  }

  function abort(): void {
    if (id) void window.api.voice.cancel(id).catch(() => {})
    closeAudio()
    cleanUp()
  }

  function closeAudio(): void {
    node?.port.close()
    node?.disconnect()
    node = null
    void context?.close().catch(() => {})
    context = null
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null
      track.stop()
    }
    stream = null
  }

  function cleanUp(): void {
    closeAudio()
    off?.()
    off = null
    id = null
    flushed = null
    if (running === take) running = null
    state.value = 'idle'
  }

  onScopeDispose(cancel)

  return { state: readonly(state), levels: readonly(levels), start, stop, cancel }
}

function silence(): number[] {
  return Array.from({ length: VOICE_METER_SLOTS }, () => 0)
}

async function openMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error(
        window.api.platform === 'win32'
          ? 'Nexa darf das Mikrofon nicht benutzen. Erlaube es in den Windows-Einstellungen unter „Datenschutz und Sicherheit › Mikrofon“ für Desktop-Apps.'
          : 'Nexa darf das Mikrofon nicht benutzen. Erlaube es in den Datenschutz-Einstellungen des Systems.',
      )
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('Kein Mikrofon gefunden.')
    if (name === 'NotReadableError') throw new Error('Das Mikrofon lässt sich nicht öffnen; vielleicht benutzt es gerade ein anderes Programm.')
    throw error
  }
}
