/**
 * Esri World Imagery Wayback API
 *
 * Algorithm based on:
 *   https://github.com/Esri/wayback-core/blob/246910537a2f33a5359b48d56ab1a1ba739c8a69/src/change-detector/index.ts
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
  /** Actual satellite acquisition date from metadata. null while loading, 'unknown' on failure. */
  acquisitionDate: string | null
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
// WMTS capabilities — cached in localStorage for 24 h
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
// Tilemap traversal — finds all releases with local changes at a point
// ---------------------------------------------------------------------------

const tilemapCache = new Map<string, WaybackLayer[]>()

export async function getReleasesAtPoint(lat: number, lon: number): Promise<WaybackLayer[]> {
  const key = `${lat.toFixed(5)}_${lon.toFixed(5)}`
  if (tilemapCache.has(key)) return tilemapCache.get(key)!

  const layers = await getWaybackLayers()
  const layerByNumber = new Map(layers.map((l) => [l.layerNumber, l]))

  const row = lat2tile(lat, TILEMAP_ZOOM)
  const col = lon2tile(lon, TILEMAP_ZOOM)

  const results: WaybackLayer[] = []
  let releaseNumber: number | null = layers[0]?.layerNumber ?? null

  while (releaseNumber !== null) {
    const url = `${WAYBACK_BASE}/tilemap/${releaseNumber}/${TILEMAP_ZOOM}/${row}/${col}`
    const res = await fetch(url)
    const tilemap = (await res.json()) as { data: number[]; select?: number[] }

    if (!tilemap.data[0]) break // no imagery at this location

    const actualRelease = tilemap.select?.[0] ?? releaseNumber
    const layer = layerByNumber.get(actualRelease)
    if (layer) results.push(layer)

    // Move to the release preceding actualRelease
    const idx = layers.findIndex((l) => l.layerNumber === actualRelease)
    releaseNumber = idx >= 0 && idx + 1 < layers.length ? layers[idx + 1].layerNumber : null
  }

  tilemapCache.set(key, results)
  return results
}

// ---------------------------------------------------------------------------
// Acquisition date from Esri metadata service
// ---------------------------------------------------------------------------

export async function getAcquisitionDate(
  lat: number,
  lon: number,
  identifier: string,
): Promise<string> {
  const cacheKey = `cdse-ts-wayback-acq-${identifier}-${lat.toFixed(5)}-${lon.toFixed(5)}`
  const cached = localStorage.getItem(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: 'SRC_DATE2',
    geometry: JSON.stringify({ spatialReference: { wkid: 4326 }, x: lon, y: lat }),
    returnGeometry: 'false',
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
  })

  try {
    // Identifier format: WB_2019_R14 → service name: World_Imagery_Metadata_2019_r14
    const serviceName = `World_Imagery_Metadata_${identifier.replace(/^WB_/i, '').toLowerCase()}`
    const res = await fetch(`${METADATA_BASE}/${serviceName}/MapServer/6/query?${params}`)
    const data = (await res.json()) as { features?: { attributes?: { SRC_DATE2?: number } }[] }
    const epoch = data.features?.[0]?.attributes?.SRC_DATE2
    // 315532800000 ms = 1980-01-01 — Esri sentinel value meaning "unknown"
    const date = epoch != null && epoch > 315532800000 ? new Date(epoch).toISOString().slice(0, 10) : 'unknown'
    if (date !== 'unknown') localStorage.setItem(cacheKey, date)
    return date
  } catch {
    return 'unknown'
  }
}
