import type { BandName, RawBands } from '../types/api'
import { buildPixelPolygon } from '../utils/geometry'
import { getValidToken } from './auth'

const STATISTICS_ENDPOINT = `${import.meta.env.VITE_API_BASE}/api/v1/statistics`

export const BAND_NAMES: readonly BandName[] = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL']

// L2A reflectance is stored as UINT16 DN / 10000, so the DN is lossless.
const REFLECTANCE_SCALE = 10000

/**
 * Evalscript returning the requested raw bands. Cloud masking is applied
 * client-side using the SCL band values.
 * PUs scale with the number of input bands, so only the requested ones are read.
 * Outputs are integers because FLOAT32 output doubles the processing units:
 * reflectances go out as DN (scaled back in parseRawBandsResponse).
 */
export function buildEvalscript(bands: readonly BandName[]): string {
  const outputs = bands.map(b => `{ id: "${b}", bands: 1, sampleType: "${b === 'SCL' ? 'UINT8' : 'UINT16'}" }`)
  outputs.push('{ id: "dataMask", bands: 1, sampleType: "UINT8" }')
  const values = bands.map(b => `${b}: [${b === 'SCL' ? 's.SCL' : `dn(s.${b})`}]`)
  values.push('dataMask: [s.dataMask]')
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ${JSON.stringify([...bands, 'dataMask'])} }],
    output: [
      ${outputs.join(',\n      ')}
    ]
  }
}
function dn(r) { return Math.round(r * ${REFLECTANCE_SCALE}) }
function evaluatePixel(s) {
  return {
    ${values.join(',\n    ')}
  }
}`
}

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

/** date → the bands that were requested; the rest are absent. */
export type PartialBandSeries = Record<string, Partial<RawBands>>

export interface ParsedRawBands {
  series: PartialBandSeries
  failed: FailedInterval[]
}

export function parseRawBandsResponse(json: RawBandsResponse): ParsedRawBands {
  const series: PartialBandSeries = {}
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

    const bands: Partial<RawBands> = {}
    for (const band of BAND_NAMES) {
      if (!(band in entry.outputs)) continue
      const mean = entry.outputs[band]?.bands?.B0?.stats?.mean
      if (mean == null || !isFinite(mean)) bands[band] = null
      else bands[band] = band === 'SCL' ? mean : mean / REFLECTANCE_SCALE
    }
    // Only store dates that have at least some valid data
    if (Object.values(bands).some(v => v !== null)) {
      series[date] = bands
    }
  }

  return { series, failed }
}

export class StatisticalApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
    readonly code?: string,
  ) {
    super(`Statistical API error: ${detail} (HTTP ${status})`)
    this.name = 'StatisticalApiError'
  }

  /** Rate limits and server errors may succeed when tried again later. */
  get retriable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** Whether trying the same request again later may succeed. */
export function isRetriableError(e: unknown): boolean {
  if (e instanceof StatisticalApiError) return e.retriable
  // fetch() rejects with a TypeError when the network request itself fails.
  return e instanceof TypeError
}

type ErrorBody = {
  message?: string
  error?: string | { message?: string; reason?: string; code?: string }
}

/** Sentinel Hub errors come as `{ error: { status, reason, message, code } }`. */
export async function readApiError(response: Response): Promise<StatisticalApiError> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as ErrorBody
    const error = typeof body.error === 'object' && body.error !== null ? body.error : undefined
    const detail = error?.message ?? error?.reason ?? body.message ?? (typeof body.error === 'string' ? body.error : undefined)
    if (detail) return new StatisticalApiError(response.status, detail, error?.code)
  } catch {
    // Not JSON — fall back to the raw text
  }
  return new StatisticalApiError(response.status, text.trim() || response.statusText || 'request failed')
}

export interface RawBandsResult {
  series: PartialBandSeries
  /**
   * Intervals still missing after retries. A gap here is "we don't know", not
   * "no data" — callers must not persist it as if the range were complete.
   */
  unresolved: FailedInterval[]
}

/**
 * Fetch the given raw Sentinel-2 band means for a single date range, recovering any
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
  bands: readonly BandName[],
): Promise<RawBandsResult> {
  const first = await requestRawBands(lon, lat, startDate, endDate, collection, bands)

  const retriable = first.failed.filter(f => f.retriable)
  const unresolved = first.failed.filter(f => !f.retriable)

  if (!retriable.length) return { series: first.series, unresolved }

  // Re-request each transiently failed day on its own; a whole-range request
  // that trips one interval usually succeeds when that interval stands alone.
  const retries = await Promise.all(
    retriable.map(async (f): Promise<ParsedRawBands> => {
      try {
        return await requestRawBands(lon, lat, f.date, f.date, collection, bands)
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
  bands: readonly BandName[],
): Promise<ParsedRawBands> {
  const token = await getValidToken()
  const geometry = buildPixelPolygon(lon, lat)
  const evalscript = buildEvalscript(bands)

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

  if (!response.ok) throw await readApiError(response)

  const json = (await response.json()) as RawBandsResponse
  return parseRawBandsResponse(json)
}
