import { defineStore } from 'pinia'
import { reactive } from 'vue'

/**
 * Bridge between panel components and the group-level settings button.
 * Each panel that supports settings registers an openSettings() callback
 * keyed by its dockview panel ID. The PanelSettingsButton reads the
 * active panel ID from its header action props and invokes the callback.
 */
export const usePanelSettingsStore = defineStore('panelSettings', () => {
  const openFns = reactive<Record<string, () => void>>({})

  function register(panelId: string, fn: () => void) {
    openFns[panelId] = fn
  }

  function unregister(panelId: string) {
    delete openFns[panelId]
  }

  function openFor(panelId: string) {
    openFns[panelId]?.()
  }

  function hasSettings(panelId: string): boolean {
    return panelId in openFns
  }

  return { register, unregister, openFor, hasSettings }
})
