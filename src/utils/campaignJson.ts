import type { CampaignGeoJSON } from '../types/campaign'

/**
 * Serialise a campaign exactly as the Python side writes it.
 *
 * Campaign files are generated and consumed by scripts using
 * `json.dump(campaign, fp, indent=4)`, and they live in git. Any formatting
 * difference — indent width, a trailing newline, a non-ASCII character left
 * unescaped — rewrites all hundred thousand lines and buries the handful of
 * labels that actually changed. So this matches CPython's writer rather than
 * JavaScript's defaults:
 *
 * - four-space indent, `": "` between key and value (same as `JSON.stringify`)
 * - `ensure_ascii=True`: everything above U+007E escaped as `\uXXXX`, lowercase
 * - no trailing newline
 *
 * Number formatting needs no special handling: `repr()` and `Number#toString`
 * both emit the shortest representation that round-trips.
 */
export function stringifyCampaign(geojson: CampaignGeoJSON): string {
  return toPythonAscii(JSON.stringify(geojson, null, 4))
}

/**
 * Escape every non-ASCII code unit, as Python's `ensure_ascii` does.
 *
 * Safe to run over the whole document: outside of string literals JSON is
 * ASCII by construction. Astral characters are escaped as their two surrogate
 * halves, which is also what CPython emits.
 */
function toPythonAscii(json: string): string {
  // eslint-disable-next-line no-control-regex
  return json.replace(/[\u007f-￿]/g, c =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  )
}
