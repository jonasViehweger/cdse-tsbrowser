import type { Flags, FlagLabels } from '../types/state'
import type { CampaignParams } from '../types/campaign'

export interface ParsedUrl {
  lon: number | undefined
  lat: number | undefined
  start: string | undefined
  end: string | undefined
  selected: string | undefined
  /** Current-location flags. */
  flags: Flags | undefined
  /** Flag label definitions — only meaningful in non-campaign mode. */
  flagLabels: FlagLabels | undefined
  /** Active campaign name (plain string). */
  campaignName: string | undefined
  /**
   * Full campaign schema — present only when the URL uses the legacy
   * `campaign=<JSON>` format. Used by main.ts to seed IDB on first load.
   */
  legacyCampaignSchema: CampaignParams | undefined
  /** In-progress form-field values for the currently selected sample. */
  meta: Record<string, unknown> | undefined
}

export function parseUrl(search: string): ParsedUrl {
  const p = new URLSearchParams(search)

  const lon = p.has('lon') ? parseFloat(p.get('lon')!) : undefined
  const lat = p.has('lat') ? parseFloat(p.get('lat')!) : undefined
  const start    = p.get('start')    ?? undefined
  const end      = p.get('end')      ?? undefined
  const selected = p.get('selected') ?? undefined

  // ── flags ───────────────────────────────────────────────────────────────────
  let flags: Flags | undefined
  const rawFlags = p.get('flags')
  if (rawFlags) try { flags = JSON.parse(rawFlags) as Flags } catch { /* ignore */ }

  // ── flagLabels ───────────────────────────────────────────────────────────────
  let flagLabels: FlagLabels | undefined
  const rawFlagLabels = p.get('flagLabels')
  if (rawFlagLabels) try { flagLabels = JSON.parse(rawFlagLabels) as FlagLabels } catch { /* ignore */ }

  // ── campaign ─────────────────────────────────────────────────────────────────
  let campaignName: string | undefined
  let legacyCampaignSchema: CampaignParams | undefined

  const rawCampaign = p.get('campaign')
  if (rawCampaign) {
    if (rawCampaign.trimStart().startsWith('{')) {
      // Legacy format: full JSON schema embedded in URL
      try {
        legacyCampaignSchema = JSON.parse(rawCampaign) as CampaignParams
        campaignName = legacyCampaignSchema.name
        // Promote flagLabels from schema if not already set
        if (!flagLabels && legacyCampaignSchema.flagLabels) {
          flagLabels = legacyCampaignSchema.flagLabels
        }
      } catch { /* ignore malformed */ }
    } else {
      campaignName = rawCampaign
    }
  }

  // ── meta (in-progress form values) ──────────────────────────────────────────
  let meta: Record<string, unknown> | undefined
  const rawMeta = p.get('meta')
  if (rawMeta) try { meta = JSON.parse(rawMeta) as Record<string, unknown> } catch { /* ignore */ }

  // ── backward compat: legacy 'sample' param ────────────────────────────────
  // Old format: sample={"flags":{...},"flagLabels":{...},...formFields}
  const rawSample = p.get('sample')
  if (rawSample) {
    try {
      const sd = JSON.parse(rawSample) as Record<string, unknown>
      if (!flags && sd.flags) flags = sd.flags as Flags
      if (!flagLabels && sd.flagLabels) flagLabels = sd.flagLabels as FlagLabels
      if (!meta) {
        const { flags: _f, flagLabels: _fl, ...rest } = sd
        if (Object.keys(rest).length > 0) meta = rest
      }
    } catch { /* ignore */ }
  }

  return { lon, lat, start, end, selected, flags, flagLabels, campaignName, legacyCampaignSchema, meta }
}

// ── Serialisation ──────────────────────────────────────────────────────────

export interface SerialiseInput {
  lon: number | null
  lat: number | null
  start: string
  end: string
  selected: string | null
  flags: Flags | undefined
  /** Only written when no campaign is active. */
  flagLabels: FlagLabels | undefined
  /** Campaign name — plain string, not the full schema JSON. */
  campaignName: string | null
  /** In-progress form-field values for the current sample. */
  meta: Record<string, unknown> | undefined
}

function isNonEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return false
  return true
}

export function serialiseUrl(state: SerialiseInput): string {
  const p = new URLSearchParams()

  if (state.lon != null) p.set('lon', state.lon.toFixed(6))
  if (state.lat != null) p.set('lat', state.lat.toFixed(6))
  if (state.start)    p.set('start', state.start)
  if (state.end)      p.set('end', state.end)
  if (state.selected) p.set('selected', state.selected)

  if (isNonEmpty(state.flags)) p.set('flags', JSON.stringify(state.flags))
  // flagLabels only when no campaign — campaign schema is the authoritative source
  if (!state.campaignName && isNonEmpty(state.flagLabels)) p.set('flagLabels', JSON.stringify(state.flagLabels))
  if (state.campaignName)           p.set('campaign', state.campaignName)
  if (isNonEmpty(state.meta))       p.set('meta',     JSON.stringify(state.meta))

  return '?' + p.toString()
}
