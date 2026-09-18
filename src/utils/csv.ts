import type { TimeSeriesPoint } from '../types/api'

/** Quote a field only when it could otherwise break the row. */
function escapeField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Serialise the plotted series to CSV — one row per acquisition, in the order
 * the chart shows them. Acquisitions without a value (masked out, or the index
 * is undefined there) are omitted: the export mirrors what is actually drawn.
 */
export function buildTimeSeriesCsv(points: TimeSeriesPoint[], valueColumn: string): string {
  const rows = points
    .filter(p => p.value != null)
    .map(p => [p.date, String(p.value)].map(escapeField).join(','))

  // Trailing newline: POSIX-style, and keeps the last row intact for tools
  // that require line-terminated records.
  return [['date', valueColumn].map(escapeField).join(','), ...rows].join('\n') + '\n'
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadCsv(filename: string, content: string): void {
  // The BOM makes Excel read the file as UTF-8 rather than the local codepage.
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Filesystem-safe filename, e.g. `S2_NDVI_11.1464_48.9207_2020-01-01_2025-01-01.csv`. */
export function timeSeriesCsvFilename(
  sourceName: string,
  [lon, lat]: [number, number],
  startDate: string,
  endDate: string,
): string {
  const slug = sourceName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${slug}_${lon.toFixed(4)}_${lat.toFixed(4)}_${startDate}_${endDate}.csv`
}
