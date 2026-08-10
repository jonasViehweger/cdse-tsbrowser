import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { CampaignGeoJSON, GithubSource } from '../types/campaign'
import { fetchCampaignFile, putCampaignFile, fetchLogin, GithubError } from '../services/githubApi'
import { saveCampaignSource, loadCampaignSource } from '../utils/campaignIdb'
import { useCampaignStore } from './campaign'
import { useAppStore } from './app'

const STORAGE_KEY = 'github-token'

export const useGithubStore = defineStore('github', () => {
  /** Fine-grained PAT. Empty string = anonymous (public repos, read-only). */
  const token = ref('')

  /** Account the token belongs to, once verified. */
  const login = ref<string | null>(null)

  /** Where a campaign is synced to. null = no GitHub source loaded. */
  const source = ref<GithubSource | null>(null)

  /**
   * Which campaign `source` belongs to.
   *
   * A file pointer is only meaningful for the campaign it was pulled for, so
   * everything downstream goes through `hasSource`, which requires this to match
   * the active campaign. Without that, switching campaigns would leave the old
   * pointer in place and a push would commit the new campaign into the old file.
   */
  const sourceCampaign = ref<string | null>(null)

  const status = ref<'idle' | 'pulling' | 'pushing'>('idle')
  const error = ref<string | null>(null)
  const lastSyncedAt = ref<number | null>(null)

  /**
   * Campaign revision that matches what's currently in the file on GitHub.
   * Anything past it is local work that hasn't been pushed.
   */
  const syncedRevision = ref(-1)

  const campaignStore = useCampaignStore()
  const appStore = useAppStore()

  const isConnected = computed(() => login.value !== null)
  const isBusy = computed(() => status.value !== 'idle')

  /** True only when the pointer belongs to the campaign that's actually open. */
  const hasSource = computed(() =>
    source.value !== null && sourceCampaign.value === campaignStore.schema?.name
  )
  const isDirty = computed(() =>
    hasSource.value && campaignStore.revision !== syncedRevision.value
  )
  /** Pushing needs write access; anonymous reads are fine. */
  const canPush = computed(() => hasSource.value && token.value !== '')

  // ── Token persistence ──────────────────────────────────────────────────────

  function loadPersisted(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) { token.value = raw; return true }
    } catch { /* storage unavailable */ }
    return false
  }

  function savePersisted() {
    try { localStorage.setItem(STORAGE_KEY, token.value) } catch { /* quota */ }
  }

  function clearPersisted() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* storage unavailable */ }
  }

  function isPersisted(): boolean {
    try { return localStorage.getItem(STORAGE_KEY) !== null } catch { return false }
  }

  /** Verify a token and remember the account it belongs to. */
  async function connect(newToken: string, remember: boolean): Promise<void> {
    error.value = null
    const verified = await fetchLogin(newToken).catch((e: unknown) => {
      error.value = messageOf(e)
      throw e
    })
    token.value = newToken
    login.value = verified
    if (remember) savePersisted()
    else clearPersisted()
  }

  function disconnect() {
    token.value = ''
    login.value = null
    clearPersisted()
  }

  /**
   * Restore a persisted token at startup. The token is usable immediately;
   * verification runs in the background so a stale one never delays mount —
   * it just leaves the account unshown and fails at the first real request.
   */
  function init(): void {
    if (!loadPersisted()) return
    fetchLogin(token.value)
      .then(l => { login.value = l })
      .catch(() => { login.value = null })
  }

  // ── Sync ───────────────────────────────────────────────────────────────────

  function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  /**
   * Bumped whenever the source is set directly. An in-flight `restoreSource`
   * compares against it and drops its result if anything moved on meanwhile,
   * so a slow IDB read can't overwrite a source that was just pulled.
   */
  let sourceSeq = 0

  function setSource(src: GithubSource, campaignName: string, revision: number) {
    sourceSeq++
    source.value = src
    sourceCampaign.value = campaignName
    syncedRevision.value = revision
    lastSyncedAt.value = Date.now()
    saveCampaignSource(campaignName, src).catch(() => {})
  }

  /**
   * Fetch the campaign file and load it.
   *
   * By default local labels win over the file's, so pulling never destroys
   * unpushed work; `prefer: 'remote'` is the explicit "discard mine" path.
   */
  async function pull(src: GithubSource, opts?: { prefer?: 'local' | 'remote' }): Promise<void> {
    status.value = 'pulling'
    error.value = null
    try {
      const { text, sha } = await fetchCampaignFile(src, token.value || undefined)

      let geojson: CampaignGeoJSON
      try {
        geojson = JSON.parse(text) as CampaignGeoJSON
      } catch {
        throw new GithubError(`${src.path} is not valid JSON.`, 'other')
      }
      if (geojson.type !== 'FeatureCollection') {
        throw new GithubError(`${src.path} is not a GeoJSON FeatureCollection.`, 'other')
      }
      if (!geojson.campaign) {
        throw new GithubError(
          `${src.path} has no top-level "campaign" key — it isn't a campaign file.`,
          'other',
        )
      }

      const { fileRevision } = await campaignStore.loadGeoJSON(geojson, opts)

      setSource({ ...src, sha }, geojson.campaign.name, fileRevision)
    } catch (e) {
      error.value = messageOf(e)
      throw e
    } finally {
      status.value = 'idle'
    }
  }

  /** Re-pull the current source. */
  async function refresh(opts?: { prefer?: 'local' | 'remote' }): Promise<void> {
    if (!hasSource.value) throw new Error('No GitHub source configured for this campaign.')
    await pull(source.value!, opts)
  }

  /** Commit the current campaign state back to its file. */
  async function push(message?: string): Promise<void> {
    if (!hasSource.value) throw new Error('No GitHub source configured for this campaign.')
    if (!token.value) throw new Error('Connect a GitHub token to push.')

    status.value = 'pushing'
    error.value = null
    try {
      const geojson = campaignStore.exportGeoJSON(appStore.startDate, appStore.endDate)
      const text = JSON.stringify(geojson, null, 2) + '\n'

      // Capture before the request: labelling can continue while it's in flight,
      // and that later work is genuinely unpushed.
      const pushedRevision = campaignStore.revision

      const sha = await putCampaignFile(source.value!, text, message ?? defaultMessage(), token.value)

      setSource({ ...source.value!, sha }, geojson.campaign.name, pushedRevision)
    } catch (e) {
      if (e instanceof GithubError && e.kind === 'conflict') {
        error.value = 'The file changed on GitHub since you last pulled. Pull first, then push again.'
      } else {
        error.value = messageOf(e)
      }
      throw e
    } finally {
      status.value = 'idle'
    }
  }

  function defaultMessage(): string {
    const name = campaignStore.schema?.name ?? 'campaign'
    const total = campaignStore.features.length
    const done = campaignStore.features.filter(
      f => campaignStore.labellingStatus(f.properties.sample_id) === 'complete'
    ).length
    return `Update ${name} labels (${done}/${total} complete)`
  }

  /**
   * Reconnect a campaign to the file it was last pulled from, or drop the
   * pointer when it has none. Nothing has been checked against the remote this
   * session, so the campaign is treated as unpushed rather than claimed in sync.
   */
  async function restoreSource(campaignName: string): Promise<void> {
    const seq = ++sourceSeq
    const stored = await loadCampaignSource(campaignName).catch(() => null)
    // A pull (or another switch) landed while IDB was reading — that wins.
    if (seq !== sourceSeq) return
    if (campaignStore.schema?.name !== campaignName) return

    source.value = stored
    sourceCampaign.value = stored ? campaignName : null
    syncedRevision.value = -1
    lastSyncedAt.value = null
  }

  function clearSource() {
    sourceSeq++
    source.value = null
    sourceCampaign.value = null
    syncedRevision.value = -1
    lastSyncedAt.value = null
    error.value = null
  }

  /**
   * Follow the active campaign. Switching campaigns from the toolbar, renaming
   * one in the admin panel, or loading a file all land here, so no panel has to
   * remember to reconnect or clear the pointer itself.
   *
   * A pull sets its own source, and it changes the campaign name on the way —
   * so while one is in flight this stays out of the way.
   */
  watch(() => campaignStore.schema?.name, (name) => {
    if (status.value !== 'idle') return
    if (name === sourceCampaign.value) return
    if (!name) { clearSource(); return }
    restoreSource(name)
  })

  return {
    token,
    login,
    source,
    sourceCampaign,
    status,
    error,
    lastSyncedAt,
    isConnected,
    hasSource,
    isBusy,
    isDirty,
    canPush,
    init,
    connect,
    disconnect,
    isPersisted,
    pull,
    refresh,
    push,
    restoreSource,
    clearSource,
  }
})
