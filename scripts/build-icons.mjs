// Renders build/icon.svg to build/icon.png (512 px, Linux and the window) and build/icon.ico (all
// sizes Windows asks for: taskbar, tray, Explorer, shortcuts). Chromium rasterizes the SVG at every
// size anew, so small sizes stay sharp instead of being scaled down from the large one.
// Run with `npm run build:icons` after changing the SVG; the results are checked in.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'))
const PNG_SIZE = 512
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** An .ico with one PNG per size (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await win.loadURL('data:text/html,<!doctype html><title>icons</title>')
    const source = `data:image/svg+xml;base64,${svg.toString('base64')}`
    const render = async (size) => {
      const dataUrl = await win.webContents.executeJavaScript(`(async () => {
        const img = new Image()
        img.src = ${JSON.stringify(source)}
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = ${size}
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, ${size}, ${size})
        return canvas.toDataURL('image/png')
      })()`)
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    }
    writeFileSync(join(root, 'build', 'icon.png'), await render(PNG_SIZE))
    const images = []
    for (const size of ICO_SIZES) images.push({ size, png: await render(size) })
    writeFileSync(join(root, 'build', 'icon.ico'), ico(images))
    console.log(`build-icons: build/icon.png (${PNG_SIZE} px), build/icon.ico (${ICO_SIZES.join(', ')} px)`)
  } catch (error) {
    console.error('build-icons:', error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
