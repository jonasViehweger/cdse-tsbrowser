<template>
  <div class="labelling-form-panel">
    <div v-if="!campaignStore.isActive">
      <template v-if="sampleMetaEntries.length">
        <div class="form-header">
          <span class="sample-id">Sample data</span>
          <span class="status-badge incomplete">Read-only</span>
        </div>
        <div class="form-body">
          <div v-for="[key, value] in sampleMetaEntries" :key="key" class="field-row">
            <label class="field-label">{{ key }}</label>
            <span class="display-value">{{ value }}</span>
          </div>
        </div>
      </template>
      <div v-else class="empty-state">No campaign active.</div>
    </div>

    <template v-else>
      <div class="form-header">
        <span class="sample-id">{{ currentSampleId ?? 'No sample selected' }}</span>
        <span class="status-badge" :class="statusClass">{{ statusLabel }}</span>
      </div>

      <div v-if="currentSampleId" class="form-body">
        <div v-for="field in campaignStore.currentFields" :key="field.key" class="field-row">
          <label class="field-label">
            {{ field.label }}
            <span v-if="field.required" class="required-mark">*</span>
          </label>

          <span v-if="field.type === 'display'" class="display-value">
            {{ currentFeatureProps[field.key] ?? '—' }}
          </span>

          <input
            v-else-if="field.type === 'text'"
            :value="String(appStore.sampleMeta[field.key] ?? '')"
            type="text"
            class="field-input"
            @input="appStore.setMetaField(field.key, ($event.target as HTMLInputElement).value)"
          />

          <select
            v-else-if="field.type === 'select'"
            :value="appStore.sampleMeta[field.key] ?? ''"
            class="field-select"
            @change="appStore.setMetaField(field.key, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>Select…</option>
            <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
          </select>
        </div>
      </div>

      <div v-else class="empty-state">
        Click a sample on the Campaign Map to select it.
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'

const appStore = useAppStore()
const campaignStore = useCampaignStore()

const sampleMetaEntries = computed(() => Object.entries(appStore.sampleMeta))

const currentSampleId = computed<string | null>(() => {
  const [lon, lat] = appStore.coordinate
  const feat = campaignStore.features.find(
    f => f.geometry.coordinates[0] === lon && f.geometry.coordinates[1] === lat
  )
  return feat?.properties.sample_id ?? null
})

const currentFeatureProps = computed<Record<string, unknown>>(() => {
  const feat = campaignStore.features.find(f => f.properties.sample_id === currentSampleId.value)
  return (feat?.properties ?? {}) as Record<string, unknown>
})

const statusLabel = computed(() => {
  if (!currentSampleId.value) return ''
  return campaignStore.labellingStatus(currentSampleId.value) === 'complete' ? 'Complete' : 'Incomplete'
})

const statusClass = computed(() => {
  if (!currentSampleId.value) return ''
  return campaignStore.labellingStatus(currentSampleId.value) === 'complete' ? 'complete' : 'incomplete'
})

// Load record into appStore when selected sample changes.
// IDB is pre-loaded before mount (main.ts), so currentSampleId resolves
// immediately and there are no timing races.
watch(currentSampleId, (id, prevId) => {
  if (!id) {
    // Only wipe state when actively navigating away from a known sample.
    if (prevId != null) {
      appStore.setSampleMeta({})
      appStore.setFlags({})
    }
    return
  }
  // On first mount: if App.vue already set sampleMeta/flags from URL (e.g. a
  // shared URL with in-progress meta), keep them — they represent newer state.
  if (prevId == null &&
      (Object.keys(appStore.sampleMeta).length > 0 || Object.keys(appStore.flags).length > 0)) {
    if (campaignStore.schema?.flagLabels) appStore.setFlagLabels(campaignStore.schema.flagLabels)
    return
  }
  // Load from IDB (buildInitialRecord returns saved record or session pre-fills)
  const record = campaignStore.buildInitialRecord(id)
  const { flags: recordFlags, ...metaFields } = record
  appStore.setFlags((recordFlags as Record<string, string>) ?? {})
  appStore.setSampleMeta(metaFields as Record<string, unknown>)
  if (campaignStore.schema?.flagLabels) {
    appStore.setFlagLabels(campaignStore.schema.flagLabels)
  }
}, { immediate: true })
</script>

<style scoped>
.labelling-form-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  color: var(--text);
  font-size: 0.82rem;
}

.empty-state {
  padding: 16px 12px;
  color: var(--text-muted);
  font-style: italic;
}

.form-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.sample-id {
  font-weight: 600;
  color: var(--accent);
  flex: 1;
}

.status-badge {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.status-badge.complete {
  background: var(--bg-success);
  color: var(--green);
}

.status-badge.incomplete {
  background: var(--bg-warning);
  color: var(--orange);
}

.form-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 0.78rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.required-mark {
  color: var(--red);
  margin-left: 2px;
}

.display-value {
  color: var(--text-sub);
  padding: 2px 0;
}

.field-input,
.field-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 5px 8px;
  width: 100%;
}

.field-input:focus,
.field-select:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
