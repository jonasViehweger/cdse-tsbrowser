export interface LatLon {
  lat: number
  lon: number
}

export type ParseResult =
  | { ok: true; value: LatLon }
  | { ok: false; error: string }

/**
 * Parse a user-typed `lat, lon` pair, e.g. "47.3456, 15.0439".
 *
 * Returns the failure as a value rather than throwing — every caller wants to
 * show the message next to the input rather than handle an exception.
 */
export function parseLatLon(raw: string): ParseResult {
  const parts = raw.trim().split(',')
  if (parts.length !== 2) {
    return { ok: false, error: 'Expected exactly two values separated by a comma.' }
  }

  const lat = parseFloat(parts[0].trim())
  const lon = parseFloat(parts[1].trim())

  if (isNaN(lat) || isNaN(lon)) {
    return { ok: false, error: 'Could not parse numbers — check your input.' }
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: 'Latitude must be between −90 and 90.' }
  }
  if (lon < -180 || lon > 180) {
    return { ok: false, error: 'Longitude must be between −180 and 180.' }
  }

  return { ok: true, value: { lat, lon } }
}

/** Render a coordinate in the same `lat, lon` form that parseLatLon accepts. */
export function formatLatLon(lon: number, lat: number, digits = 6): string {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`
}
