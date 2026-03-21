import type { RawBands } from '../types/api'
import type { DataSource } from '../types/datasource'

function normDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  const denom = a + b
  if (denom === 0) return null
  return (a - b) / denom
}

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'S2_NDVI',
    name: 'S2 NDVI',
    collection: 'sentinel-2-l2a',
    compute: (b: RawBands) => normDiff(b.B08, b.B04),
    unit: 'NDVI',
    yMin: -1,
    yMax: 1,
  },
  {
    id: 'S2_NDMI',
    name: 'S2 NDMI',
    collection: 'sentinel-2-l2a',
    compute: (b: RawBands) => normDiff(b.B08, b.B11),
    unit: 'NDMI',
    yMin: -1,
    yMax: 1,
  },
]

export function getDataSource(id: string): DataSource | undefined {
  return DATA_SOURCES.find(ds => ds.id === id)
}
