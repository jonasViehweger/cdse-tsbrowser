import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WaybackLayer, WaybackRelease } from './waybackApi'

// Three releases; 64002 is superseded by 64001 in the tilemap walk below.
const CAPS_XML = `
<Capabilities>
  <Layer>
    <ows:Title>World Imagery (Wayback 2026-02-26)</ows:Title>
    <ows:Identifier>WB_2026_R01</ows:Identifier>
    <ResourceURL template="https://x/MapServer/tile/64003/{TileMatrix}/{TileRow}/{TileCol}"/>
  </Layer>
  <Layer>
    <ows:Title>World Imagery (Wayback 2025-06-01)</ows:Title>
    <ows:Identifier>WB_2025_R05</ows:Identifier>
    <ResourceURL template="https://x/MapServer/tile/64002/{TileMatrix}/{TileRow}/{TileCol}"/>
  </Layer>
  <Layer>
    <ows:Title>World Imagery (Wayback 2024-01-10)</ows:Title>
    <ows:Identifier>WB_2024_R02</ows:Identifier>
    <ResourceURL template="https://x/MapServer/tile/64001/{TileMatrix}/{TileRow}/{TileCol}"/>
  </Layer>
</Capabilities>`

const LAT = 48.5
const LON = 11.25

/** In-memory stand-in that keeps entries as own enumerable props, like the real thing. */
function makeLocalStorage(): Storage {
  const ls = {} as Record<string, unknown>
  const method = (name: string, fn: unknown) =>
    Object.defineProperty(ls, name, { value: fn, enumerable: false, writable: true })

  method('getItem', (k: string) =>
    Object.prototype.hasOwnProperty.call(ls, k) ? (ls[k] as string) : null,
  )
  method('setItem', (k: string, v: string) =>
    Object.defineProperty(ls, k, {
      value: String(v),
      enumerable: true,
      writable: true,
      configurable: true,
    }),
  )
  method('removeItem', (k: string) => { delete ls[k] })
  method('clear', () => { for (const k of Object.keys(ls)) delete ls[k] })
  method('key', (i: number) => Object.keys(ls)[i] ?? null)
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false })

  return ls as unknown as Storage
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
}

const EXPECTED: WaybackRelease[] = [
  { layerNumber: 64003, publishDate: '2026-02-26', identifier: 'WB_2026_R01', acquisitionDate: '2026-01-15' },
  { layerNumber: 64001, publishDate: '2024-01-10', identifier: 'WB_2024_R02', acquisitionDate: 'unknown' },
]

let calls: string[] = []

function mockFetch(url: string): Promise<Response> {
  calls.push(url)

  if (url.includes('WMTSCapabilities')) {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(CAPS_XML) } as Response)
  }
  // Newest release has changes here, and is its own nearest changed release.
  if (url.includes('/tilemap/64003/')) return json({ data: [1], select: [64003] })
  // Walking back from 64002 lands on 64001 — 64002 itself never changed here.
  if (url.includes('/tilemap/64002/')) return json({ data: [1], select: [64001] })

  if (url.includes('World_Imagery_Metadata_2026_r01')) {
    return json({ features: [{ attributes: { SRC_DATE2: Date.UTC(2026, 0, 15) } }] })
  }
  // A release whose metadata service does not exist — the case that used to
  // poison the whole point's cache entry.
  if (url.includes('World_Imagery_Metadata_2024_r02')) {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject() } as unknown as Response)
  }

  throw new Error(`unexpected fetch: ${url}`)
}

/** Re-imports the module with an empty in-memory state, as a page reload would. */
async function reload() {
  vi.resetModules()
  return import('./waybackApi')
}

/** Runs a full load and reports what each handler saw. */
async function load(api: typeof import('./waybackApi')) {
  const found: WaybackLayer[] = []
  const resolved: WaybackRelease[] = []

  await api.loadReleasesWithDates(LAT, LON, {
    onFound: (layer) => found.push(layer),
    onResolved: (release) => resolved.push(release),
  })
  // Let the debounced cache flush land before anyone inspects localStorage.
  await new Promise((r) => setTimeout(r, 0))

  return { found, resolved }
}

describe('loadReleasesWithDates', () => {
  beforeEach(() => {
    calls = []
    vi.stubGlobal('localStorage', makeLocalStorage())
    vi.stubGlobal('fetch', mockFetch)
  })

  it('walks back through releases with local changes and resolves their dates', async () => {
    const { found, resolved } = await load(await reload())

    // 64002 has no local changes here — the tilemap sends the walk past it to 64001.
    expect(found.map((l) => l.layerNumber)).toEqual([64003, 64001])
    expect(resolved).toEqual(EXPECTED)
  })

  it('serves an identical result from cache after a reload, with no network at all', async () => {
    await load(await reload())
    expect(calls.length).toBeGreaterThan(0)

    calls = []
    const { resolved } = await load(await reload())

    expect(calls).toEqual([])
    expect(resolved).toEqual(EXPECTED)
  })

  it('caches a missing metadata service rather than retrying it forever', async () => {
    await load(await reload())

    calls = []
    await load(await reload())

    expect(calls.filter((u) => u.includes('World_Imagery_Metadata_2024_r02'))).toEqual([])
  })
})
