/**
 * Client-side rate limit for Sentinel Hub requests, shared by everything that
 * talks to the API so concurrent loads can't add up to a burst of 429s.
 *
 * Requests go out at a fixed interval: the CDSE free tier allows 300 requests
 * a minute, so one every 200 ms. Bursts, even ones within that average, run
 * into 429s.
 */

export type Priority = 'foreground' | 'background'

const MIN_INTERVAL_MS = 60_000 / 300

const waiting: Record<Priority, Array<() => void>> = { foreground: [], background: [] }
let nextSlotAt = 0
let timer: ReturnType<typeof setTimeout> | null = null

/** Resolves once a request may be sent. Foreground requests always go first. */
export function acquireSlot(priority: Priority = 'foreground'): Promise<void> {
  return new Promise(resolve => {
    waiting[priority].push(resolve)
    pump()
  })
}

/** Hold back every request, not only the rejected one, after a 429. */
export function pauseFor(ms: number) {
  nextSlotAt = Math.max(nextSlotAt, Date.now() + ms)
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  pump()
}

function pump() {
  // Whoever is first in line when the timer fires gets the slot, so a
  // foreground request still overtakes a background one waiting for it.
  if (timer !== null) return
  if (!waiting.foreground.length && !waiting.background.length) return

  timer = setTimeout(() => {
    timer = null
    const next = waiting.foreground.shift() ?? waiting.background.shift()
    if (!next) return
    nextSlotAt = Date.now() + MIN_INTERVAL_MS
    next()
    pump()
  }, Math.max(0, nextSlotAt - Date.now()))
}
