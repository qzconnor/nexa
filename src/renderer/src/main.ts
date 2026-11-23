import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { vTooltip } from './lib/tooltip'
import './assets/main.css'

declare module 'vue' {
  interface GlobalDirectives {
    /** The app's tooltip instead of `title` (see lib/tooltip.ts). */
    vTooltip: typeof vTooltip
  }
}

document.documentElement.dataset.platform = window.api.platform

createApp(App).use(createPinia()).directive('tooltip', vTooltip).mount('#app')
