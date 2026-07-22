import type { TimeSeriesPoint } from '../types/api'
import type uPlot from 'uplot'

/**
 * Convert an array of TimeSeriesPoints into uPlot's columnar data format.
 * uPlot requires [xArray, yArray] where x values are Unix timestamps in seconds.
 * null values in y are preserved (uPlot renders them as gaps in the line).
 */
export function buildUplotData(points: TimeSeriesPoint[]): uPlot.AlignedData {
  if (points.length === 0) return [[], []]
  const xs = points.map(p => Date.parse(p.date) / 1000)
  const ys = points.map(p => p.value)
  return [xs, ys] as uPlot.AlignedData
}

/** Linear-interpolated quantile of an ascending-sorted array. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Fraction of the range added as headroom above and below. */
const PADDING = 0.1
/** Tukey fence multiplier — 1.5×IQR is the conventional outlier cutoff. */
const FENCE_K = 1.5
/** Range floor, so a near-constant series doesn't collapse to a hairline axis. */
const MIN_SPAN = 1e-6

/**
 * Derive a y-range from the bulk of the data rather than its extremes, so that
 * a few badly cloud/snow-masked acquisitions don't squash the natural signal.
 *
 * Points outside the Tukey fences (Q1/Q3 ± 1.5×IQR) are ignored and the range
 * is taken from what remains, then padded. Two useful consequences: a series
 * with no outliers yields the same window as plain autoscale, and the fences
 * tolerate contamination up to ~25% of acquisitions — a fixed high percentile
 * would still be sitting inside the outlier cluster.
 *
 * Returns null when there is nothing to scale to, letting the caller fall back
 * to uPlot's own autoscale.
 */
export function computeRobustRange(points: TimeSeriesPoint[]): [number, number] | null {
  const values = points
    .map(p => p.value)
    .filter((v): v is number => v != null && Number.isFinite(v))
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1

  // Inliers are contiguous in a sorted array, so the first and last survivors
  // are the range. Fall back to the full extent if the fences reject everything.
  const inliers = sorted.filter(v => v >= q1 - FENCE_K * iqr && v <= q3 + FENCE_K * iqr)
  const lo = inliers.length > 0 ? inliers[0] : sorted[0]
  const hi = inliers.length > 0 ? inliers[inliers.length - 1] : sorted[sorted.length - 1]

  const span = hi - lo
  if (span < MIN_SPAN) {
    // Constant (or single-point) series: centre it in an arbitrary but sane window.
    const half = Math.max(Math.abs(lo) * PADDING, MIN_SPAN)
    return [lo - half, hi + half]
  }

  return [lo - span * PADDING, hi + span * PADDING]
}
