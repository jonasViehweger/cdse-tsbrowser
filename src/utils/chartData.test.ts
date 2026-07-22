import { describe, it, expect } from 'vitest'
import { buildUplotData, computeRobustRange } from './chartData'
import type { TimeSeriesPoint } from '../types/api'

/** Build points from bare values; dates are irrelevant to y-scaling. */
function pts(values: (number | null)[]): TimeSeriesPoint[] {
  return values.map((value, i) => ({
    date: `2025-01-${String(i + 1).padStart(2, '0')}`,
    value,
  }))
}

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

describe('computeRobustRange', () => {
  it('returns null when there are no finite values', () => {
    expect(computeRobustRange([])).toBeNull()
    expect(computeRobustRange(pts([null, null]))).toBeNull()
    expect(computeRobustRange(pts([NaN]))).toBeNull()
  })

  it('ignores unmasked TCW outliers that would otherwise squash the axis', () => {
    // 40 acquisitions of natural variability in -0.1..0.1, plus 4 bad ones at -0.3..-0.5.
    const natural = Array.from({ length: 40 }, (_, i) => -0.1 + (0.2 * i) / 39)
    const range = computeRobustRange(pts([...natural, -0.3, -0.38, -0.45, -0.5]))!

    // Window tracks the natural signal, not the outliers.
    expect(range[0]).toBeGreaterThan(-0.15)
    expect(range[1]).toBeLessThan(0.15)
    // The signal itself still fits inside it.
    expect(range[0]).toBeLessThanOrEqual(-0.1)
    expect(range[1]).toBeGreaterThanOrEqual(0.1)
  })

  it('tolerates contamination well beyond a 2nd-percentile cutoff', () => {
    // 10% of acquisitions bad — a fixed 2/98 percentile would still land in the cluster.
    const natural = Array.from({ length: 45 }, (_, i) => -0.1 + (0.2 * i) / 44)
    const outliers = Array.from({ length: 5 }, () => -0.4)
    const range = computeRobustRange(pts([...natural, ...outliers]))!
    expect(range[0]).toBeGreaterThan(-0.15)
  })

  it('keeps the full extent when the data has no outliers', () => {
    const values = Array.from({ length: 20 }, (_, i) => i / 19)
    const [lo, hi] = computeRobustRange(pts(values))!
    // Degrades to padded autoscale: nothing is clipped.
    expect(lo).toBeLessThanOrEqual(0)
    expect(hi).toBeGreaterThanOrEqual(1)
    expect(lo).toBeCloseTo(-0.1)
    expect(hi).toBeCloseTo(1.1)
  })

  it('skips nulls without treating them as zero', () => {
    const [lo] = computeRobustRange(pts([0.5, null, 0.6, null, 0.55]))!
    expect(lo).toBeGreaterThan(0.4)
  })

  it('returns a non-degenerate window for a constant series', () => {
    const [lo, hi] = computeRobustRange(pts([0.3, 0.3, 0.3]))!
    expect(hi).toBeGreaterThan(lo)
  })

  it('returns a non-degenerate window for a single point', () => {
    const [lo, hi] = computeRobustRange(pts([0.42]))!
    expect(hi).toBeGreaterThan(lo)
    expect(lo).toBeLessThanOrEqual(0.42)
    expect(hi).toBeGreaterThanOrEqual(0.42)
  })

  it('returns a non-degenerate window for an all-zero series', () => {
    const [lo, hi] = computeRobustRange(pts([0, 0, 0]))!
    expect(hi).toBeGreaterThan(lo)
  })

  it('always produces lo < hi and contains the median', () => {
    const [lo, hi] = computeRobustRange(pts([-0.5, -0.02, 0, 0.01, 0.03, 0.9]))!
    expect(lo).toBeLessThan(hi)
    expect(lo).toBeLessThan(0.005)
    expect(hi).toBeGreaterThan(0.005)
  })
})
