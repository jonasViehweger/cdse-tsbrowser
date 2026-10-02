import { ref, computed, watch, reactive, onScopeDispose, type Ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { fetchBandTimeSeries, prefetchBandTimeSeries, type PrefetchNeed, type PrefetchTarget } from '../services/bandCache'
import { BAND_NAMES, isRetriableError } from '../services/statisticalApi'
import type { BandName, BandTimeSeries, TimeSeriesPoint } from '../types/api'
import type { DataSource } from '../types/datasource'

const MOCK = import.meta.env.VITE_MOCK === 'true'

export interface UseTimeSeriesReturn {
  data: Readonly<Ref<TimeSeriesPoint[]>>
  loading: Ref<boolean>
  error: Ref<string | null>
  /** Whether the current error is transient (e.g. rate limiting), so retrying may help. */
  canRetry: Ref<boolean>
  /** Try again, fetching only what isn't cached yet. */
  retry: () => void
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
// Prefetching — loads what the open panels will need at upcoming locations
// ---------------------------------------------------------------------------

/** What each mounted time series wants, so a prefetch fetches the same. */
const panelNeeds = reactive(new Map<symbol, PrefetchNeed>())

/** Bands per collection across all panels, so each location takes one request per chunk. */
function combinedNeeds(): PrefetchNeed[] {
  const byCollection = new Map<string, Set<BandName>>()
  for (const { collection, bands } of panelNeeds.values()) {
    const set = byCollection.get(collection) ?? new Set()
    bands.forEach(b => set.add(b))
    byCollection.set(collection, set)
  }
  return [...byCollection].map(([collection, bands]) => ({ collection, bands: [...bands] }))
}

/**
 * Keep the cache filled for `targets`, in order, with what the open time series
 * panels need over the current date range. Runs again whenever any of those change.
 */
export function usePrefetchTimeSeries(targets: Ref<PrefetchTarget[]>) {
  const appStore = useAppStore()
  const authStore = useAuthStore()

  watch(
    () => JSON.stringify([targets.value, appStore.startDate, appStore.endDate, combinedNeeds(), authStore.isAuthenticated]),
    () => {
      // Without a token every request would fail; the next change after login retries.
      if (MOCK || !authStore.isAuthenticated) return
      void prefetchBandTimeSeries(targets.value, appStore.startDate, appStore.endDate, combinedNeeds())
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    void prefetchBandTimeSeries([], '', '', [])
  })
}

// ---------------------------------------------------------------------------

export function useTimeSeries(
  dataSource: Ref<DataSource | undefined>,
  maskClouds: Ref<boolean>,
  validSclClasses: Ref<number[]>,
): UseTimeSeriesReturn {
  const appStore = useAppStore()
  const authStore = useAuthStore()
  const bandData = ref<BandTimeSeries | null>(null)
  /** Bands present in bandData; the others are null. */
  const loadedBands = ref<readonly BandName[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const canRetry = ref(false)

  // Only the bands the index needs (plus SCL for masking) are fetched.
  const requiredBands = computed<BandName[]>(() => {
    const ds = dataSource.value
    if (!ds) return []
    return maskClouds.value && !ds.bands.includes('SCL') ? [...ds.bands, 'SCL'] : ds.bands
  })
  const needKey = Symbol('timeSeries')
  watch(
    [() => dataSource.value?.collection, requiredBands],
    ([collection, bands]) => {
      if (collection) panelNeeds.set(needKey, { collection, bands })
      else panelNeeds.delete(needKey)
    },
    { immediate: true },
  )
  onScopeDispose(() => panelNeeds.delete(needKey))

  const hasRequiredBands = () => requiredBands.value.every(b => loadedBands.value.includes(b))

  // Recomputes automatically when bandData, dataSource, maskClouds or the valid
  // SCL classes change. Switching index or enabling masking only needs a fetch
  // when it requires bands not loaded yet.
  const data = computed<TimeSeriesPoint[]>(() => {
    const ds = dataSource.value
    const bands = bandData.value
    if (!ds || !bands || !hasRequiredBands()) return []
    const validScl = new Set(validSclClasses.value)
    return Object.entries(bands)
      .map(([date, b]) => {
        if (maskClouds.value && b.SCL !== null && !validScl.has(Math.round(b.SCL))) {
          return { date, value: null }
        }
        return { date, value: ds.compute(b) }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  // Only the latest fetch may write its result; earlier ones are superseded.
  let fetchId = 0

  async function doFetch(force: boolean) {
    const ds = dataSource.value
    if (!ds) return

    const [lon, lat] = appStore.coordinate
    const startDate = appStore.startDate
    const endDate = appStore.endDate
    const bands = requiredBands.value
    const id = ++fetchId

    loading.value = true
    error.value = null
    canRetry.value = false

    try {
      const result = MOCK
        ? generateMockBandData(startDate, endDate)
        : await fetchBandTimeSeries(lon, lat, startDate, endDate, ds.collection, bands, force)
      if (id !== fetchId) return
      bandData.value = result
      loadedBands.value = MOCK ? BAND_NAMES : bands
    } catch (e) {
      if (id !== fetchId) return
      error.value = e instanceof Error ? e.message : String(e)
      canRetry.value = isRetriableError(e)
      bandData.value = null
      loadedBands.value = []
    } finally {
      if (id === fetchId) loading.value = false
    }
  }

  function scheduleFetch(force = false) {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      doFetch(force)
    }, 400)
  }

  // Fetch newly required bands right away when switching index or enabling
  // masking. Bands already cached come back without a request. A pending
  // debounced fetch picks up the new bands itself.
  watch(
    () => requiredBands.value.join(),
    () => {
      if (debounceTimer === null && !hasRequiredBands()) doFetch(false)
    },
  )

  // Re-fetch bands when location or dates change.
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
  // Not forced: fetches without a token fail before anything is cached, so
  // whatever is cached is still valid.
  watch(
    () => authStore.isAuthenticated,
    (authenticated, wasAuthenticated) => {
      if (authenticated && !wasAuthenticated) scheduleFetch(false)
    },
  )

  return { data, loading, error, canRetry, retry: () => doFetch(false), refetch: () => scheduleFetch(true) }
}
