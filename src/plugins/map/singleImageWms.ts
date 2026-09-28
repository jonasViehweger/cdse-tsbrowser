import L from 'leaflet'

// Sentinel Hub rejects GetMap requests larger than this in either dimension.
export const MAX_WMS_IMAGE_SIZE = 2500

type WmsParams = Record<string, string | boolean>

/**
 * WMS layer that fetches a single image covering the whole viewport instead of
 * 256px tiles. The new image is only swapped in once it has loaded, so panning
 * and zooming never flash an empty map.
 */
export class SingleImageWms extends L.Layer {
  private readonly url: string
  private params: WmsParams
  private current: L.ImageOverlay | null = null
  private pending: L.ImageOverlay | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(url: string, params: WmsParams) {
    super()
    this.url = url
    this.params = params
  }

  onAdd(map: L.Map) {
    map.on('moveend', this.scheduleUpdate, this)
    this.update()
    return this
  }

  onRemove(map: L.Map) {
    map.off('moveend', this.scheduleUpdate, this)
    clearTimeout(this.timer)
    this.pending?.remove()
    this.current?.remove()
    this.pending = this.current = null
    return this
  }

  setParams(params: WmsParams) {
    this.params = { ...this.params, ...params }
    if (this._map) this.update()
    return this
  }

  // moveend fires repeatedly while dockview resizes the panel; wait for it to settle.
  private scheduleUpdate() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.update(), 100)
  }

  private update() {
    const map = this._map
    if (!map) return
    const size = map.getSize()
    if (size.x === 0 || size.y === 0) return

    const bounds = map.getBounds()
    const crs = map.options.crs!
    const sw = crs.project(bounds.getSouthWest())
    const ne = crs.project(bounds.getNorthEast())
    const query = {
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: '1.1.1',
      STYLES: '',
      SRS: crs.code,
      BBOX: [sw.x, sw.y, ne.x, ne.y].join(','),
      WIDTH: size.x,
      HEIGHT: size.y,
      ...this.params,
    }
    const src = this.url + L.Util.getParamString(query, this.url, true)

    this.pending?.remove()
    // tilePane keeps the image below vector overlays such as the pixel marker.
    const overlay = L.imageOverlay(src, bounds, { interactive: false, pane: 'tilePane' })
    this.pending = overlay
    overlay.once('load error', (e) => {
      if (this.pending !== overlay) return
      this.pending = null
      if (e.type === 'error') {
        overlay.remove()
        return
      }
      this.current?.remove()
      this.current = overlay
    })
    overlay.addTo(map)
  }
}
