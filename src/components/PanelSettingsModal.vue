<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="$emit('cancel')">
      <div class="settings-dialog">
        <div class="settings-header">
          <span class="settings-title">{{ title }}</span>
          <button class="close-btn" @click="$emit('cancel')">✕</button>
        </div>
        <div class="settings-body">
          <slot />
        </div>
        <div class="settings-footer">
          <button class="btn btn-secondary" @click="$emit('cancel')">Cancel</button>
          <button class="btn btn-primary" @click="$emit('apply')">Apply</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
defineEmits<{ cancel: []; apply: [] }>()
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-dialog {
  background: var(--bg);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 24px;
  width: 360px;
  max-width: 90vw;
  color: var(--text);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.settings-title {
  font-size: 1rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
  line-height: 1;
}

.close-btn:hover {
  color: var(--text);
}

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 8px 16px;
}

.btn-primary {
  background: var(--accent);
  color: var(--bg);
  font-weight: 600;
}

.btn-primary:hover {
  background: color-mix(in srgb, var(--accent) 80%, white);
}

.btn-secondary {
  background: var(--bg-input);
  color: var(--text);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}
</style>
