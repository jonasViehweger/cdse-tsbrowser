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
import { ref } from 'vue'
import { useAppStore } from '../../stores/app'
import { useCampaignStore } from '../../stores/campaign'
import type { CampaignGeoJSON } from '../../types/campaign'

const appStore = useAppStore()
const campaignStore = useCampaignStore()

const uploadError = ref('')
const uploadSuccess = ref('')

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
        campaignStore.loadGeoJSON(camp)
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

.error-text {
  color: var(--red);
  margin-top: 6px;
}

.success-text {
  color: var(--green);
  margin-top: 6px;
}
</style>
