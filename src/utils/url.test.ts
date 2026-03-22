import { describe, it, expect } from 'vitest'
import { parseUrl, serialiseUrl, deepEqual } from './url'

const BASE: Parameters<typeof serialiseUrl>[0] = {
  lon: 13.4,
  lat: 52.5,
  start: '2025-12-01',
  end: '2026-02-28',
  selected: null,
}

// ── serialiseUrl / parseUrl round-trips ──────────────────────────────────────

describe('sample round-trip', () => {
  it('serialises and parses flags inside sample', () => {
    const flags = { '2025-12-11': 'wet', '2025-12-27': 'dry' }
    const url = serialiseUrl({ ...BASE, sample: { flags } })
    expect(parseUrl(url).sample?.flags).toEqual(flags)
  })

  it('serialises and parses sample_id', () => {
    const url = serialiseUrl({ ...BASE, sample: { sample_id: 'plot_001', flags: {} } })
    expect(parseUrl(url).sample?.sample_id).toBe('plot_001')
  })

  it('serialises and parses field values alongside flags', () => {
    const sample = { sample_id: 'p1', flags: { '2025-12-11': '1' }, confidence: 'High', interpreter: 'jdoe' }
    const url = serialiseUrl({ ...BASE, sample })
    const parsed = parseUrl(url).sample!
    expect(parsed.sample_id).toBe('p1')
    expect(parsed.flags).toEqual({ '2025-12-11': '1' })
    expect(parsed.confidence).toBe('High')
    expect(parsed.interpreter).toBe('jdoe')
  })

  it('omits sample param when sample is empty', () => {
    const url = serialiseUrl({ ...BASE, sample: {} })
    expect(url).not.toContain('sample')
  })

  it('omits sample param when undefined', () => {
    const url = serialiseUrl({ ...BASE })
    expect(url).not.toContain('sample')
  })
})

describe('schema round-trip', () => {
  it('serialises and parses flagLabels', () => {
    const flagLabels = { wet: 'Flooding', dry: 'Drought' }
    const url = serialiseUrl({ ...BASE, schema: { flagLabels } })
    expect(parseUrl(url).schema?.flagLabels).toEqual(flagLabels)
  })

  it('serialises and parses full campaign schema', () => {
    const schema = {
      campaign: 'Forest 2020',
      flagLabels: { '1': 'disturbance' },
      fields: [{ key: 'confidence', label: 'Confidence', type: 'select' as const, options: ['High', 'Low'], required: true, session_persistent: false }],
    }
    const url = serialiseUrl({ ...BASE, schema })
    const parsed = parseUrl(url).schema!
    expect(parsed.campaign).toBe('Forest 2020')
    expect(parsed.flagLabels).toEqual({ '1': 'disturbance' })
    expect(parsed.fields).toEqual(schema.fields)
  })

  it('omits schema param when undefined', () => {
    const url = serialiseUrl({ ...BASE })
    expect(url).not.toContain('schema')
  })
})

// ── deepEqual ─────────────────────────────────────────────────────────────────

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual('a', 'a')).toBe(true)
  })

  it('returns false for different primitives', () => {
    expect(deepEqual(1, 2)).toBe(false)
  })

  it('returns true for deeply equal objects', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true)
  })

  it('returns false for objects with different values', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
  })

  it('returns false for objects with different keys', () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false)
  })

  it('returns true for deeply equal arrays', () => {
    expect(deepEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true)
  })

  it('returns false for arrays of different length', () => {
    expect(deepEqual([1, 2], [1])).toBe(false)
  })

  it('compares CampaignParams-shaped objects correctly', () => {
    const a = { name: 'foo', flagLabels: { '1': 'dist' }, fields: [{ key: 'k', type: 'text' }] }
    const b = { name: 'foo', flagLabels: { '1': 'dist' }, fields: [{ key: 'k', type: 'text' }] }
    const c = { name: 'foo', flagLabels: { '1': 'dist' }, fields: [{ key: 'k', type: 'select' }] }
    expect(deepEqual(a, b)).toBe(true)
    expect(deepEqual(a, c)).toBe(false)
  })
})
