import { ref, computed, watch, type Ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { fetchBandTimeSeries } from '../services/bandCache'
import type { BandTimeSeries, TimeSeriesPoint } from '../types/api'
import type { DataSource } from '../types/datasource'

const MOCK = import.meta.env.VITE_MOCK === 'true'

export interface UseTimeSeriesReturn {
  data: Readonly<Ref<TimeSeriesPoint[]>>
  loading: Ref<boolean>
  error: Ref<string | null>
  refetch: () => void
}

// ---------------------------------------------------------------------------
// Mock helpers — generate synthetic band data for development
// ---------------------------------------------------------------------------

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(Date.UTC(d.getUTCFullYear(), 0, 0)).getTime()) / 86_400_000)
}

function generateMockBandData(startDate: string, endDate: string): BandTimeSeries {
  const result: BandTimeSeries = {}
  const d = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')

  while (d <= end) {
    const date = d.toISOString().slice(0, 10)
    const t = (dayOfYear(d) / 365) * 2 * Math.PI
    const ndvi = Math.max(0.05, Math.min(0.9, 0.5 + 0.35 * Math.sin(t - Math.PI / 3)))
    const B08 = 0.35
    const B04 = B08 * ((1 - ndvi) / (1 + ndvi))
    const ndmi = -0.05 + 0.2 * Math.sin(t - Math.PI / 3)
    const B11 = B08 * ((1 - ndmi) / (1 + ndmi))
    result[date] = { B02: 0.05, B03: 0.07, B04, B05: 0.12, B06: 0.18, B07: 0.28, B08, B8A: 0.32, B11, B12: 0.08, SCL: 4 }
    d.setUTCDate(d.getUTCDate() + 5)
  }

  return result
}

// ---------------------------------------------------------------------------

export function useTimeSeries(
  dataSource: Ref<DataSource | undefined>,
  maskClouds: Ref<boolean>,
): UseTimeSeriesReturn {
  const appStore = useAppStore()
  const authStore = useAuthStore()
  const bandData = ref<BandTimeSeries | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // SCL classes considered valid (cloud-free): 2=dark area, 4=vegetation,
  // 5=not-vegetated, 6=water
  const VALID_SCL = new Set([2, 4, 5, 6])

  // Recomputes automatically when bandData, dataSource, or maskClouds changes —
  // no network round-trip needed when toggling cloud masking or switching index.
  const data = computed<TimeSeriesPoint[]>(() => {
    const ds = dataSource.value
    const bands = bandData.value
    if (!ds || !bands) return []
    return Object.entries(bands)
      .map(([date, b]) => {
        if (maskClouds.value && b.SCL !== null && !VALID_SCL.has(Math.round(b.SCL))) {
          return { date, value: null }
        }
        return { date, value: ds.compute(b) }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function doFetch(force: boolean) {
    const ds = dataSource.value
    if (!ds) return

    const [lon, lat] = appStore.coordinate
    const startDate = appStore.startDate
    const endDate = appStore.endDate

    loading.value = true
    error.value = null

    try {
      if (MOCK) {
        bandData.value = generateMockBandData(startDate, endDate)
      } else {
        bandData.value = await fetchBandTimeSeries(lon, lat, startDate, endDate, ds.collection, force)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      bandData.value = null
    } finally {
      loading.value = false
    }
  }

  function scheduleFetch(force = false) {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      doFetch(force)
    }, 400)
  }

  // Re-fetch bands when location or dates change.
  // maskClouds and dataSource changes are handled by the computed above.
  watch(
    [() => appStore.coordinate, () => appStore.startDate, () => appStore.endDate],
    () => {
      // Clear stale data immediately so the chart doesn't show a previous
      // location's series while the new fetch is in flight.
      bandData.value = null
      loading.value = true
      scheduleFetch(false)
    },
    { immediate: true, deep: true },
  )

  // Auto-fetch when the user authenticates (token transitions from absent to present).
  watch(
    () => authStore.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (authenticated && !wasAuthenticated) scheduleFetch(true)
    },
  )

  return { data, loading, error, refetch: () => scheduleFetch(true) }
}
