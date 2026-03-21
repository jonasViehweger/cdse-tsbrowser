import { useAuthStore } from '../stores/auth'

const TOKEN_ENDPOINT = `${import.meta.env.VITE_AUTH_BASE}/auth/realms/CDSE/protocol/openid-connect/token`

export async function fetchToken(clientId: string, clientSecret: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    let message: string
    try {
      const err = await response.json() as { error_description?: string; error?: string }
      message = err.error_description ?? err.error ?? `HTTP ${response.status}`
    } catch {
      message = await response.text().catch(() => `HTTP ${response.status}`)
    }
    throw new Error(message)
  }

  const json = await response.json() as { access_token: string; expires_in: number }
  const authStore = useAuthStore()
  authStore.storeToken(json.access_token, json.expires_in)
}

export async function getValidToken(): Promise<string> {
  const authStore = useAuthStore()

  if (
    authStore.accessToken &&
    authStore.tokenExpiresAt !== null &&
    Date.now() < authStore.tokenExpiresAt
  ) {
    return authStore.accessToken
  }

  if (!authStore.clientId || !authStore.clientSecret) {
    throw new Error('No credentials configured. Please open Settings and enter your CDSE credentials.')
  }

  await fetchToken(authStore.clientId, authStore.clientSecret)

  if (!authStore.accessToken) {
    throw new Error('Token fetch succeeded but no token was stored.')
  }

  return authStore.accessToken
}
