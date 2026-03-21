import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CampaignParams, CampaignField, CampaignFeature, CampaignGeoJSON, SampleRecord } from '../types/campaign'
import { saveCampaignFeatures, loadCampaignFeatures, saveCampaignRecords, loadCampaignRecords, saveCampaignSchema, loadCampaignSchema } from '../utils/campaignIdb'

export const useCampaignStore = defineStore('campaign', () => {
  /** The active campaign schema. null = no campaign active. */
  const schema = ref<CampaignParams | null>(null)

  /** All sample points for the active campaign. */
  const features = ref<CampaignFeature[]>([])

  /** Per-sample labelling records, keyed by sample_id. Persisted in IndexedDB. */
  const sampleRecords = ref<Record<string, SampleRecord>>({})

  /** session_persistent field values — pre-fill next sample automatically. */
  const sessionValues = ref<Record<string, unknown>>({})

  const isActive = computed(() => schema.value !== null)

  const currentFields = computed<CampaignField[]>(() => schema.value?.fields ?? [])

  /** Labelling status for each sample_id: 'unlabelled' | 'complete' */
  function labellingStatus(sampleId: string): 'unlabelled' | 'complete' {
    const record = sampleRecords.value[sampleId]
    if (!record) return 'unlabelled'
    const fields = schema.value?.fields ?? []
    const required = fields.filter(f => f.required && f.type !== 'display')
    if (required.length === 0) return 'complete'
    return required.every(f => record[f.key] != null && record[f.key] !== '') ? 'complete' : 'unlabelled'
  }

  /**
   * Load schema + features + records from IDB by campaign name.
   * Called by main.ts before Vue mounts, so components always see populated state.
   * If campaign-records is missing but features have embedded labelled properties,
   * the records are extracted from features and migrated to campaign-records.
   */
  async function loadFromIdb(name: string): Promise<void> {
    const [storedSchema, storedFeatures, storedRecords] = await Promise.all([
      loadCampaignSchema(name),
      loadCampaignFeatures(name),
      loadCampaignRecords(name),
    ])

    if (storedSchema) schema.value = storedSchema
    if (storedFeatures) features.value = storedFeatures

    if (storedRecords) {
      sampleRecords.value = storedRecords
    } else if (storedFeatures) {
      // Fallback: campaign-records was empty but features may have embedded
      // labelled properties (e.g. from an older code version). Extract and migrate.
      const fromFeatures: Record<string, SampleRecord> = {}
      for (const feat of storedFeatures) {
        const { sample_id, ...rest } = feat.properties as { sample_id: string; [key: string]: unknown }
        if (Object.keys(rest).some(k => rest[k] != null)) {
          fromFeatures[sample_id] = rest as SampleRecord
        }
      }
      sampleRecords.value = fromFeatures
      if (Object.keys(fromFeatures).length > 0) {
        saveCampaignRecords(name, fromFeatures).catch(() => {})
      }
    } else {
      sampleRecords.value = {}
    }

    sessionValues.value = {}
  }

  function loadGeoJSON(geojson: CampaignGeoJSON, startDate: string, endDate: string) {
    const params: CampaignParams = {
      name: geojson.campaign.name,
      flagLabels: geojson.campaign.flagLabels,
      fields: geojson.campaign.fields,
    }
    schema.value = params
    saveCampaignSchema(params.name, params).catch(() => {})
    features.value = geojson.features

    // Extract any labelled properties already embedded in the GeoJSON
    const fromFile: Record<string, SampleRecord> = {}
    for (const feat of geojson.features) {
      const { sample_id, flags, ...rest } = feat.properties
      if (Object.keys(rest).some(k => rest[k] != null)) {
        fromFile[sample_id] = { flags, ...rest }
      }
    }

    // Merge with IDB records (IDB wins over embedded, GeoJSON file wins over nothing)
    loadCampaignRecords(geojson.campaign.name)
      .then(stored => {
        sampleRecords.value = { ...fromFile, ...stored ?? {} }
        saveCampaignRecords(geojson.campaign.name, sampleRecords.value).catch(() => {})
      })
      .catch(() => {
        sampleRecords.value = fromFile
        saveCampaignRecords(geojson.campaign.name, fromFile).catch(() => {})
      })

    // Persist features separately (large, written once)
    saveCampaignFeatures(geojson.campaign.name, geojson.features).catch(() => {})

    void startDate; void endDate
  }

  function loadMinimalGeoJSON(geojson: { type: string; features: Array<{ type: string; geometry: CampaignFeature['geometry']; properties: { sample_id: string } }> }) {
    const mapped: CampaignFeature[] = geojson.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { sample_id: f.properties.sample_id },
    }))
    features.value = mapped
    if (schema.value?.name) {
      saveCampaignFeatures(schema.value.name, mapped).catch(() => {})
    }
  }

  function saveSampleRecord(sampleId: string, record: SampleRecord) {
    sampleRecords.value[sampleId] = record
    // Update session_persistent fields
    const fields = schema.value?.fields ?? []
    for (const field of fields) {
      if (field.session_persistent && record[field.key] !== undefined) {
        sessionValues.value[field.key] = record[field.key]
      }
    }
    if (schema.value?.name) {
      saveCampaignRecords(schema.value.name, sampleRecords.value).catch(() => {})
    }
  }

  function getSampleRecord(sampleId: string): SampleRecord {
    return sampleRecords.value[sampleId] ?? {}
  }

  /** Build initial record for a new sample, pre-filling session_persistent fields. */
  function buildInitialRecord(sampleId: string): SampleRecord {
    const existing = sampleRecords.value[sampleId]
    if (existing && Object.keys(existing).length > 0) return existing
    const record: SampleRecord = {}
    const fields = schema.value?.fields ?? []
    for (const field of fields) {
      if (field.session_persistent && sessionValues.value[field.key] !== undefined) {
        record[field.key] = sessionValues.value[field.key]
      }
    }
    return record
  }

  function exportGeoJSON(startDate: string, endDate: string): CampaignGeoJSON {
    const camp = schema.value!
    const exportedFeatures: CampaignFeature[] = features.value.map(feat => {
      const record = sampleRecords.value[feat.properties.sample_id] ?? {}
      return {
        type: 'Feature',
        geometry: feat.geometry,
        properties: {
          ...feat.properties,
          ...record,
        },
      }
    })
    return {
      type: 'FeatureCollection',
      campaign: {
        name: camp.name,
        startDate,
        endDate,
        flagLabels: camp.flagLabels,
        fields: camp.fields,
      },
      features: exportedFeatures,
    }
  }

  /** Activate a new campaign schema (e.g. from the admin panel). Saves to IDB. */
  function setSchema(params: CampaignParams) {
    schema.value = params
    features.value = []
    sampleRecords.value = {}
    sessionValues.value = {}
    saveCampaignSchema(params.name, params).catch(() => {})
  }

  function clear() {
    schema.value = null
    features.value = []
    sampleRecords.value = {}
    sessionValues.value = {}
  }

  return {
    schema,
    features,
    sampleRecords,
    isActive,
    currentFields,
    labellingStatus,
    loadFromIdb,
    setSchema,
    loadGeoJSON,
    loadMinimalGeoJSON,
    saveSampleRecord,
    getSampleRecord,
    buildInitialRecord,
    exportGeoJSON,
    clear,
  }
})
