import type { Flags, FlagLabels } from '../types/state'
import type { CampaignField } from '../types/campaign'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedSample {
  sample_id?: string
  flags?: Flags
  [key: string]: unknown
}

export interface ParsedSchema {
  /** Campaign name — only present when a labelling campaign is active. */
  campaign?: string
  flagLabels?: FlagLabels
  /** Ordered field definitions for the labelling form. */
  fields?: CampaignField[]
}

export interface ParsedUrl {
  lon: number | undefined
  lat: number | undefined
  start: string | undefined
  end: string | undefined
  selected: string | undefined
  /** Per-sample observation data: sample_id, flags, and form field values. */
  sample: ParsedSample | undefined
  /**
   * Labelling schema — always fully embedded when present so URLs are
   * self-contained and shareable without IDB access.
   */
  schema: ParsedSchema | undefined
}

export interface SerialiseInput {
  lon: number | null
  lat: number | null
  start: string
  end: string
  selected: string | null
  sample?: ParsedSample
  schema?: ParsedSchema
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hasContent(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v !== 'object') return true
  const obj = v as Record<string, unknown>
  return Object.values(obj).some(val => val !== undefined && val !== null)
}

/** Recursive deep equality — used to detect schema mismatches. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    return aa.every((v, i) => deepEqual(v, bb[i]))
  }
  const keysA = Object.keys(a as object)
  const keysB = Object.keys(b as object)
  if (keysA.length !== keysB.length) return false
  return keysA.every(k =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

// ── Parsing ───────────────────────────────────────────────────────────────────

export function parseUrl(search: string): ParsedUrl {
  const p = new URLSearchParams(search)

  const lon      = p.has('lon') ? parseFloat(p.get('lon')!) : undefined
  const lat      = p.has('lat') ? parseFloat(p.get('lat')!) : undefined
  const start    = p.get('start')    ?? undefined
  const end      = p.get('end')      ?? undefined
  const selected = p.get('selected') ?? undefined

  let sample: ParsedSample | undefined
  let schema: ParsedSchema | undefined

  const rawSample = p.get('sample')
  if (rawSample) {
    try { sample = JSON.parse(rawSample) as ParsedSample } catch { /* ignore */ }
  }

  const rawSchema = p.get('schema')
  if (rawSchema) {
    try { schema = JSON.parse(rawSchema) as ParsedSchema } catch { /* ignore */ }
  }

  return { lon, lat, start, end, selected, sample, schema }
}

// ── Serialisation ─────────────────────────────────────────────────────────────

/** Remove undefined/null values from an object before serialising. */
function clean(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  )
}

export function serialiseUrl(state: SerialiseInput): string {
  const p = new URLSearchParams()

  if (state.lon != null) p.set('lon', state.lon.toFixed(6))
  if (state.lat != null) p.set('lat', state.lat.toFixed(6))
  if (state.start)    p.set('start',    state.start)
  if (state.end)      p.set('end',      state.end)
  if (state.selected) p.set('selected', state.selected)

  if (state.sample) {
    const s = clean(state.sample as Record<string, unknown>)
    if (hasContent(s)) p.set('sample', JSON.stringify(s))
  }

  if (state.schema && hasContent(state.schema)) {
    p.set('schema', JSON.stringify(state.schema))
  }

  return '?' + p.toString()
}
