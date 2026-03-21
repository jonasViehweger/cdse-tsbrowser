import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app'

/** Returns true when keyboard focus is inside a text-entry element.
 *  All shortcuts are suppressed in this case so users can type freely. */
function isFocusInInput(): boolean {
  const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select'
}

/** Find the closest date in `dates` to `target` (ISO string). */
function closestDate(dates: string[], target: string): string {
  const t = new Date(target).getTime()
  return dates.reduce((best, d) => {
    return Math.abs(new Date(d).getTime() - t) < Math.abs(new Date(best).getTime() - t) ? d : best
  })
}

export function useKeyboardShortcuts(onToggleHelp: () => void) {
  const appStore = useAppStore()

  function navigate(delta: 1 | -1) {
    const dates = appStore.chartDates
    if (!dates.length) return
    const current = appStore.selectedDate
    if (!current) {
      appStore.setSelectedDate(delta === 1 ? dates[0] : dates[dates.length - 1])
      return
    }
    const idx = dates.indexOf(current)
    const next = idx + delta
    if (next >= 0 && next < dates.length) {
      appStore.setSelectedDate(dates[next])
    }
  }

  function jumpYear(direction: 1 | -1) {
    const dates = appStore.chartDates
    const current = appStore.selectedDate
    if (!dates.length || !current) return
    const target = new Date(current)
    target.setFullYear(target.getFullYear() + direction)
    appStore.setSelectedDate(closestDate(dates, target.toISOString().slice(0, 10)))
  }

  function onKeyDown(e: KeyboardEvent) {
    // ? always opens help, even from inputs
    if (e.key === '?') {
      e.preventDefault()
      onToggleHelp()
      return
    }

    if (isFocusInInput()) return

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        navigate(-1)
        break
      case 'ArrowRight':
        e.preventDefault()
        navigate(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        jumpYear(1)
        break
      case 'ArrowDown':
        e.preventDefault()
        jumpYear(-1)
        break
      case 'f':
        e.preventDefault()
        appStore.requestFlagDropdownFocus()
        break
      case 'r':
        e.preventDefault()
        if (appStore.selectedDate) appStore.removeFlag(appStore.selectedDate)
        break
      case 'n':
        e.preventDefault()
        appStore.requestSaveAndNext()
        break
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
}
