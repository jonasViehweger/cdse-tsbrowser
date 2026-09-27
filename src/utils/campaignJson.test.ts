import { describe, it, expect } from 'vitest'
import { stringifyCampaign } from './campaignJson'
import type { CampaignGeoJSON } from '../types/campaign'

function campaign(features: CampaignGeoJSON['features']): CampaignGeoJSON {
  return {
    type: 'FeatureCollection',
    campaign: { name: 'C', startDate: '2015-01-01', endDate: '2025-01-01' },
    features,
  }
}

function feature(props: Record<string, unknown>): CampaignGeoJSON['features'][number] {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-4.122119320177979, 36.741785367381176] },
    properties: props as CampaignGeoJSON['features'][number]['properties'],
  }
}

// Every expectation here is "what json.dump(obj, fp, indent=4) writes", because
// the generating scripts write these files and git diffs the result.

describe('stringifyCampaign', () => {
  it('indents with four spaces', () => {
    const out = stringifyCampaign(campaign([]))
    expect(out.split('\n')[1]).toBe('    "type": "FeatureCollection",')
  })

  it('ends without a trailing newline', () => {
    expect(stringifyCampaign(campaign([])).endsWith('}')).toBe(true)
  })

  it('escapes non-ASCII as lowercase \\uXXXX, like ensure_ascii', () => {
    const out = stringifyCampaign(campaign([feature({ sample_id: 0, comment: 'Flußbett' })]))
    expect(out).toContain('"comment": "Flu\\u00dfbett"')
    expect(out).not.toContain('ß')
  })

  it('escapes an astral character as its two surrogate halves', () => {
    const out = stringifyCampaign(campaign([feature({ sample_id: 0, comment: '🌲' })]))
    expect(out).toContain('"comment": "\\ud83c\\udf32"')
  })

  it('leaves ASCII punctuation and numbers exactly as Python writes them', () => {
    const out = stringifyCampaign(campaign([feature({ sample_id: 0, dataset: 3, s2_tile: '' })]))
    expect(out).toContain('"coordinates": [\n                    -4.122119320177979,')
    expect(out).toContain('"dataset": 3')
    expect(out).toContain('"s2_tile": ""')
    expect(out).not.toContain('\\/')
  })

  it('preserves property order rather than sorting keys', () => {
    const out = stringifyCampaign(campaign([feature({ sample_id: 0, confidence: 'high', cluster_id: '0.0' })]))
    expect(out.indexOf('"confidence"')).toBeLessThan(out.indexOf('"cluster_id"'))
  })
})
