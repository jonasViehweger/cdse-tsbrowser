import type { BandTimeSeries, RawBands } from '../types/api'
import { buildPixelPolygon } from '../utils/geometry'
import { getValidToken } from './auth'

const STATISTICS_ENDPOINT = `${import.meta.env.VITE_API_BASE}/api/v1/statistics`

const BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const

// Single evalscript — all raw bands including SCL are always fetched.
// Cloud masking is applied client-side using the SCL band values.
const EVALSCRIPT_RAW = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02","B03","B04","B05","B06","B07","B08","B8A","B11","B12","SCL","dataMask"] }],
    output: [
      { id: "B02", bands: 1, sampleType: "FLOAT32" },
      { id: "B03", bands: 1, sampleType: "FLOAT32" },
      { id: "B04", bands: 1, sampleType: "FLOAT32" },
      { id: "B05", bands: 1, sampleType: "FLOAT32" },
      { id: "B06", bands: 1, sampleType: "FLOAT32" },
      { id: "B07", bands: 1, sampleType: "FLOAT32" },
      { id: "B08", bands: 1, sampleType: "FLOAT32" },
      { id: "B8A", bands: 1, sampleType: "FLOAT32" },
      { id: "B11", bands: 1, sampleType: "FLOAT32" },
      { id: "B12", bands: 1, sampleType: "FLOAT32" },
      { id: "SCL", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" }
    ]
  }
}
function evaluatePixel(s) {
  return {
    B02: [s.B02], B03: [s.B03], B04: [s.B04],
    B05: [s.B05], B06: [s.B06], B07: [s.B07],
    B08: [s.B08], B8A: [s.B8A], B11: [s.B11], B12: [s.B12],
    SCL: [s.SCL],
    dataMask: [s.dataMask]
  }
}`


export type BandStatsOutputs = Record<
  string,
  { bands: { B0: { stats: { mean: number; sampleCount: number; noDataCount: number } } } }
>

export interface BandStatsEntry {
  interval: { from: string; to: string }
  /** Present only when the interval was computed successfully. */
  outputs?: BandStatsOutputs
  /** Present *instead of* `outputs` when the interval failed. */
  error?: { type?: string; message?: string }
}

export interface RawBandsResponse {
  data: BandStatsEntry[]
  status?: string
}

/**
 * Interval error types Sentinel Hub considers transient. Same list the official
 * Python SDK retries on, and it recovers them the same way we do below: by
 * re-requesting the interval on its own.
 */
const RETRIABLE_ERRORS = new Set(['EXECUTION_ERROR', 'TIMEOUT'])

export interface FailedInterval {
  date: string
  type: string
  retriable: boolean
}

export interface ParsedRawBands {
  series: BandTimeSeries
  failed: FailedInterval[]
}

export function parseRawBandsResponse(json: RawBandsResponse): ParsedRawBands {
  const series: BandTimeSeries = {}
  const failed: FailedInterval[] = []

  for (const entry of json.data) {
    const date = entry.interval.from.slice(0, 10)

    // A failed interval carries `error` in place of `outputs`. The request as a
    // whole still comes back 200, so this is the only place the failure surfaces.
    if (!entry.outputs) {
      const type = entry.error?.type ?? 'UNKNOWN'
      failed.push({ date, type, retriable: RETRIABLE_ERRORS.has(type) })
      continue
    }

    const bands = {} as RawBands
    for (const band of BAND_NAMES) {
      const mean = entry.outputs[band]?.bands?.B0?.stats?.mean
      bands[band] = mean == null || !isFinite(mean) ? null : mean
    }
    // Only store dates that have at least some valid data
    if (BAND_NAMES.some(b => bands[b] !== null)) {
      series[date] = bands
    }
  }

  return { series, failed }
}

export interface RawBandsResult {
  series: BandTimeSeries
  /**
   * Intervals still missing after retries. A gap here is "we don't know", not
   * "no data" — callers must not persist it as if the range were complete.
   */
  unresolved: FailedInterval[]
}

/**
 * Fetch raw Sentinel-2 band means for a single date range, recovering any
 * intervals that failed transiently.
 *
 * Chunking and caching are handled by bandCache.ts.
 */
export async function fetchRawBands(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
): Promise<RawBandsResult> {
  const first = await requestRawBands(lon, lat, startDate, endDate, collection)

  const retriable = first.failed.filter(f => f.retriable)
  const unresolved = first.failed.filter(f => !f.retriable)

  if (!retriable.length) return { series: first.series, unresolved }

  // Re-request each transiently failed day on its own; a whole-range request
  // that trips one interval usually succeeds when that interval stands alone.
  const retries = await Promise.all(
    retriable.map(async (f): Promise<ParsedRawBands> => {
      try {
        return await requestRawBands(lon, lat, f.date, f.date, collection)
      } catch {
        return { series: {}, failed: [f] }
      }
    }),
  )

  return {
    series: Object.assign({}, first.series, ...retries.map(r => r.series)),
    unresolved: unresolved.concat(...retries.map(r => r.failed)),
  }
}

async function requestRawBands(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
): Promise<ParsedRawBands> {
  const token = await getValidToken()
  const geometry = buildPixelPolygon(lon, lat)
  const evalscript = EVALSCRIPT_RAW

  const body = {
    input: {
      bounds: {
        geometry,
        properties: { crs: 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
      },
      data: [{ dataFilter: { mosaickingOrder: 'leastCC' }, type: collection }],
    },
    aggregation: {
      timeRange: {
        from: `${startDate}T00:00:00Z`,
        to: `${endDate}T23:59:59Z`,
      },
      aggregationInterval: { of: 'P1D' },
      width: 1,
      height: 1,
      evalscript,
      resampling: { downsampling: 'NEAREST', upsampling: 'NEAREST' },
    },
    calculations: {
      default: {},
    },
  }

  const MAX_RETRIES = 4
  let response!: Response
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    response = await fetch(STATISTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    if (response.status !== 429) break
    if (attempt === MAX_RETRIES) break
    // Retry-After is in milliseconds per Sentinel Hub docs.
    // Add full jitter (random 0–100% of base delay) so concurrent retries
    // don't re-synchronize and immediately re-trigger the rate limit.
    const retryAfter = response.headers.get('Retry-After')
    const baseDelayMs = retryAfter ? parseFloat(retryAfter) : 1000 * 2 ** attempt
    const jitter = Math.random() * baseDelayMs
    await new Promise(r => setTimeout(r, baseDelayMs + jitter))
  }

  if (!response.ok) {
    let message: string
    try {
      const err = (await response.json()) as { message?: string; error?: string }
      message = err.message ?? err.error ?? `HTTP ${response.status}`
    } catch {
      message = await response.text().catch(() => `HTTP ${response.status}`)
    }
    throw new Error(`Statistical API error: ${message}`)
  }

  const json = (await response.json()) as RawBandsResponse
  return parseRawBandsResponse(json)
}
