<template>
  <div class="wayback-panel">
    <div class="wayback-toolbar">
      <span v-if="phase === 'error'" class="status-error" :title="errorDetail">Failed to load</span>
      <span v-else class="status-text">{{ statusText }}</span>
    </div>

    <div class="wayback-body">
      <!-- Release list -->
      <div class="wayback-list">
        <div
          v-for="r in releases"
          :key="r.layerNumber"
          class="release-item"
          :class="{ selected: selectedLayerNumber === r.layerNumber }"
          @click="pickRelease(r.layerNumber)"
        >
          <div class="release-acq">{{ r.acquisitionDate }}</div>
          <div class="release-pub">pub {{ r.publishDate }}</div>
        </div>
      </div>

      <!-- Map -->
      <div ref="mapEl" class="wayback-map"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import {
  loadReleasesWithDates,
  waybackTileUrl,
  type WaybackRelease,
} from '../../services/waybackApi'
import { basemapUrl } from '../../utils/basemap'
import { buildPixelPolygon } from '../../utils/geometry'

const props = defineProps<{
  params?: { params?: Record<string, unknown>; api?: { updateParameters(p: Record<string, unknown>): void } }
}>()

const appStore = useAppStore()

const mapEl = ref<HTMLDivElement | null>(null)
/** Only releases whose date has arrived, deduplicated, newest acquisition first. */
const releases = ref<WaybackRelease[]>([])
/** Releases the walk has found whose date is still in flight. */
const checking = ref(0)
const selectedLayerNumber = ref<number | null>(null)
const phase = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorDetail = ref('')

const statusText = computed(() => {
  const found = releases.value.length
  if (phase.value === 'loading') {
    if (!found && !checking.value) return 'Detecting releases…'
    return `${found} release${found === 1 ? '' : 's'} · checking ${checking.value}…`
  }
  if (!found) return 'No releases at this location'
  return `${found} release${found === 1 ? '' : 's'}`
})

let map: L.Map | null = null
let basemap: L.TileLayer | null = null
let tileLayer: L.TileLayer | null = null
let marker: L.Polygon | null = null
let resizeObserver: ResizeObserver | null = null

function initMap() {
  if (!mapEl.value || map) return
  const [lon, lat] = appStore.coordinate
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView([lat, lon], 17)
  basemap = L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)
  marker = L.polygon(
    buildPixelPolygon(lon, lat).coordinates[0].map(([lng, la]) => [la, lng] as L.LatLngExpression),
    { color: '#ffff00', fillOpacity: 0, weight: 2 },
  ).addTo(map)
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)
}

function setTileLayer(layerNumber: number) {
  if (!map) return
  if (tileLayer) {
    map.removeLayer(tileLayer)
    tileLayer = null
  }
  tileLayer = L.tileLayer(waybackTileUrl(layerNumber), {
    maxZoom: 20,
    maxNativeZoom: 20,
  })
  // Insert below the marker layer so the marker stays on top
  tileLayer.addTo(map)
  if (marker) marker.bringToFront()
}

function selectRelease(layerNumber: number) {
  selectedLayerNumber.value = layerNumber
  setTileLayer(layerNumber)
  props.params?.api?.updateParameters({ selectedLayerNumber: layerNumber })
}

/** A click, as opposed to an auto-selection — pins the choice across the reorder. */
function pickRelease(layerNumber: number) {
  userPicked = true
  selectRelease(layerNumber)
}

/** Newest acquisition first, unknown dates last. */
function byAcquisition(a: WaybackRelease, b: WaybackRelease): number {
  if (a.acquisitionDate === 'unknown') return b.acquisitionDate === 'unknown' ? 0 : 1
  if (b.acquisitionDate === 'unknown') return -1
  return b.acquisitionDate.localeCompare(a.acquisitionDate)
}

// Discards results from a load the coordinate has already moved on from.
let loadToken = 0
let userPicked = false
/** Position of each release in the walk — index 0 is the most recently published. */
let walkIndex = new Map<number, number>()

/**
 * Place a resolved release in the list, dropping it if another release already
 * covers the same acquisition date.
 *
 * Dates arrive in whatever order the metadata service answers, so "keep the most
 * recently published of a duplicate pair" has to be decided on walk position
 * rather than on arrival order.
 */
function insertRelease(release: WaybackRelease) {
  const rank = walkIndex.get(release.layerNumber) ?? Infinity

  if (release.acquisitionDate !== 'unknown') {
    const clash = releases.value.find((r) => r.acquisitionDate === release.acquisitionDate)
    if (clash) {
      if (rank < (walkIndex.get(clash.layerNumber) ?? Infinity)) Object.assign(clash, release)
      return
    }
  }

  const at = releases.value.findIndex((r) => byAcquisition(release, r) < 0)
  if (at === -1) releases.value.push(release)
  else releases.value.splice(at, 0, release)
}

async function loadReleases() {
  const token = ++loadToken
  const [lon, lat] = appStore.coordinate

  phase.value = 'loading'
  releases.value = []
  checking.value = 0
  selectedLayerNumber.value = null
  errorDetail.value = ''
  userPicked = false
  walkIndex = new Map()

  try {
    await loadReleasesWithDates(lat, lon, {
      onFound(layer) {
        if (token !== loadToken) return
        walkIndex.set(layer.layerNumber, walkIndex.size)
        checking.value++

        // Show imagery from the newest release straight away rather than waiting
        // on its date. Being walk index 0 it always wins any dedup tie, so it
        // cannot later be dropped from the list under the selection.
        if (selectedLayerNumber.value === null) selectRelease(layer.layerNumber)
      },
      onResolved(release) {
        if (token !== loadToken) return
        checking.value--
        insertRelease(release)
      },
    })

    if (token !== loadToken) return

    phase.value = 'ready'
    if (!releases.value.length) return

    // The eagerly selected release is the newest-published one, which need not be
    // the newest *acquisition* — that is what the list is sorted by, and what
    // should end up selected unless the user has already chosen otherwise.
    if (!userPicked) selectRelease(releases.value[0].layerNumber)
  } catch (e) {
    if (token !== loadToken) return
    phase.value = 'error'
    errorDetail.value = e instanceof Error ? e.message : String(e)
  }
}

// Reload when the sample coordinate changes
watch(() => appStore.coordinate, loadReleases, { deep: true })

// Swap basemap when theme changes
watch(() => appStore.theme, () => { basemap?.setUrl(basemapUrl()) })

// Update marker position when coordinate changes
watch(
  () => appStore.coordinate,
  ([lon, lat]) => {
    marker?.setLatLngs(buildPixelPolygon(lon, lat).coordinates[0].map(([lng, la]) => [la, lng] as L.LatLngExpression))
    map?.panTo([lat, lon])
  },
)

onMounted(() => {
  initMap()
  loadReleases()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  map?.remove()
  map = null
  basemap = null
  tileLayer = null
  marker = null
})
</script>

<style scoped>
.wayback-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.wayback-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 0.82rem;
  color: var(--text);
}

.status-text {
  color: var(--text-muted);
  font-style: italic;
}

.status-error {
  color: var(--red);
  cursor: help;
}

.wayback-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.wayback-list {
  width: 140px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--bg);
  border-right: 1px solid var(--border);
}

.release-item {
  padding: 6px 8px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
}

.release-item:hover {
  background: var(--border);
}

.release-item.selected {
  background: var(--bg-input);
  border-left: 2px solid var(--accent);
}

.release-acq {
  font-size: 0.82rem;
  color: var(--text);
  font-weight: 500;
}

.release-pub {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-top: 1px;
}

.wayback-map {
  flex: 1;
  min-width: 0;
}
</style>
