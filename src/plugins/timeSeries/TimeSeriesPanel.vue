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
        :y-mode="yMode"
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

      <label class="field-row">
        <span class="field-label">Y-axis</span>
        <select v-model="pendingYMode" class="field-select">
          <option v-for="m in Y_MODES" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
      </label>

      <div v-if="pendingYMode === 'manual'" class="field-row">
        <span class="field-label">Range</span>
        <input
          v-model="pendingYMin"
          type="number"
          step="any"
          placeholder="min"
          class="field-input"
        />
        <input
          v-model="pendingYMax"
          type="number"
          step="any"
          placeholder="max"
          class="field-input"
        />
      </div>

      <p v-if="manualRangeInvalid" class="field-hint">
        Enter a min below the max, or the axis will fall back to auto.
      </p>
      <p v-else-if="pendingYMode === 'robust'" class="field-hint">
        Ignores outliers (e.g. missed cloud/snow) when fitting the axis. Off-scale
        acquisitions are marked with a triangle at the plot edge.
      </p>
    </PanelSettingsModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { usePanelSettingsStore } from '../../stores/panelSettings'
import { useTimeSeries } from '../../composables/useTimeSeries'
import { useTimeSeriesConfig, Y_MODES, type YMode } from './useTimeSeriesConfig'
import { computeRobustRange } from '../../utils/chartData'
import TimeSeriesChart from './TimeSeriesChart.vue'
import PanelSettingsModal from '../../components/PanelSettingsModal.vue'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = {
  dataSourceId?: string
  maskClouds?: boolean
  yMode?: YMode
  yMin?: number | null
  yMax?: number | null
}
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

const { dataSourceId, maskClouds, yMode, yMin, yMax, dataSource, allDataSources } =
  useTimeSeriesConfig({
    dataSourceId: userParams()?.dataSourceId,
    maskClouds: userParams()?.maskClouds,
    yMode: userParams()?.yMode,
    yMin: userParams()?.yMin ?? null,
    yMax: userParams()?.yMax ?? null,
  })

// ── Settings modal state ────────────────────────────────────────────────────

const showSettings = ref(false)
const pendingDataSourceId = ref(dataSourceId.value)
const pendingMaskClouds = ref(maskClouds.value)
const pendingYMode = ref<YMode>(yMode.value)
// Kept as strings: <input type="number"> yields '' when cleared, which must
// stay distinguishable from a genuine 0.
const pendingYMin = ref(yMin.value?.toString() ?? '')
const pendingYMax = ref(yMax.value?.toString() ?? '')

function parseBound(s: string): number | null {
  const trimmed = s.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

const manualRangeInvalid = computed(() => {
  if (pendingYMode.value !== 'manual') return false
  const lo = parseBound(pendingYMin.value)
  const hi = parseBound(pendingYMax.value)
  if (lo == null || hi == null) return true
  return lo >= hi
})

function openSettings() {
  pendingDataSourceId.value = dataSourceId.value
  pendingMaskClouds.value = maskClouds.value
  pendingYMode.value = yMode.value
  pendingYMin.value = yMin.value?.toString() ?? ''
  pendingYMax.value = yMax.value?.toString() ?? ''
  showSettings.value = true
}

function applySettings() {
  dataSourceId.value = pendingDataSourceId.value
  maskClouds.value = pendingMaskClouds.value
  yMode.value = pendingYMode.value
  yMin.value = parseBound(pendingYMin.value)
  yMax.value = parseBound(pendingYMax.value)
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
watch([dataSourceId, maskClouds, yMode, yMin, yMax], () => {
  panelApi()?.updateParameters({
    dataSourceId: dataSourceId.value,
    maskClouds: maskClouds.value,
    yMode: yMode.value,
    yMin: yMin.value,
    yMax: yMax.value,
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
  if (p.yMode != null && p.yMode !== yMode.value) yMode.value = p.yMode
  // yMin/yMax are legitimately null in non-manual modes, so compare directly
  // rather than null-guarding — otherwise a cleared bound never restores.
  if (p.yMin !== undefined && p.yMin !== yMin.value) yMin.value = p.yMin
  if (p.yMax !== undefined && p.yMax !== yMax.value) yMax.value = p.yMax
  nextTick(() => panelApi()?.setTitle(dataSource.value?.name ?? 'Time Series'))
})

onMounted(() => {
  if (dataSource.value) panelApi()?.setTitle(dataSource.value.name)
})

// ── Data & display ──────────────────────────────────────────────────────────

const { data, loading, error } = useTimeSeries(dataSource, maskClouds)

// Switching to manual with empty fields: seed them from the range the user is
// currently looking at, so they adjust rather than guess from scratch.
watch(pendingYMode, (mode) => {
  if (mode !== 'manual') return
  if (pendingYMin.value !== '' || pendingYMax.value !== '') return
  const seed = computeRobustRange(data.value)
  if (!seed) return
  pendingYMin.value = seed[0].toPrecision(3)
  pendingYMax.value = seed[1].toPrecision(3)
})

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

.field-hint {
  margin: -8px 0 0 102px;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-muted);
}

</style>
