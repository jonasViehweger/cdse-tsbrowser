<template>
  <div class="wayback-panel">
    <div class="wayback-toolbar">
      <span v-if="phase === 'loading-layers'" class="status-text">Detecting releases…</span>
      <span v-else-if="phase === 'loading-dates'" class="status-text">Loading acquisition dates…</span>
      <span v-else-if="phase === 'error'" class="status-error" :title="errorDetail">Failed to load</span>
      <span v-else-if="releases.length" class="status-text">
        {{ releases.length }} releases
      </span>
      <span v-else class="status-text">No releases at this location</span>
    </div>

    <div class="wayback-body">
      <!-- Release list -->
      <div class="wayback-list">
        <div
          v-for="r in releases"
          :key="r.layerNumber"
          class="release-item"
          :class="{ selected: selectedLayerNumber === r.layerNumber }"
          @click="selectRelease(r.layerNumber)"
        >
          <div class="release-acq">{{ r.acquisitionDate ?? '…' }}</div>
          <div class="release-pub">pub {{ r.publishDate }}</div>
        </div>
      </div>

      <!-- Map -->
      <div ref="mapEl" class="wayback-map"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import {
  getReleasesAtPoint,
  getAcquisitionDate,
  waybackTileUrl,
  type WaybackRelease,
} from '../../services/waybackApi'
import { basemapUrl } from '../../utils/basemap'

const props = defineProps<{
  params?: { params?: Record<string, unknown>; api?: { updateParameters(p: Record<string, unknown>): void } }
}>()

const appStore = useAppStore()

const mapEl = ref<HTMLDivElement | null>(null)
const releases = ref<WaybackRelease[]>([])
const selectedLayerNumber = ref<number | null>(null)
const phase = ref<'idle' | 'loading-layers' | 'loading-dates' | 'ready' | 'error'>('idle')
const errorDetail = ref('')

let map: L.Map | null = null
let basemap: L.TileLayer | null = null
let tileLayer: L.TileLayer | null = null
let marker: L.CircleMarker | null = null
let resizeObserver: ResizeObserver | null = null

function initMap() {
  if (!mapEl.value || map) return
  const [lon, lat] = appStore.coordinate
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView([lat, lon], 14)
  basemap = L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)
  marker = L.circleMarker([lat, lon], {
    radius: 6,
    color: 'var(--accent)',
    fillColor: 'var(--accent)',
    fillOpacity: 0.9,
    weight: 2,
  }).addTo(map)
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

async function loadReleases() {
  const [lon, lat] = appStore.coordinate
  phase.value = 'loading-layers'
  releases.value = []
  selectedLayerNumber.value = null
  errorDetail.value = ''

  try {
    const layers = await getReleasesAtPoint(lat, lon)

    if (!layers.length) {
      phase.value = 'ready'
      return
    }

    // Fetch all acquisition dates concurrently before showing the list
    phase.value = 'loading-dates'
    const enriched: WaybackRelease[] = await Promise.all(
      layers.map(async (layer) => {
        const acquisitionDate = await getAcquisitionDate(lat, lon, layer.identifier)
        return { ...layer, acquisitionDate }
      }),
    )

    // Deduplicate: for the same acquisition date keep only the most recently
    // published release (layers are already sorted newest-publish-first from
    // getReleasesAtPoint, so the first occurrence wins).
    const seen = new Set<string>()
    const deduped = enriched.filter((r) => {
      if (!r.acquisitionDate || r.acquisitionDate === 'unknown') return true
      if (seen.has(r.acquisitionDate)) return false
      seen.add(r.acquisitionDate)
      return true
    })

    // Sort by acquisition date descending; unknown dates go to the end
    deduped.sort((a, b) => {
      if (!a.acquisitionDate || a.acquisitionDate === 'unknown') return 1
      if (!b.acquisitionDate || b.acquisitionDate === 'unknown') return -1
      return b.acquisitionDate.localeCompare(a.acquisitionDate)
    })

    releases.value = deduped

    // Auto-select the most recent release
    selectRelease(deduped[0].layerNumber)
    phase.value = 'ready'
  } catch (e) {
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
    marker?.setLatLng([lat, lon])
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
