<template>
  <HomeView v-if="showHome" />
  <div v-else class="app-shell">
    <AppToolbar @open-settings="showSettings = true" @open-shortcuts="showShortcuts = true" />

    <div class="dock-host">
      <DockviewVue
        :theme="dockviewTheme"
        right-header-actions-component="panelSettingsButton"
        @ready="onDockviewReady"
      />
    </div>

    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <ShortcutsModal v-if="showShortcuts" @close="showShortcuts = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watchEffect, watch, onUnmounted } from 'vue'
import { DockviewVue, themeReplit } from 'dockview-vue'

const themeReplitDark = {
  name: 'replit-dark',
  className: 'dockview-theme-replit-dark',
  gap: 10,
}
import type { DockviewReadyEvent } from 'dockview-vue'
import AppToolbar from './components/AppToolbar.vue'
import SettingsModal from './components/SettingsModal.vue'
import ShortcutsModal from './components/ShortcutsModal.vue'
import HomeView from './views/HomeView.vue'

import { useAppStore } from './stores/app'
import { useLayoutStore } from './stores/layout'
import { useCampaignStore } from './stores/campaign'
import { parseUrl, serialiseUrl } from './utils/url'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import type { CampaignField } from './types/campaign'

const appStore = useAppStore()

// Apply theme attribute to <html> so CSS variables switch instantly
watch(
  () => appStore.effectiveTheme,
  (t) => { document.documentElement.dataset.theme = t === 'light' ? 'light' : '' },
  { immediate: true }
)

const dockviewTheme = computed(() => appStore.effectiveTheme === 'light' ? themeReplit : themeReplitDark)
const layoutStore = useLayoutStore()
const campaignStore = useCampaignStore()
const showSettings = ref(false)
const showShortcuts = ref(false)

useKeyboardShortcuts(() => { showShortcuts.value = !showShortcuts.value })

// Parse URL synchronously during setup, before watchEffect first fires.
// Campaign data was already loaded from IDB (or ephemerally) by main.ts before mount.
const parsed = parseUrl(window.location.search)
const showHome = parsed.lon == null && parsed.lat == null && !parsed.schema?.campaign
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
  if (showHome) return
  // Build sample: sample_id + flags + form field values
  const sampleId = campaignStore.currentSampleId

  const sampleObj: Record<string, unknown> = {}
  if (sampleId)                            sampleObj.sample_id = sampleId
  if (Object.keys(appStore.flags).length)  sampleObj.flags     = appStore.flags
  Object.assign(sampleObj, appStore.sampleMeta)

  // Build schema: full schema when campaign active, flagLabels-only otherwise
  let schemaObj: { campaign?: string; flagLabels?: Record<string, string>; fields?: CampaignField[] } | undefined
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

/* ── Dark Replit theme ─────────────────────────────────────────── */
:global(.dockview-theme-replit-dark) {
  --dv-paneview-active-outline-color: #C0CAB3;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(192, 202, 179, 0.15);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #3c4140;
  --dv-icon-hover-background-color: rgba(67, 72, 70, 0.5);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: #1a1b1b;
  --dv-active-sash-color: #C0CAB3;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;

  box-sizing: border-box;
  padding: 10px;
  background-color: #312f2f;

  --dv-group-view-background-color: #312f2f;
  --dv-tabs-and-actions-container-background-color: #121010;
  --dv-activegroup-visiblepanel-tab-background-color: #2b2929;
  --dv-activegroup-hiddenpanel-tab-background-color: #121010;
  --dv-inactivegroup-visiblepanel-tab-background-color: #252323;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #121010;
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: #E5E2E1;
  --dv-activegroup-hiddenpanel-tab-color: #8D928F;
  --dv-inactivegroup-visiblepanel-tab-color: #C3C7C5;
  --dv-inactivegroup-hiddenpanel-tab-color: #8D928F;
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: #3c4140;
}

:global(.dockview-theme-replit-dark .dv-resize-container) {
  border-radius: 10px !important;
  border: none;
}

:global(.dockview-theme-replit-dark .dv-groupview) {
  overflow: hidden;
  border-radius: 10px;
}

:global(.dockview-theme-replit-dark .dv-groupview .dv-tabs-and-actions-container) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

:global(.dockview-theme-replit-dark .dv-groupview .dv-tabs-and-actions-container .dv-tab) {
  margin: 4px;
  border-radius: 8px;
}

:global(.dockview-theme-replit-dark .dv-groupview .dv-tabs-and-actions-container .dv-tab .dv-svg) {
  height: 8px;
  width: 8px;
}

:global(.dockview-theme-replit-dark .dv-groupview .dv-tabs-and-actions-container .dv-tab:hover) {
  background-color: #434846 !important;
}

:global(.dockview-theme-replit-dark .dv-groupview .dv-content-container) {
  background-color: #1f1d1d;
}

:global(.dockview-theme-replit-dark .dv-groupview.dv-active-group) {
  border: 1px solid rgba(255, 255, 255, 0.1);
}

:global(.dockview-theme-replit-dark .dv-groupview.dv-inactive-group) {
  border: 1px solid transparent;
}

:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash) {
  background-color: transparent;
}
:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled)::after) {
  content: '';
  position: absolute;
  height: 4px;
  width: 40px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
}
:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover),
:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active) {
  background-color: transparent;
}
:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover::after),
:global(.dockview-theme-replit-dark .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active::after) {
  background-color: var(--dv-active-sash-color);
}

:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash) {
  background-color: transparent;
}
:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled)::after) {
  content: '';
  position: absolute;
  height: 40px;
  width: 4px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
}
:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover),
:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active) {
  background-color: transparent;
}
:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover::after),
:global(.dockview-theme-replit-dark .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active::after) {
  background-color: var(--dv-active-sash-color);
}
</style>
