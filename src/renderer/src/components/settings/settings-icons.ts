import {
  AppWindowIcon,
  BellIcon,
  BotIcon,
  ChartColumnIcon,
  CircleArrowDownIcon,
  InfoIcon,
  MessageSquareIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { SettingsSection } from '@/stores/ui'

/** The icon of each section of the settings, in the dialog's list and for its settings in the quick open. */
export const SETTINGS_ICONS: Record<SettingsSection, Component> = {
  general: AppWindowIcon,
  appearance: PaletteIcon,
  accounts: UsersIcon,
  usage: ChartColumnIcon,
  providers: BotIcon,
  cliConfig: SlidersHorizontalIcon,
  chat: MessageSquareIcon,
  notifications: BellIcon,
  devices: MonitorSmartphoneIcon,
  api: PlugIcon,
  updates: CircleArrowDownIcon,
  about: InfoIcon,
}
