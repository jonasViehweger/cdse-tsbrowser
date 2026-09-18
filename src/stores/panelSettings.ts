import { defineStore } from 'pinia'
import { reactive } from 'vue'

/** Panel-provided actions the group header can offer for its active panel. */
export type PanelAction = 'settings' | 'download'

/**
 * Bridge between panel components and the group-level header buttons.
 * Each panel registers the actions it supports, keyed by its dockview panel ID;
 * PanelSettingsButton reads the active panel ID from its header action props
 * and shows a button per registered action.
 */
export const usePanelSettingsStore = defineStore('panelSettings', () => {
  const actions = reactive<Record<string, Partial<Record<PanelAction, () => void>>>>({})

  function register(panelId: string, action: PanelAction, fn: () => void) {
    // Panels register their actions one at a time, so merge rather than replace.
    actions[panelId] = { ...actions[panelId], [action]: fn }
  }

  /** Drops every action for the panel — called when it unmounts or changes ID. */
  function unregister(panelId: string) {
    delete actions[panelId]
  }

  function run(panelId: string, action: PanelAction) {
    actions[panelId]?.[action]?.()
  }

  function has(panelId: string, action: PanelAction): boolean {
    return actions[panelId]?.[action] != null
  }

  return { register, unregister, run, has }
})
