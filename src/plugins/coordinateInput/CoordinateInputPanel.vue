<template>
  <div class="coord-panel">
    <div class="section">
      <div class="section-heading">Current coordinate</div>
      <div class="current-coord">
        <span class="coord-value">{{ currentDisplay }}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-heading">Go to coordinate</div>
      <div class="input-row">
        <input
          ref="inputRef"
          v-model="inputValue"
          class="coord-input"
          type="text"
          placeholder="lat, lon  e.g. 47.3456, 15.0439"
          :class="{ 'input-error': parseError }"
          @keydown.enter="apply"
          @input="parseError = ''"
        />
        <button class="btn-apply" :disabled="!inputValue.trim()" @click="apply">Go</button>
      </div>
      <div v-if="parseError" class="error-msg">{{ parseError }}</div>
      <div class="hint">Format: <code>lat, lon</code> — e.g. <code>47.3456, 15.0439</code></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '../../stores/app'

const appStore = useAppStore()

const inputValue = ref('')
const parseError = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const currentDisplay = computed(() => {
  const [lon, lat] = appStore.coordinate
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
})

function apply() {
  const raw = inputValue.value.trim()
  if (!raw) return

  const parts = raw.split(',')
  if (parts.length !== 2) {
    parseError.value = 'Expected exactly two values separated by a comma.'
    return
  }

  const lat = parseFloat(parts[0].trim())
  const lon = parseFloat(parts[1].trim())

  if (isNaN(lat) || isNaN(lon)) {
    parseError.value = 'Could not parse numbers — check your input.'
    return
  }
  if (lat < -90 || lat > 90) {
    parseError.value = 'Latitude must be between −90 and 90.'
    return
  }
  if (lon < -180 || lon > 180) {
    parseError.value = 'Longitude must be between −180 and 180.'
    return
  }

  appStore.setCoordinate(lon, lat)
  inputValue.value = ''
  parseError.value = ''
  inputRef.value?.blur()
}
</script>

<style scoped>
.coord-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
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

.current-coord {
  display: flex;
  align-items: center;
}

.coord-value {
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.coord-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 5px 8px;
  outline: none;
}

.coord-input:focus {
  border-color: var(--accent);
}

.coord-input.input-error {
  border-color: var(--red);
}

.btn-apply {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 12px;
  white-space: nowrap;
}

.btn-apply:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-apply:disabled {
  opacity: 0.4;
  cursor: default;
}

.error-msg {
  margin-top: 5px;
  color: var(--red);
  font-size: 0.78rem;
}

.hint {
  margin-top: 6px;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.hint code {
  background: var(--bg-input);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 0.75rem;
}
</style>
