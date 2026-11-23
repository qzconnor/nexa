/** Green below 60 %, orange from 60 %, red from 85 %. */
export type UsageLevel = 'low' | 'medium' | 'high'

export function clampPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)))
}

export function usageLevel(percent: number): UsageLevel {
  return percent >= 85 ? 'high' : percent >= 60 ? 'medium' : 'low'
}

/** Text in the color of the level (full class names, so Tailwind finds them). */
export const usageTextClass: Record<UsageLevel, string> = {
  low: 'text-usage-low',
  medium: 'text-usage-medium',
  high: 'text-usage-high',
}

/** Fill of a `Progress` bar in the color of the level. */
export const usageFillClass: Record<UsageLevel, string> = {
  low: '*:data-[slot=progress-indicator]:bg-usage-low',
  medium: '*:data-[slot=progress-indicator]:bg-usage-medium',
  high: '*:data-[slot=progress-indicator]:bg-usage-high',
}

/** Short label of a window for the title bar. */
export function shortWindowLabel(label: string, minutes?: number): string {
  if (minutes === 300 || /5 ?Std|5 Stunden|five/i.test(label)) return '5 Std.'
  if (minutes === 10080 || /Woche|week/i.test(label)) return 'Woche'
  if (minutes && minutes >= 40000) return 'Monat'
  return label
}
