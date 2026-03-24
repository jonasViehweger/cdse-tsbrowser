export function basemapUrl(): string {
  return document.documentElement.dataset.theme === 'light'
    ? `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
    : `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
}
