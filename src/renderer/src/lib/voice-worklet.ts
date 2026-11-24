/**
 * The recording for the voice input, in the audio thread (an AudioWorklet in a context at 16 kHz):
 * the microphone's samples become 16-bit PCM in pieces of 64 ms, each with its loudness (RMS) for
 * the level in the composer. `'flush'` sends what is left and answers `{ flushed: true }`.
 */

// The worklet's own scope, which TypeScript's DOM types don't describe.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

/** 64 ms at 16 kHz: small enough for words to show up at once, few enough messages for the IPC. */
const CHUNK = 1024

class VoiceCapture extends AudioWorkletProcessor {
  private buffer = new Int16Array(CHUNK)
  private filled = 0
  private squares = 0

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data !== 'flush') return
      this.post()
      this.port.postMessage({ flushed: true })
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const samples = inputs[0]?.[0]
    if (!samples) return true
    for (let i = 0; i < samples.length; i++) {
      const value = Math.max(-1, Math.min(1, samples[i]!))
      this.buffer[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff
      this.squares += value * value
      if (this.filled === CHUNK) this.post()
    }
    return true
  }

  private post(): void {
    if (!this.filled) return
    const pcm = this.buffer.slice(0, this.filled)
    const rms = Math.sqrt(this.squares / this.filled)
    this.filled = 0
    this.squares = 0
    this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer])
  }
}

registerProcessor('nexa-voice-capture', VoiceCapture)

export {}
