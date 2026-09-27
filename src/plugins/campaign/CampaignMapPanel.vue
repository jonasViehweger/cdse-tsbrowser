<template>
  <div class="campaign-map-panel">
    <div class="map-toolbar">
      <span v-if="!campaignStore.isActive" class="status-text">No campaign loaded.</span>
      <span v-else class="status-text">
        {{ campaignStore.features.length }} samples —
        {{ completedCount }} complete
      </span>
      <span v-if="queue.length" class="queue-badge">Queue: {{ queue.length }} left</span>
      <span v-if="queueNote" class="queue-note">{{ queueNote }}</span>
      <span v-if="saveError" class="save-error">{{ saveError }}</span>
      <button
        v-if="campaignStore.isActive && currentSampleId"
        class="btn-save-next"
        @click="saveAndNext"
      >Save &amp; Next</button>
    </div>

    <div ref="mapEl" class="campaign-map"></div>

    <PanelSettingsModal
      v-if="showSettings"
      title="Campaign Map Settings"
      @cancel="showSettings = false"
      @apply="applySettings"
    >
      <label class="field-row">
        <span class="field-label">Next sample</span>
        <select v-model="draftField" class="field-select">
          <option value="">First missing a required field</option>
          <option v-for="f in campaignStore.currentFields" :key="f.key" :value="f.key">
            First with empty “{{ f.label }}”
          </option>
        </select>
      </label>

      <label class="field-row align-top">
        <span class="field-label">Queue</span>
        <div class="field-stack">
          <textarea
            v-model="draftQueue"
            class="field-textarea"
            rows="3"
            placeholder="12, 48, 103"
            spellcheck="false"
          ></textarea>
          <p class="field-hint">
            Walks these sample ids in order instead of the rule above. Each one leaves
            the queue once its sample is saved.
            <span v-if="draftUnknownCount" class="field-warn">
              {{ draftUnknownCount }} id{{ draftUnknownCount > 1 ? 's are' : ' is' }} not in this
              campaign and will be dropped.
            </span>
          </p>
        </div>
      </label>
    </PanelSettingsModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import { usePanelSettingsStore } from '../../stores/panelSettings'
import { basemapUrl } from '../../utils/basemap'
import PanelSettingsModal from '../../components/PanelSettingsModal.vue'
import type { SampleRecord } from '../../types/campaign'

// dockview hands the panel API in under `params`; we only need the id, to
// register this panel's settings with the group header.
const props = defineProps<{
  params?: { api?: { id: string } }
}>()

const appStore = useAppStore()
const campaignStore = useCampaignStore()
const settingsStore = usePanelSettingsStore()

const mapEl = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let basemap: L.TileLayer | null = null
const markerLayer = L.layerGroup()
let resizeObserver: ResizeObserver | null = null

const completedCount = computed(() =>
  campaignStore.features.filter(f => campaignStore.labellingStatus(f.properties.sample_id) === 'complete').length
)

const currentSampleId = computed(() => campaignStore.currentSampleId)

const saveError = ref('')

// ── Navigation settings ─────────────────────────────────────────────────────
//
// Which sample "Save & Next" goes to. By default that's the first one still
// missing a required field, but an interpreter working through a specific
// subset — a review round, a list from a colleague — needs to say so.

const NAV_KEY = 'campaign-nav'

/** Field whose emptiness marks a sample as still to do. '' = any required field. */
const navField = ref('')

/** Explicit sample order. Non-empty, it overrides {@link navField} entirely. */
const queue = ref<string[]>([])
const queueInput = ref('')
const queueNote = ref('')

/** Sample ids are numbers in some campaigns and strings in others. */
function idOf(feat: { properties: { sample_id: string } }): string {
  return String(feat.properties.sample_id)
}

function loadNav() {
  navField.value = ''
  queue.value = []
  queueInput.value = ''
  queueNote.value = ''
  const name = campaignStore.schema?.name
  if (!name) return
  try {
    const raw = localStorage.getItem(`${NAV_KEY}:${name}`)
    if (!raw) return
    const saved = JSON.parse(raw) as { field?: string; queue?: string[] }
    navField.value = saved.field ?? ''
    queue.value = saved.queue ?? []
    queueInput.value = queue.value.join(', ')
  } catch { /* unreadable settings aren't worth failing over */ }
}

function saveNav() {
  const name = campaignStore.schema?.name
  if (!name) return
  try {
    localStorage.setItem(`${NAV_KEY}:${name}`, JSON.stringify({ field: navField.value, queue: queue.value }))
  } catch { /* quota */ }
}

// Settings belong to a campaign, so they follow whichever one is open.
watch(() => campaignStore.schema?.name, loadNav, { immediate: true })

/**
 * Ids this campaign actually has, in the order given and without repeats.
 * Anything else is counted so the dialog can say how much it is dropping.
 */
function parseQueue(text: string): { ids: string[]; unknown: number } {
  const known = new Set(campaignStore.features.map(idOf))
  const seen = new Set<string>()
  const ids: string[] = []
  let unknown = 0
  for (const id of text.split(/[\s,;]+/).filter(Boolean)) {
    if (!known.has(id)) { unknown++; continue }
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids, unknown }
}

// ── Settings dialog (opened from the group header) ──────────────────────────

const showSettings = ref(false)
const draftField = ref('')
const draftQueue = ref('')

const draftUnknownCount = computed(() => parseQueue(draftQueue.value).unknown)

function openSettings() {
  draftField.value = navField.value
  draftQueue.value = queueInput.value
  showSettings.value = true
}

function applySettings() {
  navField.value = draftField.value

  const { ids } = parseQueue(draftQueue.value)
  const started = ids.length > 0 && ids[0] !== queue.value[0]
  queue.value = ids
  queueInput.value = ids.join(', ')
  queueNote.value = ''

  saveNav()
  showSettings.value = false

  // Opening the first queued sample is the point of setting a queue; don't do
  // it when the queue was left as it was, or the user would be yanked back.
  if (started) goTo(ids[0])
}

const panelId = computed(() => props.params?.api?.id ?? '')

watch(panelId, (id, oldId) => {
  if (oldId) settingsStore.unregister(oldId)
  if (id) settingsStore.register(id, 'settings', openSettings)
}, { immediate: true })

onUnmounted(() => {
  if (panelId.value) settingsStore.unregister(panelId.value)
})

function goTo(sampleId: string): boolean {
  const feat = campaignStore.features.find(f => idOf(f) === sampleId)
  if (!feat) return false
  const [lon, lat] = feat.geometry.coordinates
  appStore.setCoordinate(lon, lat)
  return true
}

/** Whether a sample still counts as outstanding under the current setting. */
function needsLabelling(sampleId: string): boolean {
  if (!navField.value) return campaignStore.labellingStatus(sampleId) === 'unlabelled'
  const value = campaignStore.sampleRecords[sampleId]?.[navField.value]
  return value == null || value === ''
}

/**
 * Move on after a save: down the queue when one is set, otherwise to the first
 * sample the rule still wants.
 *
 * A saved sample leaves the queue whether or not it was the one at the front —
 * labelling it is what the queue was asking for, however the user got there.
 */
function advance(savedId: string) {
  if (queue.value.length) {
    queue.value = queue.value.filter(id => id !== savedId)
    queueInput.value = queue.value.join(', ')
    saveNav()
    if (!queue.value.length) {
      queueNote.value = 'Queue finished.'
      return
    }
    if (goTo(queue.value[0])) return
  }

  const next = campaignStore.features.find(
    f => idOf(f) !== savedId && needsLabelling(idOf(f))
  )
  if (next) {
    const [lon, lat] = next.geometry.coordinates
    appStore.setCoordinate(lon, lat)
  }
}

function saveAndNext() {
  if (!currentSampleId.value) return

  if (campaignStore.isEphemeral) {
    saveError.value = 'Campaign not in local library — cannot save'
    return
  }
  if (campaignStore.schemaMismatch) {
    saveError.value = 'Schema mismatch with local campaign — cannot save'
    return
  }

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
  advance(String(currentSampleId.value))
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
      queueNote.value = ''
      appStore.setCoordinate(lon, lat)
    })
    markerLayer.addLayer(marker)
  }
}

watch(
  [() => campaignStore.features, () => campaignStore.sampleRecords, () => appStore.coordinate, () => appStore.theme],
  () => buildMarkers(),
)

// Follow the active coordinate, whatever changed it (campaign next, marker click,
// coordinate input panel, toolbar).
watch(() => appStore.coordinate, ([lon, lat]) => {
  map?.panTo([lat, lon])
})

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

.queue-badge {
  color: var(--accent);
  flex-shrink: 0;
}

.queue-note {
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.field-row.align-top {
  align-items: flex-start;
}

.field-label {
  width: 90px;
  flex-shrink: 0;
  font-size: 0.85rem;
  color: var(--text-sub);
}

.field-select,
.field-textarea {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
  padding: 6px 8px;
  outline: none;
}

.field-select {
  flex: 1;
}

.field-textarea {
  resize: vertical;
}

.field-select:focus,
.field-textarea:focus {
  border-color: var(--accent);
}

.field-stack {
  flex: 1;
  min-width: 0;
}

.field-hint {
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
  margin-top: 5px;
}

.field-warn {
  color: var(--orange);
}

.campaign-map {
  flex: 1;
  min-height: 0;
}
</style>
