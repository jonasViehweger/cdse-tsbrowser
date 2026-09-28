import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseRawBandsResponse,
  fetchRawBands,
  buildEvalscript,
  readApiError,
  isRetriableError,
  type BandStatsOutputs,
  type RawBandsResponse,
} from './statisticalApi'

vi.mock('./auth', () => ({ getValidToken: () => Promise.resolve('test-token') }))

const BANDS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const

/**
 * Build a minimal successful BandStatsEntry fixture for one date. Values are
 * given as reflectances and encoded as DN, the way the evalscript returns them.
 */
function makeEntry(date: string, bandValues: Partial<Record<string, number>> = {}): RawBandsResponse['data'][0] {
  const outputs: BandStatsOutputs = {}
  for (const b of BANDS) {
    const value = bandValues[b] ?? 0.1
    const mean = b === 'SCL' ? value : Math.round(value * 10000)
    outputs[b] = { bands: { B0: { stats: { mean, sampleCount: 1, noDataCount: 0 } } } }
  }
  return {
    interval: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
    outputs,
  }
}

/** An interval the API failed to compute — carries `error` and no `outputs` at all. */
function makeFailedEntry(date: string, type = 'EXECUTION_ERROR'): RawBandsResponse['data'][0] {
  return {
    interval: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
    error: { type },
  }
}

/** The outputs of a successful entry, for tests that mutate a band mean. */
function outputsOf(entry: RawBandsResponse['data'][0]): BandStatsOutputs {
  if (!entry.outputs) throw new Error('entry has no outputs')
  return entry.outputs
}

describe('parseRawBandsResponse', () => {
  it('returns an empty series for an empty response', () => {
    expect(parseRawBandsResponse({ data: [] })).toEqual({ series: {}, failed: [] })
  })

  it('keys the result by the date portion of interval.from', () => {
    const { series } = parseRawBandsResponse({ data: [makeEntry('2025-06-15')] })
    expect('2025-06-15' in series).toBe(true)
  })

  it('extracts band means correctly', () => {
    const { series } = parseRawBandsResponse({
      data: [makeEntry('2025-06-15', { B08: 0.35, B04: 0.12 })],
    })
    expect(series['2025-06-15'].B08).toBeCloseTo(0.35)
    expect(series['2025-06-15'].B04).toBeCloseTo(0.12)
  })

  it('scales DN back to reflectance but leaves SCL class values untouched', () => {
    const entry = makeEntry('2025-06-15')
    outputsOf(entry)['B08'].bands.B0.stats.mean = 3512
    outputsOf(entry)['SCL'].bands.B0.stats.mean = 4
    const { series } = parseRawBandsResponse({ data: [entry] })
    expect(series['2025-06-15'].B08).toBe(0.3512)
    expect(series['2025-06-15'].SCL).toBe(4)
  })

  it('converts NaN mean to null', () => {
    const entry = makeEntry('2025-06-15', {})
    outputsOf(entry)['B08'].bands.B0.stats.mean = NaN
    const { series } = parseRawBandsResponse({ data: [entry] })
    expect(series['2025-06-15'].B08).toBeNull()
  })

  it('converts Infinity mean to null', () => {
    const entry = makeEntry('2025-06-15', {})
    outputsOf(entry)['B04'].bands.B0.stats.mean = Infinity
    const { series } = parseRawBandsResponse({ data: [entry] })
    expect(series['2025-06-15'].B04).toBeNull()
  })

  it('omits entries where all bands are null (fully masked)', () => {
    const entry = makeEntry('2025-06-15', {})
    for (const b of BANDS) {
      outputsOf(entry)[b].bands.B0.stats.mean = NaN
    }
    const { series } = parseRawBandsResponse({ data: [entry] })
    expect('2025-06-15' in series).toBe(false)
  })

  it('handles multiple dates', () => {
    const { series } = parseRawBandsResponse({
      data: [makeEntry('2025-06-10'), makeEntry('2025-06-15')],
    })
    expect(Object.keys(series)).toHaveLength(2)
  })

  it('reports a failed interval instead of throwing on its missing outputs', () => {
    const { series, failed } = parseRawBandsResponse({
      data: [makeEntry('2025-06-10'), makeFailedEntry('2025-06-15')],
    })

    expect(Object.keys(series)).toEqual(['2025-06-10'])
    expect(failed).toEqual([{ date: '2025-06-15', type: 'EXECUTION_ERROR', retriable: true }])
  })

  it('marks unrecognised error types as non-retriable', () => {
    const { failed } = parseRawBandsResponse({ data: [makeFailedEntry('2025-06-15', 'BAD_REQUEST')] })
    expect(failed[0].retriable).toBe(false)
  })

  it('only returns the bands present in the response', () => {
    const entry = makeEntry('2025-06-15', { B08: 0.3 })
    for (const b of BANDS) if (b !== 'B08') delete outputsOf(entry)[b]
    const { series } = parseRawBandsResponse({ data: [entry] })
    expect(series['2025-06-15']).toEqual({ B08: 0.3 })
  })
})

describe('readApiError', () => {
  const respond = (status: number, body: string) => new Response(body, { status })

  it('reads the message from a Sentinel Hub error body', async () => {
    const error = await readApiError(respond(429, JSON.stringify({
      error: { status: 429, reason: 'Too Many Requests', message: 'You have exceeded your rate limit', code: 'RATE_LIMIT_EXCEEDED' },
    })))
    expect(error.message).toBe('Statistical API error: You have exceeded your rate limit (HTTP 429)')
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(isRetriableError(error)).toBe(true)
  })

  it('falls back to the raw body when it is not JSON', async () => {
    const error = await readApiError(respond(502, 'Bad Gateway'))
    expect(error.message).toBe('Statistical API error: Bad Gateway (HTTP 502)')
    expect(isRetriableError(error)).toBe(true)
  })

  it('does not offer a retry for client errors', async () => {
    const error = await readApiError(respond(400, JSON.stringify({ error: { message: 'Invalid evalscript' } })))
    expect(error.message).toBe('Statistical API error: Invalid evalscript (HTTP 400)')
    expect(isRetriableError(error)).toBe(false)
  })
})

describe('buildEvalscript', () => {
  it('reads only the requested bands plus dataMask', () => {
    const script = buildEvalscript(['B04', 'B08', 'SCL'])
    expect(script).toContain('input: [{ bands: ["B04","B08","SCL","dataMask"] }]')
    expect(script).toContain('{ id: "B04", bands: 1, sampleType: "UINT16" }')
    expect(script).toContain('{ id: "SCL", bands: 1, sampleType: "UINT8" }')
    expect(script).toContain('B08: [dn(s.B08)]')
    expect(script).toContain('SCL: [s.SCL]')
    expect(script).not.toContain('B11')
  })
})

describe('fetchRawBands', () => {
  let bodies: RawBandsResponse[]

  beforeEach(() => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(bodies.shift() ?? { data: [] }),
      } as Response),
    )
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('recovers a transiently failed interval by re-requesting it alone', async () => {
    bodies = [
      { data: [makeEntry('2025-06-10'), makeFailedEntry('2025-06-15')] },
      { data: [makeEntry('2025-06-15', { B08: 0.42 })] }, // the per-interval retry
    ]

    const { series, unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a', ['B08'])

    expect(Object.keys(series).sort()).toEqual(['2025-06-10', '2025-06-15'])
    expect(series['2025-06-15'].B08).toBeCloseTo(0.42)
    expect(unresolved).toEqual([])
  })

  it('reports an interval still failing after its retry, rather than silently dropping it', async () => {
    bodies = [
      { data: [makeEntry('2025-06-10'), makeFailedEntry('2025-06-15')] },
      { data: [makeFailedEntry('2025-06-15')] }, // retry fails too
    ]

    const { series, unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a', ['B08'])

    expect(Object.keys(series)).toEqual(['2025-06-10'])
    expect(unresolved.map(f => f.date)).toEqual(['2025-06-15'])
  })

  it('does not retry a non-retriable error type', async () => {
    bodies = [{ data: [makeFailedEntry('2025-06-15', 'BAD_REQUEST')] }]

    const { unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a', ['B08'])

    expect(unresolved).toEqual([{ date: '2025-06-15', type: 'BAD_REQUEST', retriable: false }])
    expect(bodies).toHaveLength(0) // the retry would have consumed a second body
  })
})
