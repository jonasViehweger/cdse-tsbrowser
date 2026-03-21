import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

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

  return {
    clientId,
    clientSecret,
    accessToken,
    tokenExpiresAt,
    isAuthenticated,
    setCredentials,
    storeToken,
    clearToken,
  }
})
