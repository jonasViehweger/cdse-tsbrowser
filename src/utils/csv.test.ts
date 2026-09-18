import { describe, it, expect } from 'vitest'
import { buildTimeSeriesCsv, timeSeriesCsvFilename } from './csv'

const points = [
  { date: '2025-01-01', value: 0.5 },
  { date: '2025-01-06', value: null },
  { date: '2025-01-11', value: -0.25 },
]

describe('buildTimeSeriesCsv', () => {
  it('emits a header and one row per plotted point', () => {
    const lines = buildTimeSeriesCsv(points, 'NDVI').trimEnd().split('\n')
    expect(lines).toEqual([
      'date,NDVI',
      '2025-01-01,0.5',
      '2025-01-11,-0.25',
    ])
  })

  it('has only the header for an empty series', () => {
    expect(buildTimeSeriesCsv([], 'NDVI')).toBe('date,NDVI\n')
  })

  it('has only the header when every point is masked out', () => {
    const masked = points.map(p => ({ ...p, value: null }))
    expect(buildTimeSeriesCsv(masked, 'NDVI')).toBe('date,NDVI\n')
  })

  it('quotes a column name containing a comma', () => {
    expect(buildTimeSeriesCsv([], 'a,b')).toBe('date,"a,b"\n')
  })
})

describe('timeSeriesCsvFilename', () => {
  it('slugifies the source name and includes coordinate and range', () => {
    expect(timeSeriesCsvFilename('S2 Tasseled Cap Wetness', [11.146453, 48.9207], '2020-01-01', '2025-01-01'))
      .toBe('S2_Tasseled_Cap_Wetness_11.1465_48.9207_2020-01-01_2025-01-01.csv')
  })
})
