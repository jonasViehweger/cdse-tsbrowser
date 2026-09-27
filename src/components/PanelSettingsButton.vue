<template>
  <div class="group-actions">
    <button
      v-if="!isPopout"
      class="action-btn"
      title="Pop out into separate window"
      @click="handlePopout"
    >
      ↗
    </button>
    <button
      v-if="canDownload"
      class="action-btn"
      title="Download displayed data as CSV"
      @click="handleDownload"
    >
      ↓
    </button>
    <button
      class="action-btn"
      :disabled="!canOpenSettings"
      :title="canOpenSettings ? undefined : 'No settings for this panel'"
      @click="handleSettings"
    >
      Settings ⚙
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePanelSettingsStore } from '../stores/panelSettings'

// dockview-vue wraps header action props in a `params` object.
// We only use the fields we need; the rest are typed loosely.
const props = defineProps<{
  params?: {
    activePanel?: { id: string } | null
    isGroupActive?: boolean
    group?: { api?: { location?: { type?: string } } }
    containerApi?: { addPopoutGroup: (group: unknown) => void }
  }
}>()

const settingsStore = usePanelSettingsStore()

const activePanelId = computed(() => props.params?.activePanel?.id)

const canOpenSettings = computed(() => {
  const id = activePanelId.value
  return !!id && settingsStore.has(id, 'settings')
})

const canDownload = computed(() => {
  const id = activePanelId.value
  return !!id && settingsStore.has(id, 'download')
})

const isPopout = computed(() =>
  props.params?.group?.api?.location?.type === 'popout'
)

function handleSettings() {
  const id = activePanelId.value
  if (id) settingsStore.run(id, 'settings')
}

function handleDownload() {
  const id = activePanelId.value
  if (id) settingsStore.run(id, 'download')
}

function handlePopout() {
  const { containerApi, group } = props.params ?? {}
  if (containerApi && group) containerApi.addPopoutGroup(group)
}
</script>

<style scoped>
.group-actions {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 2px;
  padding-right: 4px;
}

.action-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 7px;
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  transition: color 0.1s;
  border-radius: 3px;
}

.action-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover);
}

.action-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
