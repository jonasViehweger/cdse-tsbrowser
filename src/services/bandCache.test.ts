import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BandName } from '../types/api'
import type { PartialBandSeries, RawBandsResult } from './statisticalApi'

vi.mock('./statisticalApi', async importOriginal => ({
  ...(await importOriginal<typeof import('./statisticalApi')>()),
  fetchRawBands: vi.fn(),
}))

type Call = [from: string, to: string, bands: BandName[]]

let calls: Call[]
let fetchBandTimeSeries: typeof import('./bandCache').fetchBandTimeSeries
/** Override to fail or leave gaps for particular requests. */
let respond: (from: string, to: string, bands: BandName[]) => RawBandsResult

/** One observation on the 15th of every month, 0.1 for every band. */
function observations(from: string, to: string, bands: BandName[]): RawBandsResult {
  const series: PartialBandSeries = {}
  for (let d = new Date(from.slice(0, 8) + '15T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const date = d.toISOString().slice(0, 10)
    if (date >= from) series[date] = Object.fromEntries(bands.map(b => [b, 0.1]))
  }
  return { series, unresolved: [] }
}

class MemoryStorage {
  private items = new Map<string, string>()
  get length() { return this.items.size }
  key(i: number) { return [...this.items.keys()][i] ?? null }
  getItem(k: string) { return this.items.get(k) ?? null }
  setItem(k: string, v: string) { this.items.set(k, v) }
  removeItem(k: string) { this.items.delete(k) }
}

const L2A = 'sentinel-2-l2a'
const fetchPlain = (start: string, end: string, bands: BandName[]) =>
  fetchBandTimeSeries(11, 48, start, end, L2A, bands)

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  calls = []
  respond = observations
  const api = await import('./statisticalApi')
  vi.mocked(api.fetchRawBands).mockImplementation(async (_lon, _lat, from, to, _collection, bands) => {
    calls.push([from, to, [...bands]])
    return respond(from, to, [...bands])
  })
  fetchBandTimeSeries = (await import('./bandCache')).fetchBandTimeSeries
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchBandTimeSeries', () => {
  it('requests only the given bands, split into calendar half-years', async () => {
    const series = await fetchPlain('2024-03-01', '2024-09-30', ['B04', 'B08'])

    expect(calls).toEqual([
      ['2024-03-01', '2024-06-30', ['B04', 'B08']],
      ['2024-07-01', '2024-09-30', ['B04', 'B08']],
    ])
    expect(Object.keys(series)).toHaveLength(7)
    expect(series['2024-05-15']).toMatchObject({ B04: 0.1, B08: 0.1, B11: null, SCL: null })
  })

  it('serves cached bands without a request', async () => {
    await fetchPlain('2024-03-01', '2024-09-30', ['B04', 'B08'])
    calls = []
    const series = await fetchPlain('2024-03-01', '2024-09-30', ['B08'])

    expect(calls).toEqual([])
    expect(series['2024-05-15']).toMatchObject({ B08: 0.1, B04: null })
  })

  it('fetches only bands not cached yet', async () => {
    await fetchPlain('2024-03-01', '2024-09-30', ['B04', 'B08'])
    calls = []
    const series = await fetchPlain('2024-03-01', '2024-09-30', ['B04', 'B08', 'B11'])

    expect(calls).toEqual([
      ['2024-03-01', '2024-06-30', ['B11']],
      ['2024-07-01', '2024-09-30', ['B11']],
    ])
    expect(series['2024-05-15']).toMatchObject({ B04: 0.1, B08: 0.1, B11: 0.1 })
  })

  it('fetches only the added dates when the range is extended', async () => {
    await fetchPlain('2024-03-01', '2024-09-30', ['B08'])
    calls = []
    const series = await fetchPlain('2024-01-01', '2024-09-30', ['B08'])

    expect(calls).toEqual([['2024-01-01', '2024-02-29', ['B08']]])
    expect(Object.keys(series)).toHaveLength(9)
  })

  it('combines concurrent requests into one request per chunk', async () => {
    await Promise.all([
      fetchPlain('2024-03-01', '2024-06-30', ['B04', 'B08', 'SCL']),
      fetchPlain('2024-03-01', '2024-06-30', ['B08', 'B11', 'SCL']),
    ])

    expect(calls).toEqual([['2024-03-01', '2024-06-30', ['B04', 'B08', 'SCL', 'B11']]])
  })

  it('keeps completed chunks when another one fails', async () => {
    respond = (from, to, bands) => {
      if (from === '2024-07-01') throw new Error('Statistical API error: rate limited')
      return observations(from, to, bands)
    }
    await expect(fetchPlain('2024-03-01', '2024-09-30', ['B08'])).rejects.toThrow('rate limited')

    respond = observations
    calls = []
    const series = await fetchPlain('2024-03-01', '2024-09-30', ['B08'])

    expect(calls).toEqual([['2024-07-01', '2024-09-30', ['B08']]])
    expect(Object.keys(series)).toHaveLength(7)
  })

  it('refetches intervals that could not be recovered', async () => {
    respond = (from, to, bands) => ({
      ...observations(from, to, bands),
      unresolved: [{ date: '2024-04-15', type: 'EXECUTION_ERROR', retriable: true }],
    })
    await fetchPlain('2024-03-01', '2024-06-30', ['B08'])

    respond = observations
    calls = []
    await fetchPlain('2024-03-01', '2024-06-30', ['B08'])

    expect(calls).toEqual([['2024-04-15', '2024-04-15', ['B08']]])
  })

  it('refetches the most recent days once the fetch is a few hours old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2024-09-30T12:00:00Z'))
    await fetchPlain('2024-07-01', '2024-09-30', ['B08'])
    calls = []

    await fetchPlain('2024-07-01', '2024-09-30', ['B08'])
    expect(calls).toEqual([])

    vi.setSystemTime(new Date('2024-09-30T19:00:00Z'))
    await fetchPlain('2024-07-01', '2024-09-30', ['B08'])
    expect(calls).toEqual([['2024-09-28', '2024-09-30', ['B08']]])
  })

  it('refetches all requested bands when forced', async () => {
    await fetchPlain('2024-03-01', '2024-06-30', ['B08'])
    calls = []
    await fetchBandTimeSeries(11, 48, '2024-03-01', '2024-06-30', L2A, ['B08'], true)

    expect(calls).toEqual([['2024-03-01', '2024-06-30', ['B08']]])
  })

  it('imports entries from the pre-chunking cache', async () => {
    const legacyKey = `cdse-bands-11_48_2024-03-01_2024-06-30_${L2A}`
    localStorage.setItem(legacyKey, JSON.stringify({ '2024-04-15': { B08: 0.3, SCL: 4 } }))

    const series = await fetchPlain('2024-03-01', '2024-06-30', ['B08', 'SCL'])

    // Only the last days before the old fetch date, which may have been incomplete.
    expect(calls).toEqual([['2024-06-28', '2024-06-30', ['B08', 'SCL']]])
    expect(series['2024-04-15']).toMatchObject({ B08: 0.3, SCL: 4 })
    expect(localStorage.getItem(legacyKey)).toBeNull()
  })
})
