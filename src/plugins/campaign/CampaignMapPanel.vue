<template>
  <div class="campaign-map-panel">
    <div class="map-toolbar">
      <span v-if="!campaignStore.isActive" class="status-text">No campaign loaded.</span>
      <span v-else class="status-text">
        {{ campaignStore.features.length }} samples —
        {{ completedCount }} complete
      </span>
      <span v-if="saveError" class="save-error">{{ saveError }}</span>
      <button
        v-if="campaignStore.isActive && currentSampleId"
        class="btn-save-next"
        @click="saveAndNext"
      >Save &amp; Next</button>
    </div>
    <div ref="mapEl" class="campaign-map"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import { basemapUrl } from '../../utils/basemap'
import type { SampleRecord } from '../../types/campaign'

const appStore = useAppStore()
const campaignStore = useCampaignStore()

const mapEl = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let basemap: L.TileLayer | null = null
const markerLayer = L.layerGroup()
let resizeObserver: ResizeObserver | null = null

const completedCount = computed(() =>
  campaignStore.features.filter(f => campaignStore.labellingStatus(f.properties.sample_id) === 'complete').length
)

const currentSampleId = computed<string | null>(() => {
  const [lon, lat] = appStore.coordinate
  const feat = campaignStore.features.find(
    f => f.geometry.coordinates[0] === lon && f.geometry.coordinates[1] === lat
  )
  return feat?.properties.sample_id ?? null
})

const saveError = ref('')

function saveAndNext() {
  if (!currentSampleId.value) return

  const required = campaignStore.currentFields.filter(f => f.required && f.type !== 'display')
  const missing = required.filter(f => {
    const v = appStore.sampleMeta[f.key]
    return v == null || v === ''
  })
  if (missing.length) {
    saveError.value = `Required: ${missing.map(f => f.label).join(', ')}`
    return
  }
  saveError.value = ''

  const record: SampleRecord = { ...appStore.sampleMeta }
  if (Object.keys(appStore.flags).length) {
    record.flags = appStore.flags
  }
  campaignStore.saveSampleRecord(currentSampleId.value, record)

  const nextFeat = campaignStore.features.find(
    f => f.properties.sample_id !== currentSampleId.value &&
         campaignStore.labellingStatus(f.properties.sample_id) === 'unlabelled'
  )
  if (nextFeat) {
    const [lon, lat] = nextFeat.geometry.coordinates
    appStore.setCoordinate(lon, lat)
  }
}

watch(() => appStore.saveAndNextTick, saveAndNext)

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function markerColour(status: 'unlabelled' | 'complete', isSelected: boolean): string {
  if (isSelected) return cssVar('--accent')
  return status === 'complete' ? cssVar('--green') : cssVar('--text-muted')
}

function buildMarkers() {
  markerLayer.clearLayers()
  for (const feat of campaignStore.features) {
    const [lon, lat] = feat.geometry.coordinates
    const sampleId = feat.properties.sample_id
    const status = campaignStore.labellingStatus(sampleId)
    const isSelected = appStore.coordinate[0] === lon && appStore.coordinate[1] === lat
    const colour = markerColour(status, isSelected)

    const marker = L.circleMarker([lat, lon], {
      radius: 6,
      color: colour,
      fillColor: colour,
      fillOpacity: 0.85,
      weight: isSelected ? 3 : 1.5,
    })
    marker.on('click', () => {
      saveError.value = ''
      appStore.setCoordinate(lon, lat)
    })
    markerLayer.addLayer(marker)
  }
}

watch(
  [() => campaignStore.features, () => campaignStore.sampleRecords, () => appStore.coordinate, () => appStore.theme],
  () => buildMarkers(),
  { deep: true },
)

// Swap basemap when theme changes
watch(() => appStore.theme, () => { basemap?.setUrl(basemapUrl()) })

function initMap() {
  if (!mapEl.value || map) return
  const [lon, lat] = appStore.coordinate
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView([lat, lon], 10)
  basemap = L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)
  markerLayer.addTo(map)
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)
  buildMarkers()
}

onMounted(() => initMap())

onUnmounted(() => {
  resizeObserver?.disconnect()
  map?.remove()
  map = null
})
</script>

<style scoped>
.campaign-map-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.map-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 0.82rem;
}

.status-text {
  color: var(--text-muted);
  font-style: italic;
  flex: 1;
}

.save-error {
  color: var(--red);
  font-style: italic;
  margin-right: 6px;
}

.btn-save-next {
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: var(--bg);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 3px 10px;
  flex-shrink: 0;
}

.btn-save-next:hover {
  opacity: 0.85;
}

.campaign-map {
  flex: 1;
  min-height: 0;
}
</style>
