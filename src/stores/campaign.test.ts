import { describe, it, expect } from 'vitest'
import { recordsFromFeatures } from './campaign'
import type { CampaignFeature } from '../types/campaign'

function feature(sample_id: string, props: Record<string, unknown> = {}): CampaignFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { sample_id, ...props },
  }
}

describe('recordsFromFeatures', () => {
  it('extracts metadata fields and flags', () => {
    const records = recordsFromFeatures([
      feature('p1', { flags: { '2020-07-13': '1' }, confidence: 'High' }),
    ])
    expect(records).toEqual({ p1: { flags: { '2020-07-13': '1' }, confidence: 'High' } })
  })

  it('keeps a sample labelled only with flags', () => {
    // A campaign need not define metadata fields at all — dropping these would
    // hide flags that are sitting right there in the file.
    const records = recordsFromFeatures([feature('p1', { flags: { '2020-07-13': '1' } })])
    expect(records.p1).toEqual({ flags: { '2020-07-13': '1' } })
  })

  it('omits unlabelled samples entirely', () => {
    expect(recordsFromFeatures([feature('p1')])).toEqual({})
    expect(recordsFromFeatures([feature('p1', { flags: {} })])).toEqual({})
    expect(recordsFromFeatures([feature('p1', { comment: null })])).toEqual({})
  })

  it('sets no key that a JSON round-trip would drop', () => {
    // The IDB write strips undefined and empty flags; if extraction kept them,
    // the next load would diff against storage and claim unpushed changes.
    const records = recordsFromFeatures([
      feature('p1', { flags: undefined, confidence: 'High', comment: undefined }),
      feature('p2', { flags: {}, confidence: 'Low' }),
    ])
    expect(records).toEqual(JSON.parse(JSON.stringify(records)))
    expect(Object.keys(records.p1)).toEqual(['confidence'])
    expect(Object.keys(records.p2)).toEqual(['confidence'])
  })

  it('never carries sample_id into the record', () => {
    const records = recordsFromFeatures([feature('p1', { confidence: 'High' })])
    expect(records.p1.sample_id).toBeUndefined()
  })
})
