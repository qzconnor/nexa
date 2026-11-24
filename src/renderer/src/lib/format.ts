const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' })
const dateTime = new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short' })
const clock = new Intl.DateTimeFormat('de', { hour: '2-digit', minute: '2-digit' })
const weekdayClock = new Intl.DateTimeFormat('de', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const integer = new Intl.NumberFormat('de')
const oneDecimal = new Intl.NumberFormat('de', { maximumFractionDigits: 1 })

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "vor 5 Minuten", "gestern", … */
export function formatRelative(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '–'
  const diff = (ms - now) / 1000
  if (Math.abs(diff) < 45) return 'gerade eben'
  const minutes = Math.round(diff / 60)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(diff / 3600)
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000)
  if (Math.abs(hours) < 24 || days === 0) return rtf.format(hours, 'hour')
  if (Math.abs(days) < 30) return rtf.format(days, 'day')
  return dateTime.format(ms)
}

/** Short age for the sidebar: "jetzt", "5 Min.", "3 Std.", "2 T.", "12.03." */
export function formatAge(ms: number, now = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000)
  if (minutes < 1) return 'jetzt'
  if (minutes < 60) return `${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} Std.`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} T.`
  return new Date(ms).toLocaleDateString('de', { day: '2-digit', month: '2-digit' })
}

/** 950 ms, 4,2 s, 3 Min. 12 s, 1 Std. 4 Min. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toLocaleString('de', { maximumFractionDigits: seconds < 10 ? 1 : 0 })} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} Min. ${Math.floor(seconds % 60)} s`
  return `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`
}

/** 1.234, 12,3 k, 1,2 M */
export function formatTokens(n: number): string {
  if (n < 10_000) return integer.format(n)
  if (n < 1_000_000) return `${(n / 1000).toLocaleString('de', { maximumFractionDigits: 1 })} k`
  return `${(n / 1_000_000).toLocaleString('de', { maximumFractionDigits: 2 })} M`
}

export function formatClock(ms: number): string {
  return clock.format(ms)
}

/** A time ahead as a clock time, further away than most of a day with the weekday ("Do., 14:30"). */
export function formatAhead(ms: number, now = Date.now()): string {
  return ms - now < 20 * 3600_000 ? clock.format(ms) : weekdayClock.format(ms)
}

/** When a limit resets: "in 2 Std. 13 Min. · 17:54", further away with the weekday. */
export function formatReset(ms: number, now = Date.now()): string {
  const ahead = ms - now
  if (ahead <= 0) return 'gleich'
  return `in ${formatSpan(ahead)} · ${formatAhead(ms, now)}`
}

/** A stretch of time to a limit or a reset: "45 Min.", "2 Std. 13 Min.", "3 T." */
export function formatSpan(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000)
  return minutes < 60 ? `${minutes} Min.` : minutes < 24 * 60 ? `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.` : `${Math.round(minutes / 60 / 24)} T.`
}

export function formatDateTime(ms: number): string {
  return dateTime.format(ms)
}

/** A file's size: bytes, KB, MB with one place, GB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${integer.format(bytes)} B`
  const kb = Math.round(bytes / 1024)
  if (kb < 1024) return `${integer.format(kb)} KB`
  const mb = Math.round((bytes / 1024 ** 2) * 10) / 10
  if (mb < 1024) return `${oneDecimal.format(mb)} MB`
  return `${oneDecimal.format(bytes / 1024 ** 3)} GB`
}
