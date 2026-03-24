<template>
  <div class="ts-panel">
    <div v-if="error" class="ts-error">{{ error }}</div>

    <div v-if="loading && data.length === 0" class="ts-loading">Loading…</div>

    <div v-if="!loading || data.length > 0" class="ts-chart-wrapper">
      <span v-if="appStore.selectedDate" class="selected-date-label">
        {{ appStore.selectedDate }}
      </span>
      <TimeSeriesChart
        :data="data"
        :flags="flags"
        :flag-labels="flagLabels"
        :selected-date="appStore.selectedDate"
        :y-min="yMin"
        :y-max="yMax"
        :unit="dataSource?.unit ?? ''"
        class="ts-chart"
        @point-click="onPointClick"
      />
    </div>

    <PanelSettingsModal
      v-if="showSettings"
      title="Time Series Settings"
      @cancel="showSettings = false"
      @apply="applySettings"
    >
      <label class="field-row">
        <span class="field-label">Data source</span>
        <select v-model="pendingDataSourceId" class="field-select">
          <option v-for="ds in allDataSources" :key="ds.id" :value="ds.id">{{ ds.name }}</option>
        </select>
      </label>

      <label class="field-row toggle-row">
        <span class="field-label">Cloud mask</span>
        <input v-model="pendingMaskClouds" type="checkbox" />
      </label>
    </PanelSettingsModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { usePanelSettingsStore } from '../../stores/panelSettings'
import { useTimeSeries } from '../../composables/useTimeSeries'
import { useTimeSeriesConfig } from './useTimeSeriesConfig'
import TimeSeriesChart from './TimeSeriesChart.vue'
import PanelSettingsModal from '../../components/PanelSettingsModal.vue'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = { dataSourceId?: string; maskClouds?: boolean }
type PanelApi = {
  id: string
  updateParameters(p: Record<string, unknown>): void
  setTitle(title: string): void
}

const props = defineProps<{
  params?: { params?: UserParams; api?: PanelApi }
}>()

const panelApi = () => props.params?.api
const userParams = () => props.params?.params

const appStore = useAppStore()
const layoutStore = useLayoutStore()
const settingsStore = usePanelSettingsStore()

const { dataSourceId, maskClouds, yMin, yMax, dataSource, allDataSources } =
  useTimeSeriesConfig({
    dataSourceId: userParams()?.dataSourceId,
    maskClouds: userParams()?.maskClouds,
    yMin: userParams()?.yMin ?? null,
    yMax: userParams()?.yMax ?? null,
  })

// ── Settings modal state ────────────────────────────────────────────────────

const showSettings = ref(false)
const pendingDataSourceId = ref(dataSourceId.value)
const pendingMaskClouds = ref(maskClouds.value)

function openSettings() {
  pendingDataSourceId.value = dataSourceId.value
  pendingMaskClouds.value = maskClouds.value
  showSettings.value = true
}

function applySettings() {
  dataSourceId.value = pendingDataSourceId.value
  maskClouds.value = pendingMaskClouds.value
  panelApi()?.setTitle(dataSource.value?.name ?? 'Time Series')
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

// ── Persist settings on change ──────────────────────────────────────────────

// Keep dockview params in sync so toJSON() captures current settings,
// then explicitly save — updateParameters() does not fire onDidLayoutChange.
watch([dataSourceId, maskClouds], () => {
  panelApi()?.updateParameters({
    dataSourceId: dataSourceId.value,
    maskClouds: maskClouds.value,
  })
  layoutStore.saveLayout()
})

// When dockview restores a layout via fromJSON(), it delivers params after
// the component mounts. Sync them back into the local refs.
watch(() => props.params?.params, (p) => {
  if (!p) return
  if (p.dataSourceId != null && p.dataSourceId !== dataSourceId.value)
    dataSourceId.value = p.dataSourceId
  if (p.maskClouds != null && p.maskClouds !== maskClouds.value)
    maskClouds.value = p.maskClouds
  nextTick(() => panelApi()?.setTitle(dataSource.value?.name ?? 'Time Series'))
})

onMounted(() => {
  if (dataSource.value) panelApi()?.setTitle(dataSource.value.name)
})

// ── Data & display ──────────────────────────────────────────────────────────

const { data, loading, error } = useTimeSeries(dataSource, maskClouds)

watch(data, (pts) => appStore.setChartDates(pts.filter(p => p.value !== null).map(p => p.date)), { immediate: true })

const flags = computed(() => appStore.flags)
const flagLabels = computed(() => appStore.flagLabels)

function onPointClick(date: string) {
  appStore.setSelectedDate(date)
}
</script>

<style scoped>
.ts-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--text);
}

.ts-chart-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

.ts-chart {
  width: 100%;
  height: 100%;
}

.selected-date-label {
  position: absolute;
  bottom: 24px;
  left: 52px;
  font-size: 0.78rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  letter-spacing: 0.03em;
  pointer-events: none;
  z-index: 1;
}

.ts-error {
  background: var(--bg-error);
  border-bottom: 1px solid var(--red);
  color: var(--red);
  font-size: 0.82rem;
  padding: 6px 10px;
  flex-shrink: 0;
}

.ts-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-muted);
  font-size: 0.9rem;
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

.field-select,
.field-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.85rem;
  padding: 6px 8px;
  outline: none;
}

.field-select:focus,
.field-input:focus {
  border-color: var(--accent);
}

.toggle-row {
  cursor: pointer;
  user-select: none;
}

</style>
