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

      <!-- Coordinate readout -->
      <section class="card coord-card">
        <div class="card-title">Location</div>
        <p v-if="picked" class="coord-text">{{ picked[1].toFixed(5) }}° N, {{ picked[0].toFixed(5) }}° E</p>
        <p v-else class="hint">Click on the map to choose a location.</p>
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
import { serialiseUrl } from '../utils/url'
import { basemapUrl } from '../utils/basemap'

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

let map: L.Map | null = null
let marker: L.CircleMarker | null = null

onMounted(() => {
  if (!mapEl.value) return
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: false }).setView([20, 0], 2)
  L.tileLayer(basemapUrl(), { maxZoom: 19 }).addTo(map)

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lng: lon, lat } = e.latlng.wrap()
    picked.value = [lon, lat]
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
  })
})

watch(() => appStore.effectiveTheme, () => {
  map?.eachLayer(l => { if (l instanceof L.TileLayer) l.setUrl(basemapUrl()) })
})

onUnmounted(() => { map?.remove(); map = null })

// ── Navigate ─────────────────────────────────────────────────────────────────
function open() {
  if (!picked.value) return
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

.field input {
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

.field input:focus { border-color: var(--accent); }

[data-theme="light"] .field input { color-scheme: light; }

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

.coord-text {
  margin: 0;
  font-size: 0.9rem;
  font-family: monospace;
  color: var(--accent);
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
</style>
