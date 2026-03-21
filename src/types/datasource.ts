import type { RawBands } from './api'

export interface DataSource {
  id: string
  name: string
  collection: string
  /** Compute the display index from raw per-date band means. Return null for no-data. */
  compute: (bands: RawBands) => number | null
  unit: string
  yMin: number
  yMax: number
}
