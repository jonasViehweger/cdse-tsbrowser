import type { BandTimeSeries } from '../types/api'
import { fetchRawBands } from './statisticalApi'

const CACHE_PREFIX = 'cdse-bands-'

// In-flight requests keyed by cache key — prevents duplicate concurrent fetches
// across multiple useTimeSeries instances for the same location/dates/collection.
const inFlight = new Map<string, Promise<BandTimeSeries>>()

function cacheKey(lon: number, lat: number, startDate: string, endDate: string, collection: string): string {
  return `${CACHE_PREFIX}${lon}_${lat}_${startDate}_${endDate}_${collection}`
}

/** Split a date range into ≤6-month chunks for concurrent fetching. */
function halfYearChunks(startDate: string, endDate: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = []
  let current = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')

  while (current < end) {
    const next = new Date(current)
    next.setUTCMonth(next.getUTCMonth() + 6)
    const chunkEnd = next > end ? new Date(end) : next
    chunks.push([current.toISOString().slice(0, 10), chunkEnd.toISOString().slice(0, 10)])
    current = new Date(chunkEnd)
  }

  return chunks
}

/**
 * Fetch raw Sentinel-2 band time series for a location and date range.
 * Results are cached in localStorage keyed by (lon, lat, dates, maskClouds).
 * The date range is split into 6-month chunks fetched concurrently.
 *
 * @param force - Skip cache and re-fetch from the API.
 */
export function fetchBandTimeSeries(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
  force = false,
): Promise<BandTimeSeries> {
  const key = cacheKey(lon, lat, startDate, endDate, collection)

  if (!force) {
    const cached = localStorage.getItem(key)
    if (cached) {
      try {
        return Promise.resolve(JSON.parse(cached) as BandTimeSeries)
      } catch {
        localStorage.removeItem(key)
      }
    }

    const existing = inFlight.get(key)
    if (existing) return existing
  }

  const request = (async () => {
    const chunks = halfYearChunks(startDate, endDate)
    const results = await Promise.all(
      chunks.map(([s, e]) => fetchRawBands(lon, lat, s, e, collection)),
    )
    const merged: BandTimeSeries = Object.assign({}, ...results)
    try {
      localStorage.setItem(key, JSON.stringify(merged))
    } catch {
      // Ignore storage quota errors — cache is best-effort
    }
    inFlight.delete(key)
    return merged
  })()

  inFlight.set(key, request)
  return request
}
