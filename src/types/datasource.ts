import type { BandName, RawBands } from './api'

export interface DataSource {
  id: string
  name: string
  collection: string
  /** Raw bands `compute` reads. Only these are requested, since PUs scale with input bands. */
  bands: BandName[]
  /** Compute the display index from raw per-date band means. Return null for no-data. */
  compute: (bands: RawBands) => number | null
  unit: string
  yMin: number
  yMax: number
}
