<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h2>CDSE Credentials</h2>
        <button class="close-btn" @click="$emit('close')">✕</button>
      </div>

      <p class="modal-description">
        Enter your Copernicus Dataspace OAuth2 client credentials.
        See <a href="https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html" target="_blank" rel="noopener">the docs</a> on how to create them.
        Make sure to check <strong>Will be used by single-page application</strong> and allow all domains (<strong>*</strong>).
      </p>

      <div class="form-group">
        <label for="client-id">Client ID</label>
        <input
          id="client-id"
          v-model="localClientId"
          type="text"
          placeholder="your-client-id"
          autocomplete="username"
        />
      </div>

      <div class="form-group">
        <label for="client-secret">Client Secret</label>
        <input
          id="client-secret"
          v-model="localClientSecret"
          type="password"
          placeholder="your-client-secret"
          autocomplete="current-password"
        />
      </div>

      <label class="remember-label">
        <input v-model="localRemember" type="checkbox" />
        Remember me (saves credentials to localStorage)
      </label>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="modal-actions">
        <button
          v-if="authStore.isAuthenticated"
          class="btn btn-secondary"
          @click="disconnect"
        >
          Disconnect
        </button>
        <button
          class="btn btn-primary"
          :disabled="loading || !localClientId || !localClientSecret"
          @click="saveAndConnect"
        >
          <span v-if="loading">Connecting…</span>
          <span v-else>Save and Connect</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { fetchToken } from '../services/auth'

defineEmits<{ close: [] }>()

const authStore = useAuthStore()

const localClientId = ref(authStore.clientId)
const localClientSecret = ref(authStore.clientSecret)
const localRemember = ref(authStore.isPersisted())
const loading = ref(false)
const error = ref<string | null>(null)

async function saveAndConnect() {
  error.value = null
  loading.value = true
  try {
    authStore.setCredentials(localClientId.value, localClientSecret.value)
    await fetchToken(localClientId.value, localClientSecret.value)
    if (localRemember.value) authStore.savePersisted()
    else authStore.clearPersisted()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    loading.value = false
    return
  }
  loading.value = false
}

function disconnect() {
  authStore.clearToken()
  authStore.setCredentials('', '')
  authStore.clearPersisted()
  localClientId.value = ''
  localClientSecret.value = ''
  localRemember.value = false
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-card {
  background: var(--bg);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  padding: 24px;
  width: 420px;
  max-width: 90vw;
  color: var(--text);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.1rem;
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

.modal-description {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 20px;
  line-height: 1.5;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 6px;
  color: var(--text-sub);
}

.form-group input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-panel);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  padding: 8px 10px;
  font-size: 0.9rem;
  outline: none;
}

.form-group input:focus {
  border-color: var(--accent);
}

.modal-description a {
  color: var(--accent);
  text-decoration: underline;
}

.remember-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-bottom: 16px;
  cursor: pointer;
  user-select: none;
}

.error-message {
  background: var(--bg-error);
  border: 1px solid var(--red);
  border-radius: 4px;
  color: var(--red);
  font-size: 0.85rem;
  padding: 8px 12px;
  margin-bottom: 16px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 8px 16px;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: var(--bg);
  font-weight: 600;
}

.btn-primary:not(:disabled):hover {
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
