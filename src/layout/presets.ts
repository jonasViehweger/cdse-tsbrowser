import type { DockviewApi } from 'dockview-vue'

export interface LayoutPreset {
  id: string
  name: string
  apply: (api: DockviewApi) => void
}

// ── JSON presets loaded from src/layout/json/*.json ───────────────────────────
//
// Each file is a dockview toJSON() snapshot with an optional "name" field:
//
//   {
//     "name": "My Custom Layout",   ← optional; filename is used if absent
//     "grid": { ... },              ← everything below is the raw toJSON() output
//     "panels": { ... },
//     "activeGroup": "..."
//   }
//
// Export a layout from the browser console with:
//   copy(JSON.stringify(window.__dockview.toJSON(), null, 2))
// then add "name": "..." at the top and save as a .json file here.

const jsonModules = import.meta.glob<Record<string, unknown>>('./json/*.json', { eager: true })

function filenameToTitle(path: string): string {
  return path
    .replace(/^.*\//, '')
    .replace(/\.json$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export const LAYOUT_PRESETS: LayoutPreset[] = Object.entries(jsonModules).map(([path, content]) => {
  const { name, ...layout } = content
  return {
    id: `json-${path.replace(/^.*\//, '').replace(/\.json$/, '')}`,
    name: (name as string | undefined) ?? filenameToTitle(path),
    apply: (api: DockviewApi) => api.fromJSON(layout as unknown as Parameters<DockviewApi['fromJSON']>[0]),
  }
})

export const DEFAULT_PRESET_ID = 'json-campaign'
