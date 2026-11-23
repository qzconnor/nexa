import { BellIcon, BotIcon, ChartColumnIcon, CircleArrowDownIcon, InfoIcon, MessageSquareIcon, PaletteIcon, PlugIcon, UsersIcon } from '@lucide/vue'
import type { Component } from 'vue'
import type { SettingsSection } from '@/stores/ui'

/** The icon of each section of the settings, in the dialog's list and for its settings in the quick open. */
export const SETTINGS_ICONS: Record<SettingsSection, Component> = {
  appearance: PaletteIcon,
  accounts: UsersIcon,
  usage: ChartColumnIcon,
  providers: BotIcon,
  chat: MessageSquareIcon,
  notifications: BellIcon,
  api: PlugIcon,
  updates: CircleArrowDownIcon,
  about: InfoIcon,
}
