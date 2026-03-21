import { ref, computed } from 'vue'
import { DATA_SOURCES, getDataSource } from '../../config/datasources'
import type { DataSource } from '../../types/datasource'

export interface TimeSeriesConfig {
  dataSourceId: string
  maskClouds: boolean
  yMin: number | null
  yMax: number | null
}

export function useTimeSeriesConfig(initial: Partial<TimeSeriesConfig> = {}) {
  const dataSourceId = ref(initial.dataSourceId ?? DATA_SOURCES[0].id)
  const maskClouds = ref(initial.maskClouds ?? true)
  const yMin = ref<number | null>(initial.yMin ?? null)
  const yMax = ref<number | null>(initial.yMax ?? null)

  const dataSource = computed<DataSource | undefined>(() => getDataSource(dataSourceId.value))

  return {
    dataSourceId,
    maskClouds,
    yMin,
    yMax,
    dataSource,
    allDataSources: DATA_SOURCES,
  }
}
