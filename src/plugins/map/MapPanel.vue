<template>
  <div class="map-panel">
    <div v-if="status === 'loading'" class="map-status">
      Setting up WMS instance…
    </div>
    <div v-else-if="status === 'error'" class="map-status map-status-error" :title="errorDetail">
      WMS setup failed — {{ errorDetail }}
    </div>
    <div ref="mapEl" class="map-container"></div>

    <PanelSettingsModal
      v-if="showSettings"
      title="Map Settings"
      @cancel="showSettings = false"
      @apply="applySettings"
    >
      <label class="field-row">
        <span class="field-label">Layer</span>
        <select v-model="pendingLayer" class="field-select" :disabled="layersStatus !== 'ready'">
          <option v-if="layersStatus === 'loading'" value="" disabled>Loading…</option>
          <option v-else-if="layersStatus === 'error'" value="" disabled>Failed to load layers</option>
          <option v-for="l in layers" :key="l.id" :value="l.id">{{ l.title }}</option>
        </select>
      </label>
    </PanelSettingsModal>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { usePanelSettingsStore } from '../../stores/panelSettings'
import { ensureWmsInstance, listWmsLayers } from '../../services/wmsConfigApi'
import type { WmsLayer } from '../../services/wmsConfigApi'
import { useAuthStore } from '../../stores/auth'
import { basemapUrl } from '../../utils/basemap'
import PanelSettingsModal from '../../components/PanelSettingsModal.vue'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = { activeLayer?: string }
type PanelApi = {
  id: string
  updateParameters(p: Record<string, unknown>): void
  setTitle(title: string): void
}

const props = defineProps<{
  params?: { params?: UserParams; api?: PanelApi }
}>()

const panelApi = () => props.params?.api

const appStore = useAppStore()
const authStore = useAuthStore()
const layoutStore = useLayoutStore()
const settingsStore = usePanelSettingsStore()

const mapEl = ref<HTMLDivElement | null>(null)
const activeLayer = ref<string>(props.params?.params?.activeLayer ?? 'TRUE-COLOR')
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorDetail = ref('')

const layers = ref<WmsLayer[]>([])
const layersStatus = ref<'loading' | 'ready' | 'error'>('loading')

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

function layerTitle(layerId: string): string {
  return layers.value.find(l => l.id === layerId)?.title ?? layerId
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
    ...(time ? { TIME: time } as Record<string, string> : {}),
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
  // Fetch layer list independently so map is usable even if this fails
  try {
    layers.value = await listWmsLayers()
    layersStatus.value = 'ready'
    // Update title now that we have the real layer name
    panelApi()?.setTitle(layerTitle(activeLayer.value))
  } catch {
    layersStatus.value = 'error'
  }
}

// ── Settings modal state ────────────────────────────────────────────────────

const showSettings = ref(false)
const pendingLayer = ref<string>(activeLayer.value)

function openSettings() {
  pendingLayer.value = activeLayer.value
  showSettings.value = true
}

function applySettings() {
  activeLayer.value = pendingLayer.value
  panelApi()?.setTitle(layerTitle(activeLayer.value))
  showSettings.value = false
}

// ── Panel settings bridge ───────────────────────────────────────────────────

const panelId = computed(() => panelApi()?.id ?? '')

watch(panelId, (id, oldId) => {
  if (oldId) settingsStore.unregister(oldId)
  if (id) settingsStore.register(id, openSettings)
}, { immediate: true })

onUnmounted(() => {
  if (panelId.value) settingsStore.unregister(panelId.value)
})

// ── Watchers ────────────────────────────────────────────────────────────────

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

// Persist and apply layer change
watch(activeLayer, (layer) => {
  panelApi()?.updateParameters({ activeLayer: layer })
  layoutStore.saveLayout()
  if (wmsLayer) wmsLayer.setParams({ layers: layer })
})

// When dockview restores a layout via fromJSON(), it delivers params after mount.
watch(() => props.params?.params, (p) => {
  if (p?.activeLayer && p.activeLayer !== activeLayer.value) {
    activeLayer.value = p.activeLayer
    panelApi()?.setTitle(layerTitle(p.activeLayer))
  }
})

// Update marker when coordinate changes
watch(coordinate, ([lon, lat]) => {
  marker?.setLatLng([lat, lon])
  map?.panTo([lat, lon])
})

// Swap basemap when effective theme changes
watch(() => appStore.effectiveTheme, () => { basemap?.setUrl(basemapUrl()) })

onMounted(() => {
  panelApi()?.setTitle(layerTitle(activeLayer.value))
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

.map-status {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
}

.map-status-error {
  color: var(--red);
  font-style: normal;
  cursor: help;
  background: var(--bg-error);
  border-bottom: 1px solid var(--red);
}

.map-container {
  flex: 1;
  min-height: 0;
}

/* ── Settings modal fields ── */

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-label {
  width: 90px;
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--text-sub);
}

.field-select {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.85rem;
  padding: 6px 8px;
  outline: none;
}

.field-select:focus {
  border-color: var(--accent);
}
</style>
