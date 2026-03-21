const CARTO_BASE = 'https://{s}.basemaps.cartocdn.com'

export function basemapUrl(): string {
  return document.documentElement.dataset.theme === 'light'
    ? `${CARTO_BASE}/light_nolabels/{z}/{x}/{y}{r}.png`
    : `${CARTO_BASE}/dark_nolabels/{z}/{x}/{y}{r}.png`
}
