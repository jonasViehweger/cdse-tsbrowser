import { describe, it, expect } from 'vitest'
import { parseUrl, serialiseUrl } from './url'

const BASE_STATE = {
  lon: 13.4,
  lat: 52.5,
  start: '2025-12-01',
  end: '2026-02-28',
  selected: null,
  flags: undefined,
  flagLabels: undefined,
  campaignName: null,
  meta: undefined,
}

describe('flags round-trip', () => {
  it('serialises and parses flags', () => {
    const flags = { '2025-12-11': 'wet', '2025-12-27': 'dry' }
    const url = serialiseUrl({ ...BASE_STATE, flags })
    const parsed = parseUrl(url)
    expect(parsed.flags).toEqual(flags)
  })

  it('serialises and parses flagLabels (no-campaign mode)', () => {
    const flagLabels = { wet: 'Flooding', dry: 'Drought' }
    const url = serialiseUrl({ ...BASE_STATE, flagLabels })
    expect(parseUrl(url).flagLabels).toEqual(flagLabels)
  })

  it('omits flagLabels from url when campaign is active', () => {
    const url = serialiseUrl({
      ...BASE_STATE,
      flagLabels: { wet: 'Flooding' },
      campaignName: 'My Campaign',
    })
    // flagLabels should not appear because campaign is active
    expect(url).not.toContain('flagLabels')
  })

  it('preserves multiple flags on different dates', () => {
    const flags = {
      '2025-12-11': 'a',
      '2025-12-22': 'b',
      '2026-01-03': 'a',
      '2026-02-10': 'c',
    }
    const url = serialiseUrl({ ...BASE_STATE, flags })
    expect(parseUrl(url).flags).toEqual(flags)
  })

  it('omits flags param when flags are empty', () => {
    const url = serialiseUrl({ ...BASE_STATE, flags: {} })
    expect(url).not.toContain('flags')
  })

  it('returns undefined flags for malformed JSON', () => {
    const parsed = parseUrl('?flags=' + encodeURIComponent('!!!notjson!!!'))
    expect(parsed.flags).toBeUndefined()
  })
})

describe('campaign param round-trip', () => {
  it('serialises campaign as plain name and parses it back', () => {
    const url = serialiseUrl({ ...BASE_STATE, campaignName: 'Forest Disturbance 2020' })
    const parsed = parseUrl(url)
    expect(parsed.campaignName).toBe('Forest Disturbance 2020')
    expect(parsed.legacyCampaignSchema).toBeUndefined()
  })

  it('returns undefined campaignName when campaign param is absent', () => {
    const parsed = parseUrl('?lon=13.4&lat=52.5')
    expect(parsed.campaignName).toBeUndefined()
  })
})

describe('legacy URL backward compat', () => {
  it('parses legacy campaign JSON param and extracts name + schema', () => {
    const schema = {
      name: 'Forest Disturbance 2020',
      flagLabels: { '1': 'disturbance', '2': 'recovery' },
      fields: [{ key: 'sample_id', label: 'Sample ID', type: 'display' as const }],
    }
    const url = '?campaign=' + encodeURIComponent(JSON.stringify(schema))
    const parsed = parseUrl(url)
    expect(parsed.campaignName).toBe('Forest Disturbance 2020')
    expect(parsed.legacyCampaignSchema?.flagLabels).toEqual({ '1': 'disturbance', '2': 'recovery' })
    // flagLabels promoted from schema
    expect(parsed.flagLabels).toEqual({ '1': 'disturbance', '2': 'recovery' })
  })

  it('parses legacy sample param and promotes flags/flagLabels/meta', () => {
    const sd = {
      flags: { '2025-12-11': 'wet' },
      flagLabels: { wet: 'Flooding' },
      confidence: 'High',
    }
    const url = '?sample=' + encodeURIComponent(JSON.stringify(sd))
    const parsed = parseUrl(url)
    expect(parsed.flags).toEqual({ '2025-12-11': 'wet' })
    expect(parsed.flagLabels).toEqual({ wet: 'Flooding' })
    expect(parsed.meta).toEqual({ confidence: 'High' })
  })
})

describe('meta round-trip', () => {
  it('serialises and parses meta when campaign is active', () => {
    const meta = { confidence: 'High', interpreter: 'jdoe' }
    const url = serialiseUrl({ ...BASE_STATE, campaignName: 'My Campaign', meta })
    expect(parseUrl(url).meta).toEqual(meta)
  })

  it('omits meta param when empty', () => {
    const url = serialiseUrl({ ...BASE_STATE, campaignName: 'My Campaign', meta: {} })
    expect(url).not.toContain('meta')
  })
})
