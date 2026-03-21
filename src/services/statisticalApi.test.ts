import { describe, it, expect } from 'vitest'
import { parseRawBandsResponse, type RawBandsResponse } from './statisticalApi'

const BANDS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12', 'SCL'] as const

/** Build a minimal BandStatsEntry fixture for one date. */
function makeEntry(date: string, bandValues: Partial<Record<string, number>> = {}): RawBandsResponse['data'][0] {
  const outputs: RawBandsResponse['data'][0]['outputs'] = {}
  for (const b of BANDS) {
    outputs[b] = { bands: { B0: { stats: { mean: bandValues[b] ?? 0.1, sampleCount: 1, noDataCount: 0 } } } }
  }
  return {
    interval: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
    outputs,
  }
}

describe('parseRawBandsResponse', () => {
  it('returns an empty object for an empty response', () => {
    expect(parseRawBandsResponse({ data: [] })).toEqual({})
  })

  it('keys the result by the date portion of interval.from', () => {
    const result = parseRawBandsResponse({ data: [makeEntry('2025-06-15')] })
    expect('2025-06-15' in result).toBe(true)
  })

  it('extracts band means correctly', () => {
    const result = parseRawBandsResponse({
      data: [makeEntry('2025-06-15', { B08: 0.35, B04: 0.12 })],
    })
    expect(result['2025-06-15'].B08).toBeCloseTo(0.35)
    expect(result['2025-06-15'].B04).toBeCloseTo(0.12)
  })

  it('converts NaN mean to null', () => {
    const entry = makeEntry('2025-06-15', {})
    entry.outputs['B08'].bands.B0.stats.mean = NaN
    const result = parseRawBandsResponse({ data: [entry] })
    expect(result['2025-06-15'].B08).toBeNull()
  })

  it('converts Infinity mean to null', () => {
    const entry = makeEntry('2025-06-15', {})
    entry.outputs['B04'].bands.B0.stats.mean = Infinity
    const result = parseRawBandsResponse({ data: [entry] })
    expect(result['2025-06-15'].B04).toBeNull()
  })

  it('omits entries where all bands are null (fully masked)', () => {
    const entry = makeEntry('2025-06-15', {})
    for (const b of BANDS) {
      entry.outputs[b].bands.B0.stats.mean = NaN
    }
    const result = parseRawBandsResponse({ data: [entry] })
    expect('2025-06-15' in result).toBe(false)
  })

  it('handles multiple dates', () => {
    const result = parseRawBandsResponse({
      data: [makeEntry('2025-06-10'), makeEntry('2025-06-15')],
    })
    expect(Object.keys(result)).toHaveLength(2)
    expect('2025-06-10' in result).toBe(true)
    expect('2025-06-15' in result).toBe(true)
  })
})
