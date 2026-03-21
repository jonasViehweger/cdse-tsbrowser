<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">Keyboard Shortcuts</span>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>
      <div class="modal-body">
        <table class="shortcuts-table">
          <tbody>
            <tr v-for="s in shortcuts" :key="s.key">
              <td class="key-cell">
                <kbd v-for="k in s.keys" :key="k" class="key">{{ k }}</kbd>
              </td>
              <td class="desc-cell">{{ s.description }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{ close: [] }>()

const shortcuts = [
  { keys: ['←', '→'],      description: 'Previous / next observed date' },
  { keys: ['↑'],            description: 'Jump forward one year (nearest date)' },
  { keys: ['↓'],            description: 'Jump backward one year (nearest date)' },
  { keys: ['f'],            description: 'Focus flag dropdown for selected date' },
  { keys: ['r'],            description: 'Remove flag from selected date' },
  { keys: ['n'],            description: 'Save & Next (campaign labelling)' },
  { keys: ['?'],            description: 'Toggle this help panel' },
]
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.modal {
  background: var(--bg);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  min-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0 2px;
}

.close-btn:hover {
  color: var(--text);
}

.modal-body {
  padding: 12px 16px 16px;
}

.shortcuts-table {
  border-collapse: collapse;
  width: 100%;
}

.shortcuts-table tr + tr td {
  border-top: 1px solid var(--border);
}

.key-cell {
  padding: 7px 16px 7px 0;
  white-space: nowrap;
  width: 1%;
}

.desc-cell {
  padding: 7px 0;
  color: var(--text-sub);
  font-size: 0.82rem;
}

.key {
  display: inline-block;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-bottom-width: 2px;
  border-radius: 4px;
  color: var(--text);
  font-family: inherit;
  font-size: 0.78rem;
  line-height: 1;
  padding: 3px 7px;
  margin-right: 3px;
}
</style>
