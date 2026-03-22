<template>
  <div class="app-shell">
    <AppToolbar @open-settings="showSettings = true" @open-shortcuts="showShortcuts = true" />

    <div class="dock-host">
      <DockviewVue
        :theme="dockviewTheme"
        @ready="onDockviewReady"
      />
    </div>

    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <ShortcutsModal v-if="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect, watch, onUnmounted } from 'vue'
import { DockviewVue, themeDark, themeLight } from 'dockview-vue'
import type { DockviewReadyEvent } from 'dockview-vue'
import AppToolbar from './components/AppToolbar.vue'
import SettingsModal from './components/SettingsModal.vue'
import ShortcutsModal from './components/ShortcutsModal.vue'

import { useAppStore } from './stores/app'
import { useLayoutStore } from './stores/layout'
import { useCampaignStore } from './stores/campaign'
import { parseUrl, serialiseUrl } from './utils/url'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'

const appStore = useAppStore()

// Apply theme attribute to <html> so CSS variables switch instantly
watch(
  () => appStore.theme,
  (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : '' },
  { immediate: true }
)

const dockviewTheme = computed(() => appStore.theme === 'light' ? themeLight : themeDark)
const layoutStore = useLayoutStore()
const campaignStore = useCampaignStore()
const showSettings = ref(false)
const showShortcuts = ref(false)

useKeyboardShortcuts(() => { showShortcuts.value = !showShortcuts.value })

// Parse URL synchronously during setup, before watchEffect first fires.
// Campaign data was already loaded from IDB (or ephemerally) by main.ts before mount.
const parsed = parseUrl(window.location.search)
if (parsed.lon != null && parsed.lat != null) {
  appStore.setCoordinate(parsed.lon, parsed.lat)
}
if (parsed.start) {
  appStore.setDateRange(parsed.start, parsed.end ?? appStore.endDate)
}
if (parsed.selected) {
  appStore.setSelectedDate(parsed.selected)
}
// Flags come from sample.flags
if (parsed.sample?.flags) {
  appStore.setFlags(parsed.sample.flags)
}
// flagLabels: prefer campaign schema (already loaded), fall back to URL schema
if (campaignStore.schema?.flagLabels) {
  appStore.setFlagLabels(campaignStore.schema.flagLabels)
} else if (parsed.schema?.flagLabels) {
  appStore.setFlagLabels(parsed.schema.flagLabels)
}
// Form field values: sample minus flags (sample_id stored separately for fallback)
if (parsed.sample) {
  const { sample_id, flags: _flags, ...meta } = parsed.sample
  if (sample_id) appStore.setUrlSampleId(sample_id as string)
  if (Object.keys(meta).length) appStore.setSampleMeta(meta as Record<string, unknown>)
}

// Keep flagLabels in sync with the active campaign schema whenever it changes
// (covers campaign switches, uploads, admin panel edits)
watch(() => campaignStore.schema?.flagLabels, (fl) => {
  if (fl) appStore.setFlagLabels(fl)
})

watchEffect(() => {
  // Build sample: sample_id + flags + form field values
  const sampleId = campaignStore.currentSampleId

  const sampleObj: Record<string, unknown> = {}
  if (sampleId)                            sampleObj.sample_id = sampleId
  if (Object.keys(appStore.flags).length)  sampleObj.flags     = appStore.flags
  Object.assign(sampleObj, appStore.sampleMeta)

  // Build schema: full schema when campaign active, flagLabels-only otherwise
  let schemaObj: { campaign?: string; flagLabels?: Record<string, string>; fields?: unknown[] } | undefined
  if (campaignStore.isActive && campaignStore.schema) {
    schemaObj = {
      campaign:   campaignStore.schema.name,
      flagLabels: campaignStore.schema.flagLabels,
      fields:     campaignStore.schema.fields,
    }
  } else if (Object.keys(appStore.flagLabels).length) {
    schemaObj = { flagLabels: appStore.flagLabels }
  }

  const url = serialiseUrl({
    lon:      appStore.coordinate[0],
    lat:      appStore.coordinate[1],
    start:    appStore.startDate,
    end:      appStore.endDate,
    selected: appStore.selectedDate,
    sample:   Object.keys(sampleObj).length ? sampleObj : undefined,
    schema:   schemaObj,
  })
  history.replaceState(null, '', url)
})

let saveTimer = 0
onUnmounted(() => clearTimeout(saveTimer))

function onDockviewReady(event: DockviewReadyEvent) {
  layoutStore.setApi(event.api)

  if (!layoutStore.loadSavedLayout()) {
    layoutStore.applyDefault()
  }

  // Debounced auto-save on any layout change
  event.api.onDidLayoutChange(() => {
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => layoutStore.saveLayout(), 500)
  })

  // Expose API in dev mode for layout export
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__dockview = event.api
  }
}
</script>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#app {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.dock-host {
  flex: 1;
  min-height: 0;
  position: relative;
}

/* DockviewVue renders a plain <div> wrapper around the actual dockview element.
   Both the wrapper and the dockview root need explicit height so dv-grid-view
   resolves 100% against a non-zero parent. */
.dock-host > div,
.dock-host :deep([class*="dockview-theme"]) {
  height: 100%;
}
</style>
