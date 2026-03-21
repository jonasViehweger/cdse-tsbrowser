import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'
import type { DockviewApi } from 'dockview-vue'
import { LAYOUT_PRESETS, DEFAULT_PRESET_ID, type LayoutPreset } from '../layout/presets'

const LAYOUT_KEY = 'cdse-ts-browser-layout'
const USER_LAYOUTS_KEY = 'cdse-ts-browser-user-layouts'

export interface UserLayout {
  id: string
  name: string
  snapshot: unknown
}

export const useLayoutStore = defineStore('layout', () => {
  const api = shallowRef<DockviewApi | null>(null)
  const currentPresetId = ref<string | null>(null)
  const userLayouts = ref<UserLayout[]>([])

  function setApi(dockviewApi: DockviewApi) {
    api.value = dockviewApi
    _loadUserLayouts()
  }

  // ── Built-in presets ────────────────────────────────────────────────────────

  function applyPreset(preset: LayoutPreset) {
    if (!api.value) return
    ;[...api.value.panels].forEach(p => api.value!.removePanel(p))
    preset.apply(api.value)
    currentPresetId.value = preset.id
    saveLayout()
  }

  function applyPresetById(id: string) {
    const builtin = LAYOUT_PRESETS.find(p => p.id === id)
    if (builtin) { applyPreset(builtin); return }
    const user = userLayouts.value.find(l => l.id === id)
    if (user) applyUserLayout(user)
  }

  function applyDefault() {
    const preset = LAYOUT_PRESETS.find(p => p.id === DEFAULT_PRESET_ID) ?? LAYOUT_PRESETS[0]
    applyPreset(preset)
  }

  // ── User-saved layouts ──────────────────────────────────────────────────────

  function _loadUserLayouts() {
    try {
      const raw = localStorage.getItem(USER_LAYOUTS_KEY)
      if (raw) userLayouts.value = JSON.parse(raw) as UserLayout[]
    } catch {
      userLayouts.value = []
    }
  }

  function _saveUserLayouts() {
    try {
      localStorage.setItem(USER_LAYOUTS_KEY, JSON.stringify(userLayouts.value))
    } catch { /* quota */ }
  }

  function saveAsUserLayout(name: string) {
    if (!api.value) return
    const snapshot = api.value.toJSON()
    const id = `user-${Date.now()}`
    userLayouts.value.push({ id, name, snapshot })
    currentPresetId.value = id
    _saveUserLayouts()
  }

  function deleteUserLayout(id: string) {
    userLayouts.value = userLayouts.value.filter(l => l.id !== id)
    _saveUserLayouts()
    if (currentPresetId.value === id) currentPresetId.value = null
  }

  function applyUserLayout(layout: UserLayout) {
    if (!api.value) return
    ;[...api.value.panels].forEach(p => api.value!.removePanel(p))
    api.value.fromJSON(layout.snapshot as Parameters<DockviewApi['fromJSON']>[0])
    currentPresetId.value = layout.id
    saveLayout()
  }

  // ── Persistence (last-used layout) ─────────────────────────────────────────

  function saveLayout() {
    if (!api.value) return
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.value.toJSON()))
    } catch { /* quota */ }
  }

  function loadSavedLayout(): boolean {
    if (!api.value) return false
    const saved = localStorage.getItem(LAYOUT_KEY)
    if (!saved) return false
    try {
      api.value.fromJSON(JSON.parse(saved))
      return true
    } catch {
      localStorage.removeItem(LAYOUT_KEY)
      return false
    }
  }

  const isUserLayout = (id: string | null) => id != null && id.startsWith('user-')

  return {
    api,
    currentPresetId,
    userLayouts,
    isUserLayout,
    setApi,
    applyPreset,
    applyPresetById,
    applyDefault,
    saveAsUserLayout,
    deleteUserLayout,
    applyUserLayout,
    saveLayout,
    loadSavedLayout,
  }
})
