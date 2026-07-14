import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseRawBandsResponse,
  fetchRawBands,
  type BandStatsOutputs,
  type RawBandsResponse,
} from './statisticalApi'

vi.mock('./auth', () => ({ getValidToken: () => Promise.resolve('test-token') }))

const BANDS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const

/** Build a minimal successful BandStatsEntry fixture for one date. */
function makeEntry(date: string, bandValues: Partial<Record<string, number>> = {}): RawBandsResponse['data'][0] {
  const outputs: BandStatsOutputs = {}
  for (const b of BANDS) {
    outputs[b] = { bands: { B0: { stats: { mean: bandValues[b] ?? 0.1, sampleCount: 1, noDataCount: 0 } } } }
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

    const { series, unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a')

    expect(Object.keys(series).sort()).toEqual(['2025-06-10', '2025-06-15'])
    expect(series['2025-06-15'].B08).toBeCloseTo(0.42)
    expect(unresolved).toEqual([])
  })

  it('reports an interval still failing after its retry, rather than silently dropping it', async () => {
    bodies = [
      { data: [makeEntry('2025-06-10'), makeFailedEntry('2025-06-15')] },
      { data: [makeFailedEntry('2025-06-15')] }, // retry fails too
    ]

    const { series, unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a')

    expect(Object.keys(series)).toEqual(['2025-06-10'])
    expect(unresolved.map(f => f.date)).toEqual(['2025-06-15'])
  })

  it('does not retry a non-retriable error type', async () => {
    bodies = [{ data: [makeFailedEntry('2025-06-15', 'BAD_REQUEST')] }]

    const { unresolved } = await fetchRawBands(11, 48, '2025-06-01', '2025-06-30', 'sentinel-2-l2a')

    expect(unresolved).toEqual([{ date: '2025-06-15', type: 'BAD_REQUEST', retriable: false }])
    expect(bodies).toHaveLength(0) // the retry would have consumed a second body
  })
})
