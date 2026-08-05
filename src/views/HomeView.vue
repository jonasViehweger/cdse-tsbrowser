<template>
  <div class="home" :data-theme="appStore.effectiveTheme === 'light' ? 'light' : undefined">
    <!-- Left panel -->
    <aside class="sidebar">
      <div class="brand">
        <img src="/favicon.svg" alt="Logo" class="logo" />
        <div>
          <h1 class="app-title">CDSE TS Browser</h1>
          <p class="app-sub">Copernicus Dataspace Time-Series Explorer</p>
        </div>
      </div>

      <!-- Credentials -->
      <section class="card">
        <div class="card-header">
          <span class="card-title">Credentials</span>
          <span v-if="authStore.isAuthenticated" class="badge badge-ok">Connected</span>
          <span v-else class="badge badge-off">Not connected</span>
        </div>

        <template v-if="!authStore.isAuthenticated">
          <p class="hint">
            Enter your <a href="https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html" target="_blank" rel="noopener">Copernicus Dataspace OAuth2</a> client credentials.
            Enable <strong>Single-page application</strong> and allow domain <strong>*</strong>.
          </p>
          <div class="field">
            <label>Client ID</label>
            <input v-model="clientId" type="text" placeholder="your-client-id" autocomplete="username" />
          </div>
          <div class="field">
            <label>Client Secret</label>
            <input v-model="clientSecret" type="password" placeholder="your-client-secret" autocomplete="current-password" />
          </div>
          <label class="check-label">
            <input v-model="remember" type="checkbox" />
            Remember me
          </label>
          <div v-if="authError" class="error">{{ authError }}</div>
          <button class="btn btn-accent btn-full" :disabled="authLoading || !clientId || !clientSecret" @click="connect">
            {{ authLoading ? 'Connecting…' : 'Save and Connect' }}
          </button>
        </template>
        <template v-else>
          <p class="hint connected-hint">Satellite imagery will load automatically once you open a location.</p>
          <button class="btn btn-ghost btn-full" @click="disconnect">Disconnect</button>
        </template>
      </section>

      <!-- Date range -->
      <section class="card">
        <div class="card-title">Date range</div>
        <div class="date-row">
          <div class="field">
            <label>Start</label>
            <input v-model="startDate" type="date" />
          </div>
          <div class="field">
            <label>End</label>
            <input v-model="endDate" type="date" />
          </div>
        </div>
      </section>

      <!-- Coordinate: type it, or click the map -->
      <section class="card coord-card">
        <div class="card-title">Location</div>
        <div class="coord-row">
          <input
            v-model="coordInput"
            type="text"
            class="coord-input"
            :class="{ 'input-error': coordError }"
            placeholder="lat, lon  e.g. 47.3456, 15.0439"
            inputmode="decimal"
            @keydown.enter="applyCoord"
            @input="coordError = ''"
          />
          <button class="btn btn-ghost btn-go" :disabled="!coordInput.trim()" @click="applyCoord">Go</button>
        </div>
        <p v-if="coordError" class="coord-error">{{ coordError }}</p>
        <p v-else-if="!picked" class="hint">Click on the map, or type a coordinate above.</p>
      </section>

      <button class="btn btn-accent btn-full btn-open" :disabled="!picked" @click="open">
        Open in Browser →
      </button>
    </aside>

    <!-- Map -->
    <div ref="mapEl" class="map"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'
import { fetchToken } from '../services/auth'
import { invalidateWmsInstance } from '../services/wmsConfigApi'
import { serialiseUrl } from '../utils/url'
import { basemapUrl } from '../utils/basemap'
import { parseLatLon, formatLatLon } from '../utils/coordinate'

const appStore = useAppStore()
const authStore = useAuthStore()

// ── Auth ────────────────────────────────────────────────────────────────────
const clientId     = ref(authStore.clientId)
const clientSecret = ref(authStore.clientSecret)
const remember     = ref(authStore.isPersisted())
const authLoading  = ref(false)
const authError    = ref<string | null>(null)

async function connect() {
  authError.value = null
  authLoading.value = true
  try {
    // The cached WMS instance belongs to the previous account and would 403.
    if (clientId.value !== authStore.clientId) invalidateWmsInstance()
    authStore.setCredentials(clientId.value, clientSecret.value)
    await fetchToken(clientId.value, clientSecret.value)
    if (remember.value) authStore.savePersisted()
    else authStore.clearPersisted()
  } catch (e) {
    authError.value = e instanceof Error ? e.message : String(e)
  } finally {
    authLoading.value = false
  }
}

function disconnect() {
  authStore.clearToken()
  authStore.setCredentials('', '')
  authStore.clearPersisted()
  clientId.value = ''
  clientSecret.value = ''
}

// ── Date range ──────────────────────────────────────────────────────────────
const startDate = ref(appStore.startDate)
const endDate   = ref(appStore.endDate)

// ── Map ─────────────────────────────────────────────────────────────────────
const mapEl = ref<HTMLDivElement | null>(null)
const picked = ref<[number, number] | null>(null)
const coordInput = ref('')
const coordError = ref('')

/** Zoom to settle on when a coordinate is typed rather than clicked. */
const TYPED_ZOOM = 13

let map: L.Map | null = null
let marker: L.CircleMarker | null = null

/** Single place a coordinate becomes the selection, whoever chose it. */
function setPicked(lon: number, lat: number, recentre: boolean) {
  picked.value = [lon, lat]
  coordInput.value = formatLatLon(lon, lat)
  coordError.value = ''

  if (!map) return
  if (marker) {
    marker.setLatLng([lat, lon])
  } else {
    marker = L.circleMarker([lat, lon], {
      radius: 7,
      color: 'var(--accent)',
      fillColor: 'var(--accent)',
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map)
  }

  // Typing a far-away coordinate should bring the map to it; clicking should
  // not yank the view out from under the click.
  if (recentre) map.setView([lat, lon], Math.max(map.getZoom(), TYPED_ZOOM))
}

function applyCoord() {
  if (!coordInput.value.trim()) return

  const parsed = parseLatLon(coordInput.value)
  if (!parsed.ok) {
    coordError.value = parsed.error
    return
  }

  setPicked(parsed.value.lon, parsed.value.lat, true)
}

onMounted(() => {
  if (!mapEl.value) return
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView([20, 0], 2)
  L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lng: lon, lat } = e.latlng.wrap()
    setPicked(lon, lat, false)
  })
})

watch(() => appStore.effectiveTheme, () => {
  map?.eachLayer(l => { if (l instanceof L.TileLayer) l.setUrl(basemapUrl()) })
})

onUnmounted(() => { map?.remove(); map = null })

// ── Navigate ─────────────────────────────────────────────────────────────────
function open() {
  if (!picked.value) return

  // Text edited after the pin was placed — honour what is in the box.
  if (coordInput.value.trim() !== formatLatLon(picked.value[0], picked.value[1])) {
    applyCoord()
    if (coordError.value) return
  }

  const [lon, lat] = picked.value
  const qs = serialiseUrl({ lon, lat, start: startDate.value, end: endDate.value, selected: null })
  window.location.href = qs
}
</script>

<style scoped>
.home {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
}

/* ── Sidebar ── */
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 20px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}

/* Without this the cards and the Open button compress to fit a short viewport
   instead of overflowing, so the sidebar never scrolls and the button vanishes. */
.sidebar > * {
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 4px;
}

.logo {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.app-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text);
}

.app-sub {
  margin: 2px 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* ── Cards ── */
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-sub);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.badge {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 99px;
  font-weight: 600;
}

.badge-ok  { background: var(--bg-success); color: var(--green); }
.badge-off { background: var(--bg-error);   color: var(--red);   }

.hint {
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.55;
  margin: 0;
}

.hint a { color: var(--accent); text-decoration: underline; }

.connected-hint { color: var(--text-sub); }

/* ── Fields ── */
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 0.78rem;
  color: var(--text-sub);
}

.field input,
.coord-input {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  padding: 7px 10px;
  font-size: 0.88rem;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  color-scheme: dark;
}

.field input:focus,
.coord-input:focus { border-color: var(--accent); }

[data-theme="light"] .field input,
[data-theme="light"] .coord-input { color-scheme: light; }

.check-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.date-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.error {
  background: var(--bg-error);
  border: 1px solid var(--red);
  border-radius: 4px;
  color: var(--red);
  font-size: 0.82rem;
  padding: 7px 10px;
}

/* ── Coord card ── */
.coord-card { min-height: 60px; }

.coord-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.coord-input {
  flex: 1;
  min-width: 0;
  font-family: monospace;
  color: var(--accent);
}

.coord-input.input-error { border-color: var(--red); }

.btn-go {
  flex-shrink: 0;
  padding: 9px 14px;
}

.coord-error {
  margin: 6px 0 0;
  color: var(--red);
  font-size: 0.78rem;
}

/* ── Buttons ── */
.btn {
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  padding: 9px 16px;
  font-weight: 600;
  transition: opacity 0.1s;
}

.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-accent {
  background: var(--accent);
  color: var(--bg-panel);
}

.btn-accent:not(:disabled):hover { opacity: 0.85; }

.btn-ghost {
  background: var(--bg-input);
  color: var(--text);
}

.btn-ghost:hover { background: var(--bg-hover); }

.btn-full { width: 100%; }

.btn-open { margin-top: auto; }

/* ── Map ── */
.map {
  height: 100%;
  cursor: crosshair;
}

/* ── Narrow screens ──
   Stack map over sidebar. The app shell sets `overflow: hidden` on html/body,
   so the page itself cannot scroll — .home has to be the scroll container. */
@media (max-width: 860px) {
  .home {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
    height: 100%;
    overflow-y: auto;
  }

  /* Map first: picking a location is the point of this page. */
  .map {
    order: -1;
    height: 45vh;
    min-height: 240px;
  }

  .sidebar {
    /* .home scrolls now; a nested scroller here would trap the content. */
    overflow-y: visible;
    border-right: none;
    border-top: 1px solid var(--border);
    padding: 16px;
  }
}
</style>
