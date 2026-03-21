<template>
  <div class="map-panel">
    <div class="map-toolbar">
      <select v-model="activeLayer" class="layer-select">
        <option value="TRUE-COLOR">True Color</option>
        <option value="FALSE-COLOR">False Color</option>
      </select>
      <span v-if="status === 'loading'" class="status-text">Setting up WMS instance…</span>
      <span v-if="status === 'error'" class="status-error" :title="errorDetail">WMS setup failed</span>
    </div>
    <div ref="mapEl" class="map-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { ensureWmsInstance } from '../../services/wmsConfigApi'
import { useAuthStore } from '../../stores/auth'
import { basemapUrl } from '../../utils/basemap'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = { activeLayer?: 'TRUE-COLOR' | 'FALSE-COLOR' }
type PanelApi = { updateParameters(p: Record<string, unknown>): void }

const props = defineProps<{
  params?: { params?: UserParams; api?: PanelApi }
}>()

const panelApi = () => props.params?.api

const appStore = useAppStore()
const authStore = useAuthStore()
const layoutStore = useLayoutStore()

const mapEl = ref<HTMLDivElement | null>(null)
const activeLayer = ref<'TRUE-COLOR' | 'FALSE-COLOR'>(props.params?.params?.activeLayer ?? 'TRUE-COLOR')
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorDetail = ref('')

let map: L.Map | null = null
let basemap: L.TileLayer | null = null
let wmsLayer: L.TileLayer.WMS | null = null
let marker: L.CircleMarker | null = null
let resizeObserver: ResizeObserver | null = null

function wmsUrl(instanceId: string) {
  return `${import.meta.env.VITE_API_BASE}/ogc/wms/${instanceId}`
}

const coordinate = computed(() => appStore.coordinate)
const selectedDate = computed(() => appStore.selectedDate)

function timeParam(date: string | null): string {
  if (!date) return ''
  return `${date}T00:00:00Z/${date}T23:59:59Z`
}

function initMap(instanceId: string) {
  if (!mapEl.value || map) return

  const [lon, lat] = coordinate.value
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView(
    [lat, lon],
    14
  )

  basemap = L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)

  // Sentinel Hub WMS layer
  const time = timeParam(selectedDate.value)
  wmsLayer = L.tileLayer.wms(wmsUrl(instanceId), {
    layers: activeLayer.value,
    format: 'image/jpeg',
    version: '1.1.1',
    transparent: false,
    ...(time ? { TIME: time } : {}),
  }).addTo(map)

  // Sample point marker
  marker = L.circleMarker([lat, lon], {
    radius: 6,
    color: 'var(--accent)',
    fillColor: 'var(--accent)',
    fillOpacity: 0.9,
    weight: 2,
  }).addTo(map)

  // Resize observer so map redraws when the panel is resized by dockview
  resizeObserver = new ResizeObserver(() => map?.invalidateSize())
  resizeObserver.observe(mapEl.value)

  status.value = 'ready'
}

async function setup() {
  if (!authStore.isAuthenticated) return
  status.value = 'loading'
  try {
    const instanceId = await ensureWmsInstance()
    initMap(instanceId)
  } catch (e) {
    status.value = 'error'
    errorDetail.value = e instanceof Error ? e.message : String(e)
  }
}

// Re-try setup when credentials become available
watch(() => authStore.isAuthenticated, (authenticated) => {
  if (authenticated && status.value === 'idle') setup()
})

// Update WMS TIME when selected date changes
watch(selectedDate, (date) => {
  if (!wmsLayer) return
  const time = timeParam(date)
  if (time) wmsLayer.setParams({ TIME: time })
})

// Persist setting and update WMS tiles whenever the active layer changes.
// These are kept separate: persistence must happen even while WMS is still loading.
watch(activeLayer, (layer) => {
  panelApi()?.updateParameters({ activeLayer: layer })
  layoutStore.saveLayout()
  if (wmsLayer) wmsLayer.setParams({ layers: layer })
})

// When dockview restores a layout via fromJSON(), it delivers params after
// the component mounts. Sync them back into the local ref.
watch(() => props.params?.params, (p) => {
  if (p?.activeLayer && p.activeLayer !== activeLayer.value)
    activeLayer.value = p.activeLayer
})

// Update marker when coordinate changes
watch(coordinate, ([lon, lat]) => {
  marker?.setLatLng([lat, lon])
  map?.panTo([lat, lon])
})

// Swap basemap when theme changes
watch(() => appStore.theme, () => { basemap?.setUrl(basemapUrl()) })

onMounted(() => {
  if (authStore.isAuthenticated) setup()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  map?.remove()
  map = null
  wmsLayer = null
  marker = null
})
</script>

<style scoped>
.map-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.map-toolbar {
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

.layer-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 3px 6px;
}

.status-text {
  color: var(--text-muted);
  font-style: italic;
}

.status-error {
  color: var(--red);
  cursor: help;
}

.map-container {
  flex: 1;
  min-height: 0;
}
</style>
