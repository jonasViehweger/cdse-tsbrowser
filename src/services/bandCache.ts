import type { BandName, BandTimeSeries, RawBands } from '../types/api'
import { BAND_NAMES, fetchRawBands, type PartialBandSeries } from './statisticalApi'
import type { Priority } from './requestScheduler'

const CHUNK_PREFIX = 'cdse-bandchunk-'
/** Pre-chunking cache: one entry per exact date range, holding all bands. */
const LEGACY_PREFIX = 'cdse-bands-'

/**
 * Acquisitions from the last few days may still be processing, so a fetch
 * covering them only counts for RECENT_TTL_MS before those days are refetched.
 */
const RECENT_DAYS = 3
const RECENT_TTL_MS = 6 * 60 * 60 * 1000

/** Requests arriving within this window share one fetch (e.g. panels loading together). */
const BATCH_WINDOW_MS = 20

type DateRange = [from: string, to: string]

interface BandChunk {
  /** Date ranges this band was fetched for. A date inside them without a value had no observation. */
  ranges: DateRange[]
  /** Ranges within RECENT_DAYS of the fetch, valid only until RECENT_TTL_MS after `fetchedAt`. */
  recent?: { ranges: DateRange[]; fetchedAt: number }
  /** date → value, only for dates with data. */
  values: Record<string, number>
}

/** One calendar half-year of one location, stored as a single localStorage entry. */
type ChunkEntry = Partial<Record<BandName, BandChunk>>

interface Chunk {
  key: string
  /** Chunk boundaries clipped to the requested range. */
  from: string
  to: string
}

interface FetchJob {
  from: string
  to: string
  bands: BandName[]
}

// ── Dates and ranges ────────────────────────────────────────────────────────

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Last date considered complete; later dates may still gain acquisitions. */
function stableUntil(): string {
  return addDays(new Date().toISOString().slice(0, 10), -RECENT_DAYS)
}

function subtractRanges(base: DateRange[], cut: DateRange[]): DateRange[] {
  let result = base
  for (const [cutFrom, cutTo] of cut) {
    result = result.flatMap(([from, to]): DateRange[] => {
      if (cutTo < from || cutFrom > to) return [[from, to]]
      const rest: DateRange[] = []
      if (cutFrom > from) rest.push([from, addDays(cutFrom, -1)])
      if (cutTo < to) rest.push([addDays(cutTo, 1), to])
      return rest
    })
  }
  return result
}

function mergeRanges(ranges: DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]))
  const merged: DateRange[] = []
  for (const [from, to] of sorted) {
    const last = merged[merged.length - 1]
    if (last && from <= addDays(last[1], 1)) {
      if (to > last[1]) last[1] = to
    } else {
      merged.push([from, to])
    }
  }
  return merged
}

function rangesUntil(ranges: DateRange[], until: string): DateRange[] {
  return ranges.filter(([from]) => from <= until).map(([from, to]) => [from, to < until ? to : until])
}

function rangesAfter(ranges: DateRange[], after: string): DateRange[] {
  const first = addDays(after, 1)
  return ranges.filter(([, to]) => to >= first).map(([from, to]) => [from > first ? from : first, to])
}

// ── Storage ─────────────────────────────────────────────────────────────────

function locationKey(collection: string, lon: number, lat: number): string {
  return `${collection}_${lon}_${lat}`
}

/**
 * Fixed calendar half-years overlapping the range, so extending the range only
 * touches the chunks at its ends.
 */
function halfYearChunks(location: string, startDate: string, endDate: string): Chunk[] {
  const chunks: Chunk[] = []
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    for (const [half, from, to] of [['H1', `${year}-01-01`, `${year}-06-30`], ['H2', `${year}-07-01`, `${year}-12-31`]]) {
      if (to < startDate || from > endDate) continue
      chunks.push({
        key: `${CHUNK_PREFIX}${location}_${year}${half}`,
        from: from < startDate ? startDate : from,
        to: to > endDate ? endDate : to,
      })
    }
  }
  return chunks
}

// localStorage is the persistent copy; this map saves re-parsing it and keeps
// the cache working when storage is full or unavailable.
const memory = new Map<string, ChunkEntry>()

function loadChunk(key: string): ChunkEntry {
  let entry = memory.get(key)
  if (!entry) {
    entry = {}
    try {
      const raw = localStorage.getItem(key)
      if (raw) entry = JSON.parse(raw) as ChunkEntry
    } catch {
      // Unreadable entry — start over for this chunk
    }
    memory.set(key, entry)
  }
  return entry
}

function saveChunk(key: string, entry: ChunkEntry) {
  memory.set(key, entry)
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // Ignore storage quota errors — cache is best-effort
  }
}

/**
 * Record a fetch of `bands` over [from, to]. Each fetch is stored as soon as it
 * completes, so a failure elsewhere doesn't discard it.
 */
function storeSeries(
  location: string,
  from: string,
  to: string,
  bands: readonly BandName[],
  series: PartialBandSeries,
  opts: { unresolvedDates?: string[]; fetchedAt?: number; stable?: string } = {},
) {
  const { unresolvedDates = [], fetchedAt = Date.now(), stable = stableUntil() } = opts
  for (const chunk of halfYearChunks(location, from, to)) {
    const entry = loadChunk(chunk.key)
    // Dates whose interval failed stay uncovered so the next load retries them.
    const covered = subtractRanges([[chunk.from, chunk.to]], unresolvedDates.map((d): DateRange => [d, d]))
    const recent = rangesAfter(covered, stable)

    for (const band of bands) {
      const bandChunk = (entry[band] ??= { ranges: [], values: {} })
      for (const date of Object.keys(bandChunk.values)) {
        if (date >= chunk.from && date <= chunk.to) delete bandChunk.values[date]
      }
      for (const [date, values] of Object.entries(series)) {
        const value = values[band]
        if (date >= chunk.from && date <= chunk.to && value != null) bandChunk.values[date] = value
      }
      bandChunk.ranges = mergeRanges([...bandChunk.ranges, ...rangesUntil(covered, stable)])
      if (recent.length) bandChunk.recent = { ranges: recent, fetchedAt }
    }
    saveChunk(chunk.key, entry)
  }
}

let legacyMigrated = false

/** Move entries from the pre-chunking cache into chunks, so they aren't fetched again. */
function migrateLegacyCache() {
  if (legacyMigrated) return
  legacyMigrated = true
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LEGACY_PREFIX)) keys.push(key)
    }
    for (const key of keys) {
      // cdse-bands-{lon}_{lat}_{start}_{end}_{collection}
      const [lon, lat, start, end, collection] = key.slice(LEGACY_PREFIX.length).split('_')
      try {
        const series = JSON.parse(localStorage.getItem(key) ?? '{}') as PartialBandSeries
        // The end date was usually the fetch date, so its last days count as recent.
        const endStable = addDays(end, -RECENT_DAYS)
        const now = stableUntil()
        storeSeries(locationKey(collection, Number(lon), Number(lat)), start, end, BAND_NAMES, series, {
          fetchedAt: 0,
          stable: endStable < now ? endStable : now,
        })
      } catch {
        // Unreadable entry — drop it
      }
      localStorage.removeItem(key)
    }
  } catch {
    // localStorage unavailable
  }
}

// ── Fetching ────────────────────────────────────────────────────────────────

/** Requests needed to fill the cache for these bands and dates. */
function planFetches(
  location: string,
  startDate: string,
  endDate: string,
  bands: readonly BandName[],
  force: boolean,
): FetchJob[] {
  const jobs: FetchJob[] = []
  for (const chunk of halfYearChunks(location, startDate, endDate)) {
    const entry = loadChunk(chunk.key)
    // Bands missing the same dates share one request.
    const groups = new Map<string, FetchJob[]>()
    for (const band of bands) {
      const bandChunk = entry[band]
      let covered = force ? [] : bandChunk?.ranges ?? []
      const recent = bandChunk?.recent
      if (!force && recent && Date.now() - recent.fetchedAt < RECENT_TTL_MS) covered = [...covered, ...recent.ranges]

      const missing = subtractRanges([[chunk.from, chunk.to]], covered)
      if (!missing.length) continue
      const key = JSON.stringify(missing)
      const group = groups.get(key)
      if (group) group.forEach(job => job.bands.push(band))
      else groups.set(key, missing.map(([from, to]) => ({ from, to, bands: [band] })))
    }
    for (const group of groups.values()) jobs.push(...group)
  }
  return jobs
}

/** Fetch one planned request and store what came back. */
async function runJob(lon: number, lat: number, collection: string, location: string, job: FetchJob, priority: Priority) {
  const { series, unresolved } = await fetchRawBands(lon, lat, job.from, job.to, collection, job.bands, priority)
  if (unresolved.length) {
    console.warn(
      `Statistical API: ${unresolved.length} interval(s) failed and could not be recovered; ` +
        `they will be retried on the next load. ${unresolved.map(f => `${f.date} (${f.type})`).join(', ')}`,
    )
  }
  storeSeries(location, job.from, job.to, job.bands, series, { unresolvedDates: unresolved.map(f => f.date) })
}

async function fillCache(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
  bands: readonly BandName[],
  force: boolean,
) {
  const location = locationKey(collection, lon, lat)
  const jobs = planFetches(location, startDate, endDate, bands, force)
  const results = await Promise.allSettled(jobs.map(job => runJob(lon, lat, collection, location, job, 'foreground')))
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failure) throw failure.reason
}

// Fills for one location run one after another: a fill queued behind another
// plans its requests only once the first has stored its results.
const locationQueues = new Map<string, Promise<unknown>>()

function queueForLocation<T>(location: string, task: () => Promise<T>): Promise<T> {
  const run = (locationQueues.get(location) ?? Promise.resolve()).catch(() => {}).then(task)
  locationQueues.set(location, run)
  run.catch(() => {}).finally(() => {
    if (locationQueues.get(location) === run) locationQueues.delete(location)
  })
  return run
}

interface Batch {
  bands: Set<BandName>
  force: boolean
  done: Promise<void>
}

const batches = new Map<string, Batch>()

/** Locations with a fill on the way that a prefetch must make way for, by number of fills. */
const foregroundPending = new Map<string, number>()

function trackForeground(location: string, done: Promise<void>) {
  foregroundPending.set(location, (foregroundPending.get(location) ?? 0) + 1)
  done.catch(() => {}).finally(() => {
    const count = foregroundPending.get(location)! - 1
    if (count) foregroundPending.set(location, count)
    else foregroundPending.delete(location)
  })
}

function requestFill(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
  bands: readonly BandName[],
  force: boolean,
): Promise<void> {
  const location = locationKey(collection, lon, lat)
  const key = `${location}|${startDate}|${endDate}`
  let batch = batches.get(key)
  if (!batch) {
    const created: Batch = { bands: new Set(), force: false, done: Promise.resolve() }
    created.done = new Promise(resolve => setTimeout(resolve, BATCH_WINDOW_MS)).then(() => {
      batches.delete(key)
      return queueForLocation(location, () =>
        fillCache(lon, lat, startDate, endDate, collection, [...created.bands], created.force),
      )
    })
    batches.set(key, created)
    trackForeground(location, created.done)
    batch = created
  }
  for (const band of bands) batch.bands.add(band)
  batch.force ||= force
  return batch.done
}

function assembleSeries(location: string, startDate: string, endDate: string, bands: readonly BandName[]): BandTimeSeries {
  const series: BandTimeSeries = {}
  for (const chunk of halfYearChunks(location, startDate, endDate)) {
    const entry = loadChunk(chunk.key)
    for (const band of bands) {
      for (const [date, value] of Object.entries(entry[band]?.values ?? {})) {
        if (date < chunk.from || date > chunk.to) continue
        series[date] ??= Object.fromEntries(BAND_NAMES.map(b => [b, null])) as unknown as RawBands
        series[date][band] = value
      }
    }
  }
  return series
}

/**
 * Fetch raw Sentinel-2 band time series for a location and date range.
 *
 * Cached per band and calendar half-year, so only bands and dates not fetched
 * before are requested. Bands not in `bands` are null in the result.
 *
 * @param force - Refetch the requested bands even if cached.
 */
export async function fetchBandTimeSeries(
  lon: number,
  lat: number,
  startDate: string,
  endDate: string,
  collection: string,
  bands: readonly BandName[],
  force = false,
): Promise<BandTimeSeries> {
  migrateLegacyCache()
  const location = locationKey(collection, lon, lat)
  if (force || planFetches(location, startDate, endDate, bands, false).length) {
    await requestFill(lon, lat, startDate, endDate, collection, bands, force)
  }
  return assembleSeries(location, startDate, endDate, bands)
}

// ── Prefetching ────────────────────────────────────────────────────────────

export interface PrefetchTarget {
  lon: number
  lat: number
}

export interface PrefetchNeed {
  collection: string
  bands: readonly BandName[]
}

/** Bumped by every prefetch call; a running prefetch stops once it is outdated. */
let prefetchGeneration = 0

/**
 * Fill the cache for locations the user is likely to open next, one request
 * at a time and at background priority, so it never competes with a load the
 * user is waiting for.
 *
 * Each call replaces the previous one: whatever it hadn't started is dropped.
 * A location that gets loaded for display meanwhile is left to that load.
 */
export function prefetchBandTimeSeries(
  targets: readonly PrefetchTarget[],
  startDate: string,
  endDate: string,
  needs: readonly PrefetchNeed[],
): Promise<void> {
  const generation = ++prefetchGeneration
  return runPrefetch(generation, targets, startDate, endDate, needs)
}

async function runPrefetch(
  generation: number,
  targets: readonly PrefetchTarget[],
  startDate: string,
  endDate: string,
  needs: readonly PrefetchNeed[],
) {
  migrateLegacyCache()
  const outdated = () => generation !== prefetchGeneration
  for (const { lon, lat } of targets) {
    for (const { collection, bands } of needs) {
      if (outdated()) return
      const location = locationKey(collection, lon, lat)
      if (!planFetches(location, startDate, endDate, bands, false).length) continue
      try {
        await queueForLocation(location, async () => {
          // Planned under the location's lock, so nothing else fills it meanwhile.
          for (const job of planFetches(location, startDate, endDate, bands, false)) {
            if (outdated() || foregroundPending.has(location)) return
            await runJob(lon, lat, collection, location, job, 'background')
          }
        })
      } catch (e) {
        // Whatever stopped this request would likely stop the next ones too.
        console.warn('Prefetch stopped:', e)
        return
      }
    }
  }
}
