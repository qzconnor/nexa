import { createApp } from 'vue'
import TrayMenu from './TrayMenu.vue'
import '../assets/main.css'

// The menu shows only once it is drawn: a fading background would still be under way then.
document.body.style.transition = 'none'

createApp(TrayMenu).mount('#app')
