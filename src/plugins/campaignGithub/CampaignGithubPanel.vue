<template>
  <div class="github-panel">
    <div class="section">
      <div class="section-heading">Connection</div>

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
            @keyup.enter="doConnect"
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
    </div>

    <div class="section">
      <div class="section-heading">Campaign file</div>
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
      <p v-if="successText" class="success-text">{{ successText }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import { useGithubStore } from '../../stores/github'
import { parseSourceSpec, formatSourceSpec, sourceWebUrl } from '../../services/githubApi'

const appStore = useAppStore()
const campaignStore = useCampaignStore()
const githubStore = useGithubStore()

const tokenInput = ref('')
const rememberToken = ref(githubStore.isPersisted())
const connecting = ref(false)
const sourceSpec = ref(githubStore.source ? formatSourceSpec(githubStore.source) : '')
const overwriteLocal = ref(false)
const successText = ref('')

// The source can change without this panel doing anything — a `?gh=` URL pull at
// startup, or switching campaigns in the toolbar.
watch(() => githubStore.source, (src) => {
  sourceSpec.value = src ? formatSourceSpec(src) : ''
  successText.value = ''
})

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
  successText.value = ''
  try {
    await githubStore.connect(tokenInput.value.trim(), rememberToken.value)
    tokenInput.value = ''
    successText.value = `Connected as ${githubStore.login}.`
  } catch { /* githubStore.error carries the message */ }
  connecting.value = false
}

async function doLoad() {
  successText.value = ''
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
  successText.value = ''
  try {
    await githubStore.refresh({ prefer: overwriteLocal.value ? 'remote' : 'local' })
    overwriteLocal.value = false
    afterPull()
  } catch { /* githubStore.error carries the message */ }
}

/** Report what landed, and navigate only if the view isn't already on a sample. */
function afterPull() {
  const count = campaignStore.features.length
  successText.value = `Loaded "${campaignStore.schema?.name}" with ${count} samples.`

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
  successText.value = ''
  try {
    await githubStore.push()
    successText.value = 'Pushed to GitHub.'
  } catch { /* githubStore.error carries the message */ }
}
</script>

<style scoped>
.github-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  color: var(--text);
  font-size: 0.82rem;
}

.github-panel a {
  color: var(--accent);
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
