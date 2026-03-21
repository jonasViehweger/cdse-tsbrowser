const EARTH_RADIUS_M = 6_378_137

/**
 * Build a GeoJSON Polygon representing a 10×10 m pixel centred on [lon, lat].
 * The offsets are computed in degrees using the WGS-84 ellipsoid approximation.
 */
export function buildPixelPolygon(lon: number, lat: number): GeoJSON.Polygon {
  const latRad = (lat * Math.PI) / 180
  const latOffset = (5 / EARTH_RADIUS_M) * (180 / Math.PI)
  const lonOffset = (5 / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI)

  return {
    type: 'Polygon',
    coordinates: [
      [
        [lon - lonOffset, lat - latOffset],
        [lon + lonOffset, lat - latOffset],
        [lon + lonOffset, lat + latOffset],
        [lon - lonOffset, lat + latOffset],
        [lon - lonOffset, lat - latOffset],
      ],
    ],
  }
}
