import { ref, onUnmounted } from 'vue'
import L from 'leaflet'
import { useAppStore } from '../stores/app'
import '../styles/mapPicker.css'

/** Marks the map container while a pick is pending — drives cursor and button visibility. */
const PICKING_CLASS = 'map-picking'

/**
 * Lets the user choose the analysed coordinate straight from a Leaflet map.
 *
 * Two ways in, one code path: arm the crosshair control (hidden until the map
 * is hovered) and click once, or Shift+click the map at any time. Picking is
 * deliberately not a plain click — the map is the workspace, and a stray click
 * would discard the loaded series and trigger a fresh fetch.
 *
 * The picked position is used verbatim. It is tempting to snap to the pixel
 * grid, but that grid is UTM-based per MGRS tile, so snapping in lat/lon would
 * quietly land on the wrong cell.
 *
 * Call `attach(map)` once the map exists; teardown happens on unmount.
 */
export function useMapPointPicker() {
  const appStore = useAppStore()
  const armed = ref(false)

  let target: L.Map | null = null
  let control: L.Control | null = null
  let button: HTMLAnchorElement | null = null

  function setArmed(next: boolean) {
    if (armed.value === next) return
    armed.value = next
    target?.getContainer().classList.toggle(PICKING_CLASS, next)
    button?.classList.toggle('is-armed', next)
    button?.setAttribute('aria-pressed', String(next))
    if (next) document.addEventListener('keydown', onKeyDown)
    else document.removeEventListener('keydown', onKeyDown)
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') setArmed(false)
  }

  function onMapClick(e: L.LeafletMouseEvent) {
    if (!armed.value && !(e.originalEvent as MouseEvent).shiftKey) return
    // wrap() keeps longitudes in [-180, 180] after the user pans across the
    // date line, where Leaflet reports 190° and the API expects -170°.
    const { lng, lat } = e.latlng.wrap()
    setArmed(false)
    appStore.setCoordinate(lng, lat)
  }

  const PickControl = L.Control.extend({
    options: { position: 'topright' as L.ControlPosition },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-pick-control')
      const a = L.DomUtil.create('a', 'map-pick-btn', container) as HTMLAnchorElement
      a.href = '#'
      a.title = 'Pick a new point — or Shift+click the map'
      a.setAttribute('role', 'button')
      a.setAttribute('aria-pressed', 'false')
      a.textContent = '⊕'
      // Without this, clicking the button also reaches the map underneath.
      L.DomEvent.disableClickPropagation(container)
      L.DomEvent.on(a, 'click', (ev: Event) => {
        L.DomEvent.preventDefault(ev)
        setArmed(!armed.value)
      })
      button = a
      return container
    },
  })

  function attach(map: L.Map) {
    detach()
    target = map
    control = new PickControl()
    control.addTo(map)
    map.on('click', onMapClick)
  }

  function detach() {
    setArmed(false)
    target?.off('click', onMapClick)
    control?.remove()
    control = null
    button = null
    target = null
  }

  onUnmounted(detach)

  return { armed, attach, detach }
}
