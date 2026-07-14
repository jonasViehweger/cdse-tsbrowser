/**
 * Esri World Imagery Wayback API
 *
 * Algorithm based on:
 *   https://github.com/Esri/wayback-core/blob/main/src/change-detector/changeDetector.ts
 *
 * Tilemap URL convention: tilemap/{layerNumber}/{zoom}/{row}/{col}
 * Tile URL convention:    tile/{layerNumber}/{z}/{y}/{x}  (y=row, x=col)
 */

const WAYBACK_BASE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer'
const METADATA_BASE =
  'https://metadata.maptiles.arcgis.com/arcgis/rest/services'
const CAPABILITIES_URL = `${WAYBACK_BASE}/WMTS/1.0.0/WMTSCapabilities.xml`

/** Zoom level used for tilemap change-detection queries. */
const TILEMAP_ZOOM = 17

export interface WaybackLayer {
  layerNumber: number
  publishDate: string  // YYYY-MM-DD
  identifier: string   // used to build metadata service URL
}

export interface WaybackRelease extends WaybackLayer {
  /** Acquisition date (YYYY-MM-DD), or 'unknown' if Esri has none on record. */
  acquisitionDate: string
}

// ---------------------------------------------------------------------------
// Tile math
// ---------------------------------------------------------------------------

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom))
}

function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom),
  )
}

/** Leaflet-compatible XYZ tile URL template for a given Wayback layer. */
export function waybackTileUrl(layerNumber: number): string {
  // Actual URL pattern from WMTS capabilities ResourceURL template:
  // .../WMTS/1.0.0/{TileMatrixSet}/MapServer/tile/{layerNumber}/{TileMatrix}/{TileRow}/{TileCol}
  // Leaflet substitutes {z}=TileMatrix, {y}=TileRow, {x}=TileCol
  return `${WAYBACK_BASE}/WMTS/1.0.0/GoogleMapsCompatible/MapServer/tile/${layerNumber}/{z}/{y}/{x}`
}

// ---------------------------------------------------------------------------
// Response cache
//
// Keyed by request identity rather than by map location, because every Wayback
// request is an immutable fact: a tilemap answer for release R at tile z/r/c
// never changes, and neither does a release's acquisition date at a point.
//
// This means the cache needs no TTL and no invalidation. When Esri publishes a
// new release, the walk simply starts at a layer number whose tilemap key was
// never cached — that one request goes out, every older step still hits.
// ---------------------------------------------------------------------------

const CACHE_KEY = 'cdse-ts-wayback-cache'
const CACHE_VERSION = 1
const MAX_ENTRIES = 4000

/** Keys written by earlier cache designs, cleared once on first access. */
const LEGACY_KEYS = ['cdse-ts-wayback-points']
const LEGACY_PREFIX = 'cdse-ts-wayback-acq-'

interface CacheEntry {
  value: unknown
  /** Epoch ms; drives LRU eviction only. */
  used: number
}

interface Cache {
  v: number
  entries: Record<string, CacheEntry>
}

let cache: Cache | null = null
let flushHandle: ReturnType<typeof setTimeout> | null = null

function purgeLegacy(): void {
  for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(LEGACY_PREFIX)) localStorage.removeItem(key)
  }
}

function store(): Cache {
  if (cache) return cache

  purgeLegacy()

  const raw = localStorage.getItem(CACHE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Cache
      if (parsed.v === CACHE_VERSION && parsed.entries) {
        cache = parsed
        return cache
      }
    } catch { /* corrupt */ }
    localStorage.removeItem(CACHE_KEY)
  }

  cache = { v: CACHE_VERSION, entries: {} }
  return cache
}

/** Oldest-first by last use. */
function keysByAge(c: Cache): string[] {
  return Object.keys(c.entries).sort((a, b) => c.entries[a].used - c.entries[b].used)
}

function flush(): void {
  const c = store()

  const aged = keysByAge(c)
  for (const key of aged.slice(0, Math.max(0, aged.length - MAX_ENTRIES))) {
    delete c.entries[key]
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c))
  } catch {
    // Over quota: drop the oldest half and take one more run at it.
    const remaining = keysByAge(c)
    for (const key of remaining.slice(0, Math.ceil(remaining.length / 2))) {
      delete c.entries[key]
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c))
    } catch { /* give up — the cache is an optimisation, not a requirement */ }
  }
}

// A single walk touches dozens of keys; coalesce them into one serialisation.
function scheduleFlush(): void {
  if (flushHandle) return
  flushHandle = setTimeout(() => {
    flushHandle = null
    flush()
  }, 0)
}

function cacheGet<T>(key: string): T | undefined {
  const entry = store().entries[key]
  if (!entry) return undefined
  entry.used = Date.now()
  scheduleFlush()
  return entry.value as T
}

function cacheSet(key: string, value: unknown): void {
  store().entries[key] = { value, used: Date.now() }
  scheduleFlush()
}

// ---------------------------------------------------------------------------
// WMTS capabilities — cached in localStorage for 24 h
//
// The one request whose response *can* change, so this keeps its own TTL rather
// than living in the immutable response cache above.
// ---------------------------------------------------------------------------

const CAPABILITIES_CACHE_KEY = 'cdse-ts-wayback-caps'
const CAPABILITIES_TTL = 24 * 60 * 60 * 1000

// Bump this version when the parse format changes to invalidate old cached data.
const CAPABILITIES_CACHE_VERSION = 2
let layersCache: WaybackLayer[] | null = null

function parseCapabilities(xml: string): WaybackLayer[] {
  const layers: WaybackLayer[] = []
  const blocks = xml.match(/<Layer>[\s\S]*?<\/Layer>/g) ?? []

  for (const block of blocks) {
    // Title format: "World Imagery (Wayback 2026-02-26)"
    const titleMatch = block.match(/\(Wayback (\d{4}-\d{2}-\d{2})\)/)
    const idMatch = block.match(/<ows:Identifier>([\s\S]*?)<\/ows:Identifier>/)
    // ResourceURL template: ".../MapServer/tile/64001/{TileMatrix}/..."
    const templateMatch = block.match(/\/tile\/(\d+)\//)
    if (!titleMatch || !idMatch || !templateMatch) continue

    layers.push({
      layerNumber: parseInt(templateMatch[1]),
      publishDate: titleMatch[1],
      identifier: idMatch[1],
    })
  }

  return layers.sort((a, b) => b.publishDate.localeCompare(a.publishDate))
}

export async function getWaybackLayers(): Promise<WaybackLayer[]> {
  if (layersCache) return layersCache

  const cached = localStorage.getItem(CAPABILITIES_CACHE_KEY)
  if (cached) {
    try {
      const { ts, data, v } = JSON.parse(cached) as { ts: number; data: WaybackLayer[]; v?: number }
      if (v === CAPABILITIES_CACHE_VERSION && Date.now() - ts < CAPABILITIES_TTL) {
        layersCache = data
        return data
      }
    } catch {
      localStorage.removeItem(CAPABILITIES_CACHE_KEY)
    }
  }

  const res = await fetch(CAPABILITIES_URL)
  const xml = await res.text()
  const layers = parseCapabilities(xml)

  try {
    localStorage.setItem(CAPABILITIES_CACHE_KEY, JSON.stringify({ ts: Date.now(), v: CAPABILITIES_CACHE_VERSION, data: layers }))
  } catch { /* quota */ }

  layersCache = layers
  return layers
}

// ---------------------------------------------------------------------------
// Tilemap — does a release carry local changes at this tile?
// ---------------------------------------------------------------------------

/** What a tilemap response tells us, once stripped down to what we use. */
interface TilemapResult {
  /** Does any release at or before this one have imagery here? */
  changed: boolean
  /** Nearest release at or before the requested one that actually changed. */
  release: number
}

async function getTilemap(release: number, row: number, col: number): Promise<TilemapResult> {
  const key = `tilemap/${release}/${TILEMAP_ZOOM}/${row}/${col}`

  const hit = cacheGet<TilemapResult>(key)
  if (hit) return hit

  const res = await fetch(`${WAYBACK_BASE}/${key}`)
  if (!res.ok) throw new Error(`Tilemap request for release ${release} failed: ${res.status}`)

  const body = (await res.json()) as { data: number[]; select?: number[] }
  const result: TilemapResult = {
    changed: Boolean(body.data[0]),
    release: body.select?.[0] ?? release,
  }

  cacheSet(key, result)
  return result
}

// ---------------------------------------------------------------------------
// Acquisition date from Esri metadata service
// ---------------------------------------------------------------------------

/** 1980-01-01 in ms — Esri's sentinel SRC_DATE2 meaning "no date on record". */
const SRC_DATE_SENTINEL = 315532800000

/**
 * Acquisition date for a release at a point, or 'unknown'.
 *
 * Not every release has a matching metadata service, so a 4xx is a real answer
 * ("Esri has no date for this") and gets cached as such. A 5xx or a dropped
 * connection is not an answer, so it degrades to 'unknown' for this call only
 * and is left uncached to retry next time.
 */
async function getAcquisitionDate(
  identifier: string,
  lat: number,
  lon: number,
): Promise<string> {
  const key = `acq/${identifier}/${lat.toFixed(5)}/${lon.toFixed(5)}`

  const hit = cacheGet<string>(key)
  if (hit) return hit

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: 'SRC_DATE2',
    geometry: JSON.stringify({ spatialReference: { wkid: 4326 }, x: lon, y: lat }),
    returnGeometry: 'false',
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
  })

  // Identifier format: WB_2019_R14 → service name: World_Imagery_Metadata_2019_r14
  const serviceName = `World_Imagery_Metadata_${identifier.replace(/^WB_/i, '').toLowerCase()}`

  let res: Response
  try {
    res = await fetch(`${METADATA_BASE}/${serviceName}/MapServer/6/query?${params}`)
  } catch {
    return 'unknown' // transport failure — don't cache, retry next time
  }

  if (res.status >= 500) return 'unknown'

  let date = 'unknown'
  if (res.ok) {
    try {
      const body = (await res.json()) as { features?: { attributes?: { SRC_DATE2?: number } }[] }
      const epoch = body.features?.[0]?.attributes?.SRC_DATE2
      if (epoch != null && epoch > SRC_DATE_SENTINEL) {
        date = new Date(epoch).toISOString().slice(0, 10)
      }
    } catch {
      return 'unknown' // malformed body — treat as transient
    }
  }

  cacheSet(key, date)
  return date
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ReleaseHandlers {
  /**
   * A release with local changes here. Emitted the moment the walk finds it,
   * newest publish first, while its acquisition date is still being looked up —
   * so `found` is only useful for counting work in flight.
   */
  onFound(layer: WaybackLayer): void
  /** The same release once its date is in. Emission order follows whichever query returns first. */
  onResolved(release: WaybackRelease): void
}

/**
 * Walks Wayback releases backwards from the newest, reporting each one that has
 * local changes at the given point as soon as it is found, and again once its
 * acquisition date resolves. Settles when every date is in.
 *
 * The walk is inherently sequential — each tilemap answer names the next release
 * to check — but the date lookups are not, so they run concurrently alongside it.
 */
export async function loadReleasesWithDates(
  lat: number,
  lon: number,
  handlers: ReleaseHandlers,
): Promise<void> {
  const layers = await getWaybackLayers()
  const layerByNumber = new Map(layers.map((l) => [l.layerNumber, l]))

  const row = lat2tile(lat, TILEMAP_ZOOM)
  const col = lon2tile(lon, TILEMAP_ZOOM)

  const dates: Promise<void>[] = []
  let releaseNumber: number | null = layers[0]?.layerNumber ?? null

  while (releaseNumber !== null) {
    const tilemap = await getTilemap(releaseNumber, row, col)
    if (!tilemap.changed) break // no imagery at this location

    const layer = layerByNumber.get(tilemap.release)
    if (layer) {
      handlers.onFound(layer)
      dates.push(
        getAcquisitionDate(layer.identifier, lat, lon).then((acquisitionDate) =>
          handlers.onResolved({ ...layer, acquisitionDate }),
        ),
      )
    }

    // Move to the release preceding the one that actually changed
    const idx = layers.findIndex((l) => l.layerNumber === tilemap.release)
    releaseNumber = idx >= 0 && idx + 1 < layers.length ? layers[idx + 1].layerNumber : null
  }

  await Promise.all(dates)
}
