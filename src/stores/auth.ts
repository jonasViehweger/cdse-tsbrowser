import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'cdse-credentials'

export const useAuthStore = defineStore('auth', () => {
  const clientId = ref('')
  const clientSecret = ref('')
  const accessToken = ref<string | null>(null)
  const tokenExpiresAt = ref<number | null>(null)

  const isAuthenticated = computed(() => {
    return accessToken.value !== null &&
      tokenExpiresAt.value !== null &&
      Date.now() < tokenExpiresAt.value
  })

  function setCredentials(id: string, secret: string) {
    clientId.value = id
    clientSecret.value = secret
  }

  function storeToken(token: string, expiresIn: number) {
    accessToken.value = token
    tokenExpiresAt.value = Date.now() + (expiresIn - 60) * 1000
  }

  function clearToken() {
    accessToken.value = null
    tokenExpiresAt.value = null
  }

  /** Returns true if credentials were found and loaded. */
  function loadPersisted(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const { clientId: id, clientSecret: secret } = JSON.parse(raw)
      if (id && secret) { clientId.value = id; clientSecret.value = secret; return true }
    } catch {}
    return false
  }

  function savePersisted() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clientId: clientId.value, clientSecret: clientSecret.value }))
  }

  function clearPersisted() {
    localStorage.removeItem(STORAGE_KEY)
  }

  function isPersisted(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null
  }

  return {
    clientId,
    clientSecret,
    accessToken,
    tokenExpiresAt,
    isAuthenticated,
    setCredentials,
    storeToken,
    clearToken,
    loadPersisted,
    savePersisted,
    clearPersisted,
    isPersisted,
  }
})
