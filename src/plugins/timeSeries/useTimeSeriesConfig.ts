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

export interface TimeSeriesConfig {
  dataSourceId: string
  maskClouds: boolean
  yMode: YMode
  yMin: number | null
  yMax: number | null
}

export function useTimeSeriesConfig(initial: Partial<TimeSeriesConfig> = {}) {
  const dataSourceId = ref(initial.dataSourceId ?? DATA_SOURCES[0].id)
  const maskClouds = ref(initial.maskClouds ?? true)
  const yMode = ref<YMode>(initial.yMode ?? 'robust')
  const yMin = ref<number | null>(initial.yMin ?? null)
  const yMax = ref<number | null>(initial.yMax ?? null)

  const dataSource = computed<DataSource | undefined>(() => getDataSource(dataSourceId.value))

  return {
    dataSourceId,
    maskClouds,
    yMode,
    yMin,
    yMax,
    dataSource,
    allDataSources: DATA_SOURCES,
  }
}
