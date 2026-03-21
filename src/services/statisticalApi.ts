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


export interface BandStatsEntry {
  interval: { from: string; to: string }
  outputs: Record<string, { bands: { B0: { stats: { mean: number; sampleCount: number; noDataCount: number } } } }>
}

export interface RawBandsResponse {
  data: BandStatsEntry[]
}

export function parseRawBandsResponse(json: RawBandsResponse): BandTimeSeries {
  const result: BandTimeSeries = {}
  for (const entry of json.data) {
    const date = entry.interval.from.slice(0, 10)
    const bands = {} as RawBands
    for (const band of BAND_NAMES) {
      const mean = entry.outputs[band]?.bands?.B0?.stats?.mean
      bands[band] = mean == null || !isFinite(mean) ? null : mean
    }
    // Only store dates that have at least some valid data
    if (BAND_NAMES.some(b => bands[b] !== null)) {
      result[date] = bands
    }
  }
  return result
}

/**
 * Fetch raw Sentinel-2 band means for a single date range.
 * Chunking and caching are handled by bandCache.ts.
 */
export async function fetchRawBands(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
): Promise<BandTimeSeries> {
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

  const response = await fetch(STATISTICS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

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
