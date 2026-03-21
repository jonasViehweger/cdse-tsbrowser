import { describe, it, expect } from 'vitest'
import { buildUplotData } from './chartData'

describe('buildUplotData', () => {
  it('returns two empty arrays for empty input', () => {
    const [xs, ys] = buildUplotData([])
    expect(xs).toEqual([])
    expect(ys).toEqual([])
  })

  it('produces x values as Unix timestamps in seconds (not milliseconds)', () => {
    const [xs] = buildUplotData([{ date: '2025-12-11', value: 0.5 }])
    // 2025-12-11T00:00:00Z in ms is 1765324800000, so in seconds: 1765324800
    expect(xs[0]).toBe(Date.parse('2025-12-11') / 1000)
    // Sanity-check: value is in seconds range (< 2e9), not milliseconds range (> 1e12)
    expect(xs[0]).toBeLessThan(2e9)
  })

  it('preserves null values in the y array', () => {
    const [, ys] = buildUplotData([
      { date: '2020-07-13', value: 0.7 },
      { date: '2020-07-14', value: null },
      { date: '2020-07-15', value: 0.65 },
    ])
    expect(ys[0]).toBeCloseTo(0.7)
    expect(ys[1]).toBeNull()
    expect(ys[2]).toBeCloseTo(0.65)
  })

  it('x and y arrays have equal length', () => {
    const points = [
      { date: '2025-12-11', value: 0.62 },
      { date: '2025-12-16', value: 0.58 },
      { date: '2025-12-21', value: null },
    ]
    const [xs, ys] = buildUplotData(points)
    expect(xs).toHaveLength(points.length)
    expect(ys).toHaveLength(points.length)
  })

  it('x array is sorted ascending when given sorted input', () => {
    const points = [
      { date: '2025-12-11', value: 0.62 },
      { date: '2025-12-16', value: 0.58 },
      { date: '2025-12-21', value: 0.55 },
    ]
    const [xs] = buildUplotData(points)
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1])
    }
  })
})
