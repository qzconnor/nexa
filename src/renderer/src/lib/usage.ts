import type { UsageWindow } from '@shared/types'
import { formatAhead, formatSpan } from './format'

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

/** What the forecast of a window says, short beside its bar and in full for its tooltip. */
export interface ForecastHint {
  text: string
  title: string
  /** The limit comes before the reset. */
  warn: boolean
  /** When the limit comes, as a (week)day and clock time; null when it doesn't come before the reset. */
  at: string | null
}

function rateLabel(perHour: number): string {
  const rounded = Math.round(perHour * 10) / 10
  return `${rounded.toLocaleString('de')} ${rounded === 1 ? 'Punkt' : 'Punkte'} pro Stunde`
}

/**
 * Where the window heads at the current pace: when the limit comes, if before the reset, otherwise
 * how full it will be at the reset. Null while there is nothing to tell, or nothing more will be used.
 */
export function forecastHint(window: UsageWindow, now: number): ForecastHint | null {
  const forecast = window.forecast
  if (!forecast) return null
  const basis = forecast.basis === 'recent' ? 'Tempo der letzten Zeit' : 'Schnitt seit Beginn des Fensters'
  if (forecast.exhaustsAt) {
    if (forecast.exhaustsAt <= now) return null
    const at = formatAhead(forecast.exhaustsAt, now)
    const early = window.resetsAt ? `, ${formatSpan(window.resetsAt - forecast.exhaustsAt)} vor dem Reset` : ''
    return {
      text: `Limit ≈ ${at}`,
      title: `Bei diesem Tempo (${rateLabel(forecast.ratePerHour)}, ${basis}) ist das Limit gegen ${at} erreicht${early}.`,
      warn: true,
      at,
    }
  }
  const atReset = Math.min(100, Math.round(forecast.atReset))
  if (atReset <= clampPercent(window.usedPercent)) return null
  return {
    text: `≈ ${atReset} % zum Reset`,
    title: `Bei diesem Tempo (${rateLabel(forecast.ratePerHour)}, ${basis}) steht das Fenster zum Reset bei etwa ${atReset} %.`,
    warn: false,
    at: null,
  }
}

/**
 * Short label of a window for the title bar. A window of a group of models (Antigravity:
 * „Gemini · Woche“) keeps its group, else two weekly windows would read alike.
 */
export function shortWindowLabel(label: string, minutes?: number): string {
  const at = label.indexOf(' · ')
  if (at > 0) return `${label.slice(0, at)} ${shortWindowLabel(label.slice(at + 3), minutes)}`
  if (minutes === 300 || /5 ?Std|5 Stunden|five/i.test(label)) return '5 Std.'
  if (minutes === 10080 || /Woche|week/i.test(label)) return 'Woche'
  if (minutes && minutes >= 40000) return 'Monat'
  return label
}
