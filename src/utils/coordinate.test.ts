import { describe, it, expect } from 'vitest'
import { parseLatLon, formatLatLon } from './coordinate'

describe('parseLatLon', () => {
  it('parses a lat, lon pair', () => {
    expect(parseLatLon('47.3456, 15.0439')).toEqual({ ok: true, value: { lat: 47.3456, lon: 15.0439 } })
  })

  it('tolerates surrounding and inner whitespace', () => {
    expect(parseLatLon('  -12.5 ,  0  ')).toEqual({ ok: true, value: { lat: -12.5, lon: 0 } })
  })

  it('accepts the extremes of both ranges', () => {
    expect(parseLatLon('-90, -180').ok).toBe(true)
    expect(parseLatLon('90, 180').ok).toBe(true)
  })

  it('rejects a single value', () => {
    expect(parseLatLon('47.3456')).toEqual({
      ok: false,
      error: 'Expected exactly two values separated by a comma.',
    })
  })

  it('rejects non-numeric input', () => {
    const result = parseLatLon('north, east')
    expect(result.ok).toBe(false)
  })

  it('rejects an out-of-range latitude', () => {
    const result = parseLatLon('91, 15')
    expect(result).toEqual({ ok: false, error: 'Latitude must be between −90 and 90.' })
  })

  it('rejects an out-of-range longitude', () => {
    const result = parseLatLon('47, 181')
    expect(result).toEqual({ ok: false, error: 'Longitude must be between −180 and 180.' })
  })
})

describe('formatLatLon', () => {
  it('renders lat first, lon second', () => {
    expect(formatLatLon(15.0439, 47.3456)).toBe('47.345600, 15.043900')
  })

  it('round-trips through parseLatLon', () => {
    const parsed = parseLatLon(formatLatLon(15.0439, 47.3456))
    expect(parsed).toEqual({ ok: true, value: { lat: 47.3456, lon: 15.0439 } })
  })
})
