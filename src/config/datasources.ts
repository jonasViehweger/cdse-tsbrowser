import type { BandName, RawBands } from '../types/api'
import type { DataSource } from '../types/datasource'

function normDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  const denom = a + b
  if (denom === 0) return null
  return (a - b) / denom
}

/** Weighted sum of bands; null if any band is null, since null would count as 0. */
function weightedSum(b: RawBands, weights: Partial<Record<BandName, number>>): number | null {
  let sum = 0
  for (const [band, weight] of Object.entries(weights) as [BandName, number][]) {
    const value = b[band]
    if (value === null) return null
    sum += weight * value
  }
  return sum
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'S2_NDVI',
    name: 'S2 NDVI',
    collection: 'sentinel-2-l2a',
    bands: ['B08', 'B04'],
    compute: (b: RawBands) => normDiff(b.B08, b.B04),
    unit: 'NDVI',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_NDMI',
    name: 'S2 NDMI',
    collection: 'sentinel-2-l2a',
    bands: ['B08', 'B11'],
    compute: (b: RawBands) => normDiff(b.B08, b.B11),
    unit: 'NDMI',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_TCW',
    name: 'S2 Tasseled Cap Wetness',
    collection: 'sentinel-2-l2a',
    bands: ['B02', 'B03', 'B04', 'B08', 'B11', 'B12'],
    compute: (b: RawBands) =>
      weightedSum(b, { B02: 0.0315, B03: 0.2021, B04: 0.3102, B08: 0.1594, B11: -0.6806, B12: -0.6109 }),
    unit: 'TCW',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B02',
    name: 'S2 B02 (Blue)',
    collection: 'sentinel-2-l2a',
    bands: ['B02'],
    compute: (b: RawBands) => (b.B02),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B03',
    name: 'S2 B03 (Green)',
    collection: 'sentinel-2-l2a',
    bands: ['B03'],
    compute: (b: RawBands) => (b.B03),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B04',
    name: 'S2 B04 (Red)',
    collection: 'sentinel-2-l2a',
    bands: ['B04'],
    compute: (b: RawBands) => (b.B04),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B05',
    name: 'S2 B05 (Red Edge)',
    collection: 'sentinel-2-l2a',
    bands: ['B05'],
    compute: (b: RawBands) => (b.B05),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B06',
    name: 'S2 B06 (Red Edge)',
    collection: 'sentinel-2-l2a',
    bands: ['B06'],
    compute: (b: RawBands) => (b.B06),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B07',
    name: 'S2 B07 (Red Edge)',
    collection: 'sentinel-2-l2a',
    bands: ['B07'],
    compute: (b: RawBands) => (b.B07),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B08',
    name: 'S2 B08 (NIR)',
    collection: 'sentinel-2-l2a',
    bands: ['B08'],
    compute: (b: RawBands) => (b.B08),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B8A',
    name: 'S2 B8A (Red Edge)',
    collection: 'sentinel-2-l2a',
    bands: ['B8A'],
    compute: (b: RawBands) => (b.B8A),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B11',
    name: 'S2 B11 (SWIR)',
    collection: 'sentinel-2-l2a',
    bands: ['B11'],
    compute: (b: RawBands) => (b.B11),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_B12',
    name: 'S2 B12 (SWIR)',
    collection: 'sentinel-2-l2a',
    bands: ['B12'],
    compute: (b: RawBands) => (b.B12),
    unit: 'reflectance',
    yMin: -1,
    yMax: 1,
  },
]

export function getDataSource(id: string): DataSource | undefined {
  return DATA_SOURCES.find(ds => ds.id === id)
}
