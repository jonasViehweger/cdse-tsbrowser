<template>
  <header class="toolbar">
    <span class="toolbar-title">CDSE TS Browser</span>

    <!-- Layout preset selector + save/delete -->
    <div class="layout-controls">
      <span class="layout-label">Layout:</span>
      <select class="layout-select" :value="layoutStore.currentPresetId ?? ''" @change="onPresetChange">
        <option v-if="layoutStore.currentPresetId === null" value="" disabled>Layout</option>
        <optgroup label="Presets">
          <option v-for="preset in LAYOUT_PRESETS" :key="preset.id" :value="preset.id">
            {{ preset.name }}
          </option>
        </optgroup>
        <optgroup v-if="layoutStore.userLayouts.length" label="Saved">
          <option v-for="layout in layoutStore.userLayouts" :key="layout.id" :value="layout.id">
            {{ layout.name }}
          </option>
        </optgroup>
      </select>

      <!-- Inline save UI -->
      <template v-if="saving">
        <input
          ref="saveInputRef"
          v-model="saveName"
          type="text"
          class="save-input"
          placeholder="Layout name…"
          @keydown.enter="confirmSave"
          @keydown.escape="saving = false"
        />
        <button class="layout-btn" :disabled="!saveName.trim()" @click="confirmSave">Save</button>
        <button class="layout-btn" @click="saving = false">Cancel</button>
      </template>
      <template v-else>
        <button class="layout-btn" title="Save current layout…" @click="startSave">Save…</button>
        <button
          v-if="layoutStore.isUserLayout(layoutStore.currentPresetId)"
          class="layout-btn layout-btn-danger"
          title="Delete this saved layout"
          @click="deleteCurrentLayout"
        >Delete</button>
      </template>
    </div>

    <!-- Campaign selector -->
    <div class="campaign-controls">
      <span class="campaign-label">Campaign:</span>
      <select class="campaign-select" :value="campaignStore.schema?.name ?? ''" @change="onCampaignChange">
        <option value="">— none —</option>
        <option v-for="name in campaignNames" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>

    <!-- Add Panel dropdown -->
    <div class="add-panel-wrapper" ref="dropdownRef">
      <button class="add-btn" @click="toggleDropdown">+ Add Panel</button>
      <div v-if="dropdownOpen" class="add-dropdown">
        <button
          v-for="plugin in PANEL_PLUGINS"
          :key="plugin.id"
          class="dropdown-item"
          :disabled="isDisabled(plugin)"
          :title="isDisabled(plugin) ? 'Already open' : ''"
          @click="addPanel(plugin)"
        >
          {{ plugin.name }}
        </button>
      </div>
    </div>

    <div class="toolbar-right">
      <button class="theme-btn" :title="`Theme: ${appStore.theme} — click to cycle`" @click="appStore.toggleTheme()">
        {{ appStore.theme === 'system' ? 'Auto' : appStore.theme === 'dark' ? 'Dark' : 'Light' }}
      </button>
      <button class="help-btn" title="Keyboard shortcuts (?)" @click="$emit('openShortcuts')">?</button>
      <span class="auth-indicator" :class="authClass" :title="authTitle"></span>
      <button class="connect-btn" @click="$emit('openSettings')">Connect</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { useLayoutStore } from '../stores/layout'
import { useCampaignStore } from '../stores/campaign'
import { PANEL_PLUGINS, type PanelPlugin } from '../plugins/registry'
import { LAYOUT_PRESETS } from '../layout/presets'
import { listCampaignNames } from '../utils/campaignIdb'
import type { SampleRecord } from '../types/campaign'

defineEmits<{ openSettings: []; openShortcuts: [] }>()

const appStore = useAppStore()
const authStore = useAuthStore()
const layoutStore = useLayoutStore()
const campaignStore = useCampaignStore()

const campaignNames = ref<string[]>([])

async function refreshCampaignNames() {
  try {
    const names = await listCampaignNames()
    // The active campaign might not be in IDB yet (race with async schema write).
    // Always include it so the select has a matching option immediately.
    const current = campaignStore.schema?.name
    if (current && !names.includes(current)) names.push(current)
    campaignNames.value = names
  } catch {
    campaignNames.value = []
  }
}

async function onCampaignChange(e: Event) {
  const name = (e.target as HTMLSelectElement).value

  // Auto-save current draft before switching campaigns
  const prevSampleId = campaignStore.currentSampleId
  if (prevSampleId && campaignStore.isActive && !campaignStore.isEphemeral) {
    const record: SampleRecord = { ...appStore.sampleMeta }
    if (Object.keys(appStore.flags).length) record.flags = appStore.flags
    campaignStore.saveSampleRecord(prevSampleId, record)
  }

  if (!name) { campaignStore.clear(); return }
  await campaignStore.loadFromIdb(name)

  // Only navigate to first unlabelled if the current coordinate isn't already in this campaign
  const [lon, lat] = appStore.coordinate
  const alreadyHere = campaignStore.features.some(
    f => f.geometry.coordinates[0] === lon && f.geometry.coordinates[1] === lat
  )
  if (!alreadyHere) {
    const firstFeat = campaignStore.features.find(
      f => campaignStore.labellingStatus(f.properties.sample_id) === 'unlabelled'
    ) ?? campaignStore.features[0]
    if (firstFeat) {
      const [flon, flat] = firstFeat.geometry.coordinates
      appStore.setCoordinate(flon, flat)
    }
  }
}

watch(() => campaignStore.schema?.name, refreshCampaignNames)

const dropdownOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const saving = ref(false)
const saveName = ref('')
const saveInputRef = ref<HTMLInputElement | null>(null)

function toggleDropdown() {
  dropdownOpen.value = !dropdownOpen.value
}

function isDisabled(plugin: PanelPlugin): boolean {
  if (!plugin.singleton) return false
  return layoutStore.api?.getPanel(plugin.id) != null
}

function onPresetChange(e: Event) {
  layoutStore.applyPresetById((e.target as HTMLSelectElement).value)
}

async function startSave() {
  saveName.value = ''
  saving.value = true
  await nextTick()
  saveInputRef.value?.focus()
}

function confirmSave() {
  if (!saveName.value.trim()) return
  layoutStore.saveAsUserLayout(saveName.value.trim())
  saving.value = false
  saveName.value = ''
}

function deleteCurrentLayout() {
  const id = layoutStore.currentPresetId
  if (id) layoutStore.deleteUserLayout(id)
}

let panelCounter = 0

function addPanel(plugin: PanelPlugin) {
  dropdownOpen.value = false
  const api = layoutStore.api
  if (!api) return

  const id = plugin.singleton ? plugin.id : `${plugin.id}-${++panelCounter}`
  api.addPanel({
    id,
    component: plugin.id,
    title: plugin.defaultTitle,
    params: plugin.defaultParams,
  })
}

function onDocumentClick(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    dropdownOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  refreshCampaignNames()
})
onUnmounted(() => document.removeEventListener('click', onDocumentClick, true))

const authClass = computed(() => {
  if (!authStore.clientId) return 'auth-grey'
  return authStore.isAuthenticated ? 'auth-green' : 'auth-red'
})

const authTitle = computed(() => {
  if (!authStore.clientId) return 'No credentials entered'
  return authStore.isAuthenticated ? 'Connected to CDSE' : 'Not connected — token expired or missing'
})
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  height: 40px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  color: var(--text);
  font-size: 0.82rem;
}

.toolbar-title {
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
  color: var(--accent);
}

.campaign-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.campaign-label {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}

.campaign-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 4px 6px;
  max-width: 160px;
}

.layout-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.layout-label {
  color: var(--text-muted);
  font-size: 0.78rem;
  white-space: nowrap;
}

.layout-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 4px 6px;
}

.save-input {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 4px 8px;
  width: 130px;
}

.save-input:focus {
  outline: none;
  border-color: var(--accent);
}

.layout-btn {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.78rem;
  padding: 3px 8px;
  white-space: nowrap;
}

.layout-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.layout-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.layout-btn-danger {
  border-color: var(--red);
  color: var(--red);
}

.layout-btn-danger:hover {
  background: color-mix(in srgb, var(--red) 12%, transparent) !important;
}

.add-panel-wrapper {
  position: relative;
}

.add-btn {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 4px 10px;
}

.add-btn:hover {
  background: var(--bg-hover);
}

.add-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  background: var(--bg);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  min-width: 180px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.dropdown-item {
  display: block;
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 7px 12px;
  text-align: left;
}

.dropdown-item:hover:not(:disabled) {
  background: var(--bg-input);
}

.dropdown-item:disabled {
  color: var(--border-mid);
  cursor: default;
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.auth-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.auth-green { background: var(--green); }
.auth-red   { background: var(--red); }
.auth-grey  { background: var(--border-mid); }

.connect-btn {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 4px 10px;
}

.connect-btn:hover {
  background: var(--bg-hover);
}

.theme-btn {
  background: transparent;
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 3px 7px;
}

.theme-btn:hover {
  color: var(--text);
  border-color: var(--text);
}

.help-btn {
  background: transparent;
  border: 1px solid var(--border-mid);
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
}

.help-btn:hover {
  color: var(--text);
  border-color: var(--text);
}
</style>
