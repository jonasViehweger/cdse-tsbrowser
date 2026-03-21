export interface RawBands {
  B02: number | null
  B03: number | null
  B04: number | null
  B05: number | null
  B06: number | null
  B07: number | null
  B08: number | null
  B8A: number | null
  B11: number | null
  B12: number | null
  SCL: number | null
}

export type BandTimeSeries = Record<string, RawBands> // date → bands

export interface TimeSeriesPoint {
  date: string // ISO date string, e.g. "2020-07-13"
  value: number | null
}
