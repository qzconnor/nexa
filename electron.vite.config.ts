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
    build: { minify: true },
  },
})
