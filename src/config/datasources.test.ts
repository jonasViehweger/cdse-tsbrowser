import { describe, it, expect } from 'vitest'
import { DATA_SOURCES } from './datasources'
import type { RawBands } from '../types/api'

describe('DATA_SOURCES', () => {
  // Only the declared bands are fetched, so a compute reading any other band
  // would silently get null.
  it.each(DATA_SOURCES.map(ds => [ds.id, ds] as const))('%s declares every band its compute reads', (_, ds) => {
    const read = new Set<string>()
    const bands = new Proxy({} as RawBands, {
      get: (_target, band: string) => {
        read.add(band)
        return 0.2
      },
    })
    ds.compute(bands)
    expect([...read].sort()).toEqual([...ds.bands].sort())
  })

  it.each(DATA_SOURCES.map(ds => [ds.id, ds] as const))('%s returns null when one of its bands is null', (_, ds) => {
    for (const missing of ds.bands) {
      const bands = Object.fromEntries(ds.bands.map(b => [b, b === missing ? null : 0.2])) as unknown as RawBands
      expect(ds.compute(bands)).toBeNull()
    }
  })
})
