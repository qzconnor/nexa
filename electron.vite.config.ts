import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'electron-vite'

const shared = resolve('src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // The tray menu's window gets a preload of its own. Sandboxed preloads can't load a chunk they
      // share, so each is one file.
      isolatedEntries: true,
      rollupOptions: { input: { index: resolve('src/preload/index.ts'), tray: resolve('src/preload/tray.ts') } },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': shared,
      },
    },
    plugins: [vue(), tailwindcss()],
    // electron-vite leaves it off: the start chunk had 3.5 MB to load and parse. Main stays readable
    // for its stack traces.
    build: {
      minify: true,
      // The app's page and the tray menu's (Windows), which only loads what the menu needs.
      rollupOptions: { input: { index: resolve('src/renderer/index.html'), tray: resolve('src/renderer/tray.html') } },
    },
  },
})
