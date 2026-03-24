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

const canOpenSettings = computed(() => {
  const id = props.params?.activePanel?.id
  return !!id && settingsStore.hasSettings(id)
})

const isPopout = computed(() =>
  props.params?.group?.api?.location?.type === 'popout'
)

function handleSettings() {
  const id = props.params?.activePanel?.id
  if (id) settingsStore.openFor(id)
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
