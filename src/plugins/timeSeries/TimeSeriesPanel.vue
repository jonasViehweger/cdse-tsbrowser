<template>
  <div class="ts-panel">
    <div class="ts-panel-toolbar">
      <select v-model="dataSourceId" class="ds-select">
        <option v-for="ds in allDataSources" :key="ds.id" :value="ds.id">{{ ds.name }}</option>
      </select>

      <label class="toggle-label">
        <input v-model="maskClouds" type="checkbox" />
        Cloud mask
      </label>

      <span class="yrange-label">Y:</span>
      <input
        v-model.number="yMinInput"
        type="number"
        class="yrange-input"
        placeholder="auto"
        step="0.1"
        @change="applyYLimits"
      />
      <span class="yrange-sep">–</span>
      <input
        v-model.number="yMaxInput"
        type="number"
        class="yrange-input"
        placeholder="auto"
        step="0.1"
        @change="applyYLimits"
      />

      <span class="selected-date">
        {{ appStore.selectedDate ?? '—' }}
      </span>

      <button class="refetch-btn" :disabled="loading" @click="refetch()">
        {{ loading ? '…' : '↺' }}
      </button>
    </div>

    <div v-if="error" class="ts-error">{{ error }}</div>

    <div v-if="loading && data.length === 0" class="ts-loading">Loading…</div>

    <TimeSeriesChart
      v-if="!loading || data.length > 0"
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
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useLayoutStore } from '../../stores/layout'
import { useTimeSeries } from '../../composables/useTimeSeries'
import { useTimeSeriesConfig } from './useTimeSeriesConfig'
import TimeSeriesChart from './TimeSeriesChart.vue'

// dockview-vue passes a single `params` prop containing both the user-defined
// params (under params.params) and the panel API (under params.api).
type UserParams = { dataSourceId?: string; maskClouds?: boolean; yMin?: number | null; yMax?: number | null }
type PanelApi = { updateParameters(p: Record<string, unknown>): void }

const props = defineProps<{
  params?: { params?: UserParams; api?: PanelApi }
}>()

const panelApi = () => props.params?.api
const userParams = () => props.params?.params

const appStore = useAppStore()
const layoutStore = useLayoutStore()

const { dataSourceId, maskClouds, yMin, yMax, dataSource, allDataSources } =
  useTimeSeriesConfig({
    dataSourceId: userParams()?.dataSourceId,
    maskClouds: userParams()?.maskClouds,
    yMin: userParams()?.yMin ?? null,
    yMax: userParams()?.yMax ?? null,
  })

// Keep dockview params in sync so toJSON() captures current settings,
// then explicitly save — updateParameters() does not fire onDidLayoutChange.
watch([dataSourceId, maskClouds, yMin, yMax], () => {
  panelApi()?.updateParameters({
    dataSourceId: dataSourceId.value,
    maskClouds: maskClouds.value,
    yMin: yMin.value,
    yMax: yMax.value,
  })
  layoutStore.saveLayout()
})

// When dockview restores a layout via fromJSON(), it delivers params after
// the component mounts. Sync them back into local refs so the panel reflects
// the stored configuration. Equality checks prevent a feedback loop with the
// watch above.
watch(() => props.params?.params, (p) => {
  if (!p) return
  if (p.dataSourceId != null && p.dataSourceId !== dataSourceId.value)
    dataSourceId.value = p.dataSourceId
  if (p.maskClouds != null && p.maskClouds !== maskClouds.value)
    maskClouds.value = p.maskClouds
  if (p.yMin !== undefined && p.yMin !== yMin.value) {
    yMin.value = p.yMin ?? null
    yMinInput.value = p.yMin ?? ''
  }
  if (p.yMax !== undefined && p.yMax !== yMax.value) {
    yMax.value = p.yMax ?? null
    yMaxInput.value = p.yMax ?? ''
  }
})

const { data, loading, error, refetch } = useTimeSeries(dataSource, maskClouds)

// Publish visible (non-null) dates to the store for keyboard navigation.
// This respects cloud masking and any future data modifiers — navigation
// only lands on dates that are actually plotted.
watch(data, (pts) => appStore.setChartDates(pts.filter(p => p.value !== null).map(p => p.date)), { immediate: true })

const flags = computed(() => appStore.flags)
const flagLabels = computed(() => appStore.flagLabels)

// Initialise Y-limit inputs from restored params
const yMinInput = ref<number | ''>(userParams()?.yMin ?? '')
const yMaxInput = ref<number | ''>(userParams()?.yMax ?? '')

function applyYLimits() {
  yMin.value = yMinInput.value === '' ? null : Number(yMinInput.value)
  yMax.value = yMaxInput.value === '' ? null : Number(yMaxInput.value)
}

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

.ts-panel-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.selected-date {
  margin: 0 auto;
  font-size: 0.88rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  letter-spacing: 0.03em;
}

.ds-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.8rem;
  padding: 3px 6px;
  outline: none;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text-sub);
  cursor: pointer;
  user-select: none;
}

.yrange-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.yrange-input {
  width: 60px;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.8rem;
  padding: 3px 6px;
  outline: none;
}

.yrange-sep {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.refetch-btn {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 3px 8px;
  margin-left: auto;
}

.refetch-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.refetch-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.ts-chart {
  flex: 1;
  min-height: 0;
}
</style>
