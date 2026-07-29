import { ref, computed } from 'vue'
import { DATA_SOURCES, getDataSource } from '../../config/datasources'
import type { DataSource } from '../../types/datasource'

/**
 * How the y-axis range is chosen:
 * - `robust` — derived from the data with outliers fenced off (see computeRobustRange)
 * - `auto`   — uPlot's own min/max autoscale
 * - `manual` — fixed to yMin/yMax
 */
export type YMode = 'robust' | 'auto' | 'manual'

export const Y_MODES: { value: YMode; label: string }[] = [
  { value: 'robust', label: 'Robust (ignore outliers)' },
  { value: 'auto', label: 'Auto (fit all data)' },
  { value: 'manual', label: 'Manual' },
]

/** Sentinel-2 L2A scene classification (SCL) classes, in band-value order. */
export const SCL_CLASSES: { value: number; label: string }[] = [
  { value: 0, label: 'No data' },
  { value: 1, label: 'Saturated / defective' },
  { value: 2, label: 'Dark area pixels' },
  { value: 3, label: 'Cloud shadows' },
  { value: 4, label: 'Vegetation' },
  { value: 5, label: 'Not vegetated' },
  { value: 6, label: 'Water' },
  { value: 7, label: 'Unclassified' },
  { value: 8, label: 'Cloud (medium probability)' },
  { value: 9, label: 'Cloud (high probability)' },
  { value: 10, label: 'Thin cirrus' },
  { value: 11, label: 'Snow / ice' },
]

/** Classes kept by default when cloud masking is on. */
export const DEFAULT_VALID_SCL = [2, 4, 5, 6]

export interface TimeSeriesConfig {
  dataSourceId: string
  maskClouds: boolean
  /** SCL classes treated as valid observations when maskClouds is on. */
  validSclClasses: number[]
  yMode: YMode
  yMin: number | null
  yMax: number | null
}

export function useTimeSeriesConfig(initial: Partial<TimeSeriesConfig> = {}) {
  const dataSourceId = ref(initial.dataSourceId ?? DATA_SOURCES[0].id)
  const maskClouds = ref(initial.maskClouds ?? true)
  const validSclClasses = ref<number[]>(initial.validSclClasses ?? [...DEFAULT_VALID_SCL])
  const yMode = ref<YMode>(initial.yMode ?? 'robust')
  const yMin = ref<number | null>(initial.yMin ?? null)
  const yMax = ref<number | null>(initial.yMax ?? null)

  const dataSource = computed<DataSource | undefined>(() => getDataSource(dataSourceId.value))

  return {
    dataSourceId,
    maskClouds,
    validSclClasses,
    yMode,
    yMin,
    yMax,
    dataSource,
    allDataSources: DATA_SOURCES,
  }
}
