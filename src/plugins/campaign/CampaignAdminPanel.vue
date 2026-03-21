<template>
  <div class="admin-panel">

    <!-- Campaign name -->
    <div class="section">
      <div class="section-heading">Campaign</div>
      <div class="field-row">
        <label class="field-label">Name</label>
        <input v-model="name" type="text" class="field-input" placeholder="Campaign name…" />
      </div>
    </div>

    <!-- Flag labels -->
    <div class="section">
      <div class="section-heading">Flag Labels</div>
      <div v-for="(entry, idx) in flagEntries" :key="idx" class="kv-row">
        <input v-model="entry.key" type="text" class="kv-input" placeholder="value" />
        <span class="kv-sep">→</span>
        <input v-model="entry.label" type="text" class="kv-input" placeholder="label" />
        <button class="remove-btn" @click="removeFlagEntry(idx)">×</button>
      </div>
      <button class="btn-secondary" @click="addFlagEntry">+ Add flag</button>
    </div>

    <!-- Field schema -->
    <div class="section">
      <div class="section-heading">Fields</div>
      <div v-for="(field, idx) in fields" :key="idx" class="field-def">
        <div class="field-def-row">
          <input v-model="field.key" type="text" class="kv-input" placeholder="key" />
          <input v-model="field.label" type="text" class="kv-input" placeholder="label" />
          <select v-model="field.type" class="type-select">
            <option value="display">display</option>
            <option value="text">text</option>
            <option value="select">select</option>
          </select>
          <button class="remove-btn" @click="removeField(idx)">×</button>
        </div>
        <div class="field-def-opts">
          <label class="check-label">
            <input type="checkbox" v-model="field.required" /> Required
          </label>
          <label class="check-label">
            <input type="checkbox" v-model="field.session_persistent" /> Session persistent
          </label>
          <div v-if="field.type === 'select'" class="options-row">
            <span class="field-label">Options (comma-separated)</span>
            <input
              :value="(field.options ?? []).join(', ')"
              type="text"
              class="field-input"
              placeholder="High, Medium, Low"
              @change="(e) => field.options = (e.target as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)"
            />
          </div>
        </div>
      </div>
      <button class="btn-secondary" @click="addField">+ Add field</button>
    </div>

    <!-- Apply -->
    <div class="section">
      <button class="btn-primary" :disabled="!name.trim()" @click="apply">Apply Campaign</button>
      <button v-if="campaignStore.isActive" class="btn-danger" style="margin-left:8px" @click="campaignStore.clear()">Clear</button>
      <p v-if="applied" class="success-text">Campaign schema applied.</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import type { CampaignField } from '../../types/campaign'

const appStore = useAppStore()
const campaignStore = useCampaignStore()

interface FlagEntry { key: string; label: string }
interface FieldDef extends Omit<CampaignField, 'options'> { options?: string[] }

const name = ref('')
const flagEntries = ref<FlagEntry[]>([])
const fields = ref<FieldDef[]>([])
const applied = ref(false)

// Populate from existing campaign when panel opens
watch(() => campaignStore.schema, (schema) => {
  if (!schema) return
  name.value = schema.name
  flagEntries.value = Object.entries(schema.flagLabels ?? {}).map(([key, label]) => ({ key, label }))
  fields.value = (schema.fields ?? []).map(f => ({ ...f }))
}, { immediate: true })

function addFlagEntry() { flagEntries.value.push({ key: '', label: '' }) }
function removeFlagEntry(idx: number) { flagEntries.value.splice(idx, 1) }

function addField() {
  fields.value.push({ key: '', label: '', type: 'text', required: false, session_persistent: false })
}
function removeField(idx: number) { fields.value.splice(idx, 1) }

function apply() {
  const flagLabels: Record<string, string> = {}
  for (const e of flagEntries.value) {
    if (e.key.trim()) flagLabels[e.key.trim()] = e.label.trim()
  }
  campaignStore.setSchema({
    name: name.value.trim(),
    flagLabels,
    fields: fields.value.map(f => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      required: f.required,
      session_persistent: f.session_persistent,
    })) as CampaignField[],
  })
  appStore.setFlagLabels(flagLabels)
  applied.value = true
  setTimeout(() => { applied.value = false }, 2000)
}
</script>

<style scoped>
.admin-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
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

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}

.field-label {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.field-input {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 4px 8px;
  width: 100%;
}

.kv-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.kv-input {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  padding: 3px 6px;
  flex: 1;
  min-width: 0;
}

.kv-sep {
  color: var(--text-muted);
  flex-shrink: 0;
}

.remove-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 2px;
  flex-shrink: 0;
}

.remove-btn:hover { color: var(--red); }

.btn-secondary {
  background: transparent;
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text-sub);
  cursor: pointer;
  font-size: 0.78rem;
  margin-top: 4px;
  padding: 3px 10px;
}

.btn-secondary:hover { background: var(--border); }

.btn-primary {
  background: var(--accent);
  border: none;
  border-radius: 4px;
  color: var(--bg);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 5px 14px;
}

.btn-primary:disabled { opacity: 0.4; cursor: default; }

.btn-danger {
  background: transparent;
  border: 1px solid var(--red);
  border-radius: 4px;
  color: var(--red);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 10px;
}

.field-def {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  margin-bottom: 6px;
}

.field-def-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.type-select {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.78rem;
  padding: 3px 4px;
}

.field-def-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.check-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-sub);
  font-size: 0.78rem;
  cursor: pointer;
}

.options-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.success-text {
  color: var(--green);
  margin-top: 6px;
}
</style>
