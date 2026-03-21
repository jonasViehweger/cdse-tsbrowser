<template>
  <div class="flag-editor">

    <!-- Selected date section -->
    <div class="section">
      <div class="section-heading">Selected date</div>

      <template v-if="selectedDate">
        <div class="date-row">
          <span class="date-value">{{ selectedDate }}</span>
          <template v-if="noFlagLabels">
            <span class="hint">No flag labels defined in URL.</span>
          </template>
          <template v-else>
            <select
              ref="flagSelectRef"
              v-model="pendingValue"
              class="flag-select"
              @change="applyFlag"
              @keydown.escape="flagSelectRef?.blur()"
            >
              <option value="" disabled>Select flag…</option>
              <option v-for="[val, lbl] in flagOptions" :key="val" :value="val">{{ lbl }}</option>
            </select>
            <button v-if="currentFlagValue !== undefined" class="btn-danger" @click="removeCurrentFlag">Remove</button>
          </template>
        </div>
      </template>

      <div v-else class="placeholder">
        Click a point in the time series to select a date.
      </div>
    </div>

    <!-- All flags list -->
    <div class="section flags-section">
      <div class="section-heading">
        All flags <span class="count">({{ flagCount }})</span>
      </div>
      <div v-if="flagCount === 0" class="placeholder">No flags set.</div>
      <div v-else class="flag-list">
        <div
          v-for="[date, value] in sortedFlags"
          :key="date"
          class="flag-row"
          :class="{ active: date === selectedDate }"
          @click="appStore.setSelectedDate(date)"
        >
          <span class="flag-dot" :style="{ background: colour(value) }"></span>
          <span class="flag-date">{{ date }}</span>
          <span class="flag-label-text">{{ label(value) }}</span>
          <button class="remove-small" @click.stop="appStore.removeFlag(date)">×</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { flagColour } from '../../utils/flagColour'

const appStore = useAppStore()
const flagSelectRef = ref<HTMLSelectElement | null>(null)

// Open the flag dropdown when a keyboard shortcut requests it.
// showPicker() implicitly focuses the element.
watch(() => appStore.flagDropdownFocusTick, () => {
  flagSelectRef.value?.showPicker()
})

const selectedDate = computed(() => appStore.selectedDate)
const flags = computed(() => appStore.flags)
const flagLabels = computed(() => appStore.flagLabels)

const noFlagLabels = computed(() => Object.keys(flagLabels.value).length === 0)

const flagOptions = computed((): [string, string][] =>
  Object.entries(flagLabels.value).map(([val, lbl]) => [val, `${val} — ${lbl}`])
)

const currentFlagValue = computed(() =>
  selectedDate.value ? flags.value[selectedDate.value] : undefined
)

const flagCount = computed(() => Object.keys(flags.value).length)

const sortedFlags = computed(() =>
  Object.entries(flags.value).sort(([a], [b]) => a.localeCompare(b))
)

// pendingValue tracks the current dropdown selection
const pendingValue = ref('')

// Sync dropdown to the actual flag value whenever the selected date changes
watch(selectedDate, () => {
  pendingValue.value = currentFlagValue.value ?? ''
}, { immediate: true })

function applyFlag() {
  if (selectedDate.value && pendingValue.value) {
    appStore.setFlag(selectedDate.value, pendingValue.value)
  }
  flagSelectRef.value?.blur()
}

function removeCurrentFlag() {
  if (selectedDate.value) {
    appStore.removeFlag(selectedDate.value)
  }
}

function colour(value: string) {
  return flagColour(value, flagLabels.value, flags.value)
}

function label(value: string) {
  return flagLabels.value[value] ? `${value} — ${flagLabels.value[value]}` : value
}
</script>

<style scoped>
.flag-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  color: var(--text);
  font-size: 0.82rem;
}

.section {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.section-heading {
  font-weight: 600;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.count {
  font-weight: 400;
  color: var(--border-mid);
}

.date-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.date-value {
  font-weight: 600;
  color: var(--accent);
  min-width: 90px;
}

.flag-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 3px 6px;
  flex: 1;
  min-width: 120px;
}

.btn-danger {
  background: transparent;
  border: 1px solid var(--red);
  border-radius: 4px;
  color: var(--red);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 3px 8px;
}

.btn-danger:hover {
  background: color-mix(in srgb, var(--red) 12%, transparent);
}

.hint {
  color: var(--text-muted);
  font-style: italic;
}

.placeholder {
  color: var(--text-muted);
  font-style: italic;
}

.flags-section {
  flex: 1;
  overflow-y: auto;
  border-bottom: none;
}

.flag-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.flag-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.flag-row:hover {
  background: var(--bg-input);
}

.flag-row.active {
  background: var(--bg-input);
  outline: 1px solid var(--border-mid);
}

.flag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.flag-date {
  min-width: 90px;
  color: var(--accent);
}

.flag-label-text {
  flex: 1;
  color: var(--text-sub);
}

.remove-small {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 2px;
}

.remove-small:hover {
  color: var(--red);
}
</style>
