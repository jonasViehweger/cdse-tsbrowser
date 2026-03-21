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
