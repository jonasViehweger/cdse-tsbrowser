<template>
  <div class="upload-panel">
    <div class="section">
      <div class="section-heading">Upload GeoJSON</div>
      <p class="hint">Load a campaign GeoJSON or a minimal point GeoJSON (coordinates + sample_id) to start a new campaign.</p>
      <label class="file-label">
        <input type="file" accept=".geojson,.json" class="file-input" @change="onFileChange" />
        <span class="file-btn">Choose file…</span>
      </label>
      <p v-if="uploadError" class="error-text">{{ uploadError }}</p>
      <p v-if="uploadSuccess" class="success-text">{{ uploadSuccess }}</p>
    </div>

    <div class="section">
      <div class="section-heading">GitHub</div>

      <template v-if="githubStore.isConnected">
        <p class="hint">
          Connected as <strong>{{ githubStore.login }}</strong>
          — <button class="link-btn" @click="githubStore.disconnect()">disconnect</button>
        </p>
      </template>
      <template v-else>
        <p class="hint">
          Public repositories can be loaded without a token. For private repositories or for
          pushing, connect a
          <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">fine-grained token</a>
          scoped to the campaign repository with <strong>Contents: read and write</strong>.
        </p>
        <div class="field-row">
          <input
            v-model="tokenInput"
            type="password"
            class="text-input"
            placeholder="github_pat_…"
            autocomplete="off"
          />
          <button class="btn-secondary" :disabled="!tokenInput || connecting" @click="doConnect">
            {{ connecting ? 'Checking…' : 'Connect' }}
          </button>
        </div>
        <label class="check-label">
          <input v-model="rememberToken" type="checkbox" />
          Remember token (saves it to localStorage)
        </label>
      </template>

      <div class="field-label">Campaign file</div>
      <div class="field-row">
        <input
          v-model="sourceSpec"
          type="text"
          class="text-input"
          placeholder="owner/repo@main:campaign.geojson"
          spellcheck="false"
          @keyup.enter="doLoad"
        />
        <button class="btn-secondary" :disabled="!sourceSpec || githubStore.isBusy" @click="doLoad">
          {{ githubStore.status === 'pulling' ? 'Loading…' : 'Load' }}
        </button>
      </div>
      <p class="hint">Leave off <code>@ref</code> to use the repository's default branch.</p>

      <template v-if="githubStore.hasSource">
        <div class="sync-status">
          <span :class="githubStore.isDirty ? 'dot-dirty' : 'dot-clean'"></span>
          <span v-if="githubStore.isDirty">Unpushed local changes</span>
          <span v-else>In sync{{ syncedAgo ? ` — pulled ${syncedAgo}` : '' }}</span>
          <a :href="webUrl" target="_blank" rel="noopener" class="link-out">view on GitHub ↗</a>
        </div>

        <div class="field-row">
          <button class="btn-secondary" :disabled="githubStore.isBusy" @click="doPull">
            {{ githubStore.status === 'pulling' ? 'Pulling…' : 'Pull' }}
          </button>
          <button class="btn-primary" :disabled="!githubStore.canPush || githubStore.isBusy" @click="doPush">
            {{ githubStore.status === 'pushing' ? 'Pushing…' : 'Push' }}
          </button>
        </div>

        <label v-if="githubStore.isDirty" class="check-label">
          <input v-model="overwriteLocal" type="checkbox" />
          Pull discards local changes
        </label>
        <p v-if="!githubStore.canPush" class="hint" style="margin-top:6px">
          Connect a token to push.
        </p>
      </template>

      <p v-if="githubStore.error" class="error-text">{{ githubStore.error }}</p>
      <p v-if="githubSuccess" class="success-text">{{ githubSuccess }}</p>
    </div>

    <div class="section">
      <div class="section-heading">Export GeoJSON</div>
      <p class="hint">Download the current campaign with all labelled data.</p>
      <button class="btn-primary" :disabled="!campaignStore.isActive" @click="doExport">
        Export GeoJSON
      </button>
      <p v-if="!campaignStore.isActive" class="hint" style="margin-top:6px">No campaign active.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import { useGithubStore } from '../../stores/github'
import { parseSourceSpec, formatSourceSpec, sourceWebUrl } from '../../services/githubApi'
import type { CampaignGeoJSON } from '../../types/campaign'

const appStore = useAppStore()
const campaignStore = useCampaignStore()
const githubStore = useGithubStore()

const uploadError = ref('')
const uploadSuccess = ref('')

const tokenInput = ref('')
const rememberToken = ref(githubStore.isPersisted())
const connecting = ref(false)
const sourceSpec = ref(githubStore.source ? formatSourceSpec(githubStore.source) : '')
const overwriteLocal = ref(false)
const githubSuccess = ref('')

const webUrl = computed(() => githubStore.source ? sourceWebUrl(githubStore.source) : '')

const syncedAgo = computed(() => {
  const at = githubStore.lastSyncedAt
  if (!at) return ''
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)} h ago`
})

async function doConnect() {
  connecting.value = true
  githubSuccess.value = ''
  try {
    await githubStore.connect(tokenInput.value.trim(), rememberToken.value)
    tokenInput.value = ''
    githubSuccess.value = `Connected as ${githubStore.login}.`
  } catch { /* githubStore.error carries the message */ }
  connecting.value = false
}

async function doLoad() {
  githubSuccess.value = ''
  const src = parseSourceSpec(sourceSpec.value)
  if (!src) {
    githubStore.error = 'Expected owner/repo[@ref]:path — e.g. myorg/campaigns@main:forest.geojson'
    return
  }
  try {
    await githubStore.pull(src)
    afterPull()
  } catch { /* githubStore.error carries the message */ }
}

async function doPull() {
  githubSuccess.value = ''
  try {
    await githubStore.refresh({ prefer: overwriteLocal.value ? 'remote' : 'local' })
    overwriteLocal.value = false
    afterPull()
  } catch { /* githubStore.error carries the message */ }
}

/** Report what landed, and navigate only if the view isn't already on a sample. */
function afterPull() {
  const count = campaignStore.features.length
  githubSuccess.value = `Loaded "${campaignStore.schema?.name}" with ${count} samples.`
  sourceSpec.value = githubStore.source ? formatSourceSpec(githubStore.source) : sourceSpec.value

  const [lon, lat] = appStore.coordinate
  const onSample = campaignStore.features.some(
    f => f.geometry.coordinates[0] === lon && f.geometry.coordinates[1] === lat
  )
  if (count > 0 && !onSample) {
    const [flon, flat] = campaignStore.features[0].geometry.coordinates
    appStore.setCoordinate(flon, flat)
  }
}

async function doPush() {
  githubSuccess.value = ''
  try {
    await githubStore.push()
    githubSuccess.value = 'Pushed to GitHub.'
  } catch { /* githubStore.error carries the message */ }
}

function onFileChange(evt: Event) {
  uploadError.value = ''
  uploadSuccess.value = ''
  const file = (evt.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const geojson = JSON.parse(e.target?.result as string)
      if (geojson.type !== 'FeatureCollection') throw new Error('Not a FeatureCollection')

      if (geojson.campaign) {
        // Full campaign GeoJSON
        const camp = geojson as CampaignGeoJSON
        // This file didn't come from GitHub — don't let a stale source push over it.
        githubStore.clearSource()
        sourceSpec.value = ''
        campaignStore.loadGeoJSON(camp).catch(() => {})
        // Navigate to first feature
        if (camp.features.length > 0) {
          const [lon, lat] = camp.features[0].geometry.coordinates
          appStore.setCoordinate(lon, lat)
        }
        uploadSuccess.value = `Loaded campaign "${camp.campaign.name}" with ${camp.features.length} samples.`
      } else {
        // Minimal GeoJSON — need schema from active campaign or prompt user
        if (!campaignStore.isActive) {
          uploadError.value = 'Load a campaign schema first, or use a full campaign GeoJSON.'
          return
        }
        campaignStore.loadMinimalGeoJSON(geojson)
        uploadSuccess.value = `Loaded ${geojson.features.length} sample points.`
      }
    } catch (err) {
      uploadError.value = err instanceof Error ? err.message : 'Failed to parse file.'
    }
    ;(evt.target as HTMLInputElement).value = ''
  }
  reader.readAsText(file)
}

function doExport() {
  const geojson = campaignStore.exportGeoJSON(appStore.startDate, appStore.endDate)
  const json = JSON.stringify(geojson, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${geojson.campaign.name.replace(/\s+/g, '_')}.geojson`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.upload-panel {
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

.hint {
  color: var(--text-muted);
  margin-bottom: 8px;
  line-height: 1.4;
}

.upload-panel a {
  color: var(--accent);
}

.file-label {
  display: inline-block;
}

.file-input {
  display: none;
}

.file-btn {
  display: inline-block;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 12px;
}

.file-btn:hover {
  background: var(--bg-hover);
}

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

.btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
}

.field-label {
  color: var(--text-muted);
  margin: 10px 0 4px;
}

.field-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}

.text-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  font-size: 0.82rem;
  font-family: inherit;
  padding: 5px 8px;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.btn-secondary {
  background: var(--bg-input);
  border: 1px solid var(--border-mid);
  border-radius: 4px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.82rem;
  padding: 5px 12px;
  white-space: nowrap;
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn-secondary:disabled {
  opacity: 0.4;
  cursor: default;
}

.check-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  cursor: pointer;
  margin-bottom: 6px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
}

.sync-status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  margin: 8px 0 6px;
}

.dot-clean,
.dot-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-clean { background: var(--green); }
.dot-dirty { background: var(--orange); }

.link-out {
  color: var(--accent);
  margin-left: auto;
  white-space: nowrap;
}

code {
  background: var(--bg-input);
  border-radius: 3px;
  padding: 0 3px;
}

.error-text {
  color: var(--red);
  margin-top: 6px;
}

.success-text {
  color: var(--green);
  margin-top: 6px;
}
</style>
