import type { Flags } from './state'

export type CampaignFieldType = 'display' | 'text' | 'select'

export interface CampaignField {
  key: string
  label: string
  type: CampaignFieldType
  options?: string[]      // only for 'select' type
  required?: boolean
  session_persistent?: boolean
}

/** Campaign schema encoded in the `campaign` URL param (no per-sample data). */
export interface CampaignParams {
  name: string
  flagLabels?: Record<string, string>
  fields?: CampaignField[]
  startDate?: string
  endDate?: string
}

/** A single sample's labelled properties stored in localStorage. */
export interface SampleRecord {
  flags?: Flags
  [key: string]: unknown
}

/** A GeoJSON Feature representing a campaign sample point. */
export interface CampaignFeature {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number]  // [lon, lat]
  }
  properties: {
    sample_id: string
    flags?: Flags
    [key: string]: unknown
  }
}

/** Full campaign GeoJSON (top-level `campaign` key + features). */
export interface CampaignGeoJSON {
  type: 'FeatureCollection'
  campaign: CampaignParams & {
    startDate: string
    endDate: string
  }
  features: CampaignFeature[]
}
