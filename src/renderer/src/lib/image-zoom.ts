/**
 * The arithmetic of the image viewer: where a picture sits on its stage while it is zoomed and moved.
 * Offsets are measured from the stage's centre; a scale of 1 is one pixel of the picture per CSS pixel.
 */

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface View extends Point {
  scale: number
}

/** Beyond this the pixels are as large as they get useful (16 screen pixels each). */
export const MAX_SCALE = 16

/** The scale at which the whole picture fits; small ones keep their own size instead of being blown up. */
export function fitScale(image: Size, stage: Size): number {
  if (image.width <= 0 || image.height <= 0 || stage.width <= 0 || stage.height <= 0) return 1
  return Math.min(1, stage.width / image.width, stage.height / image.height)
}

/** Half the fitted scale: smaller than the stage, but never a dot. */
export function minScale(image: Size, stage: Size): number {
  return fitScale(image, stage) / 2
}

/**
 * Keeps the picture in view: on an axis where it is smaller than the stage it stays centred, on one
 * where it is larger its edges don't come inside the stage, so there is never empty space to drag into.
 */
export function clampView(view: View, image: Size, stage: Size): View {
  const spareX = Math.max(0, (image.width * view.scale - stage.width) / 2)
  const spareY = Math.max(0, (image.height * view.scale - stage.height) / 2)
  return { scale: view.scale, x: clamp(view.x, -spareX, spareX), y: clamp(view.y, -spareY, spareY) }
}

/** Zooms to `scale` around `point`: what is under the point stays under it, as with any map. */
export function zoomAt(view: View, scale: number, point: Point, image: Size, stage: Size): View {
  const next = clamp(scale, minScale(image, stage), MAX_SCALE)
  const ratio = next / view.scale
  return clampView({ scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, image, stage)
}

/**
 * Where a double click goes from the fitted view: a picture shrunk a lot to its actual size, one that
 * (nearly) fits as it is to twice the fitted size, so the click always shows more detail.
 */
export function detailScale(fit: number): number {
  return Math.min(MAX_SCALE, fit < 0.5 ? 1 : fit * 2)
}

/** Whether the picture is larger than the stage on some axis, so dragging moves it. */
export function canPan(view: View, image: Size, stage: Size): boolean {
  return image.width * view.scale > stage.width + 0.5 || image.height * view.scale > stage.height + 0.5
}

/** A wheel's turn as a factor of the scale; lines and pages count as the pixels they roughly scroll. */
export function wheelFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1)
  // Exponential, so a trackpad's many small steps and a wheel's few large ones zoom alike.
  return Math.exp(-pixels * 0.002)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
