import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CampaignParams, CampaignField, CampaignFeature, CampaignGeoJSON, SampleRecord } from '../types/campaign'
import { saveCampaignFeatures, loadCampaignFeatures, saveCampaignRecords, loadCampaignRecords, saveCampaignSchema, loadCampaignSchema } from '../utils/campaignIdb'
import { deepEqual } from '../utils/url'
import { useAppStore } from './app'

export const useCampaignStore = defineStore('campaign', () => {
  /** The active campaign schema. null = no campaign active. */
  const schema = ref<CampaignParams | null>(null)

  /** All sample points for the active campaign. */
  const features = ref<CampaignFeature[]>([])

  /** Per-sample labelling records, keyed by sample_id. Persisted in IndexedDB. */
  const sampleRecords = ref<Record<string, SampleRecord>>({})

  /** session_persistent field values — pre-fill next sample automatically. */
  const sessionValues = ref<Record<string, unknown>>({})

  /**
   * Bumped on every change to labelled data. Sync layers (see stores/github.ts)
   * remember the revision they last wrote out to tell "dirty" from "in sync"
   * without diffing the whole record set.
   */
  const revision = ref(0)

  /**
   * True when the URL schema and the IDB schema for the same campaign name differ.
   * Save & Next is blocked while this is true.
   */
  const schemaMismatch = ref(false)

  /**
   * True when the active schema came from the URL without a matching IDB campaign.
   * The campaign map will be empty and Save & Next is blocked.
   */
  const isEphemeral = ref(false)

  const appStore = useAppStore()

  const isActive = computed(() => schema.value !== null)

  const currentFields = computed<CampaignField[]>(() => schema.value?.fields ?? [])

  /**
   * The sample_id of the feature at the current coordinate.
   * Falls back to appStore.urlSampleId for shared URLs where the recipient
   * doesn't have the campaign in their IDB (ephemeral mode, no features).
   */
  const currentSampleId = computed<string | null>(() => {
    const [lon, lat] = appStore.coordinate
    return features.value.find(
      f => f.geometry.coordinates[0] === lon && f.geometry.coordinates[1] === lat
    )?.properties.sample_id ?? appStore.urlSampleId
  })

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
   * Returns true if IDB had data for this campaign, false otherwise.
   *
   * If urlSchema is provided (from the URL's `schema` param):
   * - It is used for display (URL takes precedence).
   * - It is deep-compared to the IDB schema to set schemaMismatch.
   *
   * If campaign-records is missing but features have embedded labelled properties,
   * the records are extracted from features and migrated to campaign-records.
   */
  async function loadFromIdb(name: string, urlSchema?: CampaignParams): Promise<boolean> {
    const [storedSchema, storedFeatures, storedRecords] = await Promise.all([
      loadCampaignSchema(name),
      loadCampaignFeatures(name),
      loadCampaignRecords(name),
    ])

    if (!storedSchema && !storedFeatures) {
      return false
    }

    // URL schema takes precedence for display; compare to IDB schema to detect mismatch
    schema.value = urlSchema ?? storedSchema ?? null
    schemaMismatch.value = !!(urlSchema && storedSchema && !deepEqual(urlSchema, storedSchema))

    const effectiveSchema = schema.value
    if (effectiveSchema?.startDate && effectiveSchema?.endDate) {
      appStore.setDateRange(effectiveSchema.startDate, effectiveSchema.endDate)
    }

    if (storedFeatures) features.value = storedFeatures

    if (storedRecords) {
      sampleRecords.value = storedRecords
    } else {
      sampleRecords.value = {}
    }

    isEphemeral.value = false
    sessionValues.value = {}
    revision.value++
    return true
  }

  /**
   * Load a schema from the URL without persisting to IDB.
   * Used when a shared URL references a campaign not in local IDB.
   * Save & Next will be blocked (isEphemeral = true).
   */
  function loadEphemeral(urlSchema: CampaignParams): void {
    schema.value = urlSchema
    features.value = []
    sampleRecords.value = {}
    sessionValues.value = {}
    schemaMismatch.value = false
    isEphemeral.value = true
  }

  /**
   * Load a full campaign GeoJSON.
   *
   * `prefer` decides who wins when a sample is labelled both in the file and in
   * IDB: 'local' (the default) protects work that hasn't been written back to
   * the file yet, 'remote' discards it in favour of the file — which is what an
   * explicit "pull and overwrite" asks for.
   *
   * Returns the revision that corresponds to the file's contents alone. A later
   * `revision` means IDB contributed labels the file doesn't have yet, i.e. the
   * campaign is already dirty relative to its source.
   */
  async function loadGeoJSON(
    geojson: CampaignGeoJSON,
    opts?: { prefer?: 'local' | 'remote' },
  ): Promise<{ fileRevision: number }> {
    const params: CampaignParams = {
      name: geojson.campaign.name,
      flagLabels: geojson.campaign.flagLabels,
      fields: geojson.campaign.fields,
      startDate: geojson.campaign.startDate,
      endDate: geojson.campaign.endDate,
    }
    schema.value = params
    if (params.startDate && params.endDate) {
      appStore.setDateRange(params.startDate, params.endDate)
    }
    saveCampaignSchema(params.name, params).catch(() => {})
    isEphemeral.value = false
    schemaMismatch.value = false
    features.value = geojson.features

    // Extract any labelled properties already embedded in the GeoJSON
    const fromFile: Record<string, SampleRecord> = {}
    for (const feat of geojson.features) {
      const { sample_id, flags, ...rest } = feat.properties
      if (Object.keys(rest).some(k => rest[k] != null)) {
        fromFile[sample_id] = { flags, ...rest }
      }
    }

    // Set state synchronously first so callers that don't await still see the
    // file's contents immediately; the IDB merge below only refines it.
    sampleRecords.value = fromFile
    revision.value++
    const fileRevision = revision.value

    // Persist features separately (large, written once)
    saveCampaignFeatures(geojson.campaign.name, geojson.features).catch(() => {})

    if (opts?.prefer === 'remote') {
      await saveCampaignRecords(geojson.campaign.name, fromFile).catch(() => {})
      return { fileRevision }
    }

    try {
      const stored = await loadCampaignRecords(geojson.campaign.name)
      if (stored) sampleRecords.value = { ...fromFile, ...stored }
      // Local labels the file doesn't carry mean this campaign is already
      // ahead of its source — reflect that in the revision.
      if (!deepEqual(sampleRecords.value, fromFile)) revision.value++
      await saveCampaignRecords(geojson.campaign.name, sampleRecords.value).catch(() => {})
    } catch {
      // fromFile is already in place; persist it
      await saveCampaignRecords(geojson.campaign.name, fromFile).catch(() => {})
    }

    return { fileRevision }
  }

  function loadMinimalGeoJSON(geojson: { type: string; features: Array<{ type: string; geometry: CampaignFeature['geometry']; properties: { sample_id: string } }> }) {
    const mapped: CampaignFeature[] = geojson.features.map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: { sample_id: f.properties.sample_id },
    }))
    isEphemeral.value = false
    schemaMismatch.value = false
    features.value = mapped
    revision.value++
    if (schema.value?.name) {
      saveCampaignFeatures(schema.value.name, mapped).catch(() => {})
    }
  }

  function saveSampleRecord(sampleId: string, record: SampleRecord) {
    sampleRecords.value[sampleId] = record
    revision.value++
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

  /** Activate a new campaign schema (e.g. from the admin panel). Saves to IDB.
   *  Features and records are preserved when only schema properties change, not the name. */
  function setSchema(params: CampaignParams) {
    const nameChanged = schema.value?.name !== params.name
    schema.value = params
    revision.value++
    if (nameChanged) {
      features.value = []
      sampleRecords.value = {}
      sessionValues.value = {}
      saveCampaignRecords(params.name, {}).catch(() => {})
    }
    if (params.startDate && params.endDate) {
      appStore.setDateRange(params.startDate, params.endDate)
    }
    saveCampaignSchema(params.name, params).catch(() => {})
  }

  function clear() {
    schema.value = null
    features.value = []
    sampleRecords.value = {}
    sessionValues.value = {}
    schemaMismatch.value = false
    isEphemeral.value = false
    revision.value++
  }

  return {
    schema,
    features,
    sampleRecords,
    revision,
    schemaMismatch,
    isEphemeral,
    isActive,
    currentFields,
    currentSampleId,
    labellingStatus,
    loadFromIdb,
    loadEphemeral,
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
