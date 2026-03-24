import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Flags, FlagLabels } from '../types/state'

const today = new Date().toISOString().slice(0, 10)
const fiveYearsAgo = new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)

export const useAppStore = defineStore('app', () => {
  const CYCLE: Array<'system' | 'dark' | 'light'> = ['system', 'dark', 'light']
  const stored = localStorage.getItem('theme') as 'system' | 'dark' | 'light' | null
  const theme = ref<'system' | 'dark' | 'light'>(stored ?? 'system')

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const systemPrefersDark = ref(mq.matches)
  mq.addEventListener('change', e => { systemPrefersDark.value = e.matches })

  const effectiveTheme = computed<'dark' | 'light'>(() =>
    theme.value === 'system' ? (systemPrefersDark.value ? 'dark' : 'light') : theme.value
  )

  function toggleTheme() {
    theme.value = CYCLE[(CYCLE.indexOf(theme.value) + 1) % CYCLE.length]
    localStorage.setItem('theme', theme.value)
  }

  const coordinate = ref<[number, number]>([11.1464, 48.9207])
  const selectedDate = ref<string | null>(null)
  const startDate = ref<string>(fiveYearsAgo)
  const endDate = ref<string>(today)
  const flags = ref<Flags>({})
  const flagLabels = ref<FlagLabels>({})
  /** Temporary labelling state for the currently selected campaign sample.
   *  Updated immediately on every form edit; written to IDB only on Save & Next. */
  const sampleMeta = ref<Record<string, unknown>>({})
  /**
   * Sample ID from the URL when no campaign features are loaded (e.g. User B
   * viewing a shared URL without the campaign in their IDB). Used as a fallback
   * in campaignStore.currentSampleId so the form renders correctly.
   */
  const urlSampleId = ref<string | null>(null)
  /** Sorted list of all observed dates for the current location — set by the active TimeSeriesPanel. */
  const chartDates = ref<string[]>([])
  /** Incremented each time keyboard shortcut 'f' is pressed, watched by FlagEditorPanel to focus its select. */
  const flagDropdownFocusTick = ref(0)
  /** Incremented each time keyboard shortcut 'n' is pressed, watched by CampaignMapPanel to trigger Save & Next. */
  const saveAndNextTick = ref(0)

  function setCoordinate(lon: number, lat: number) {
    coordinate.value = [lon, lat]
  }

  function setSelectedDate(date: string | null) {
    selectedDate.value = date
  }

  function setDateRange(start: string, end: string) {
    startDate.value = start
    endDate.value = end
  }

  function setFlags(f: Flags) {
    flags.value = f
  }

  function setFlagLabels(fl: FlagLabels) {
    flagLabels.value = fl
  }

  function setSampleMeta(meta: Record<string, unknown>) {
    sampleMeta.value = meta
  }

  function setUrlSampleId(id: string | null) {
    urlSampleId.value = id
  }

  function setMetaField(key: string, value: unknown) {
    sampleMeta.value[key] = value
  }

  function setFlag(date: string, value: string) {
    flags.value[date] = value
  }

  function removeFlag(date: string) {
    delete flags.value[date]
  }

  function setChartDates(dates: string[]) {
    chartDates.value = dates
  }

  function requestFlagDropdownFocus() {
    flagDropdownFocusTick.value++
  }

  function requestSaveAndNext() {
    saveAndNextTick.value++
  }

  return {
    coordinate,
    selectedDate,
    startDate,
    endDate,
    flags,
    flagLabels,
    sampleMeta,
    urlSampleId,
    chartDates,
    flagDropdownFocusTick,
    saveAndNextTick,
    setCoordinate,
    setSelectedDate,
    setDateRange,
    setFlags,
    setFlagLabels,
    setSampleMeta,
    setUrlSampleId,
    setMetaField,
    setFlag,
    removeFlag,
    setChartDates,
    requestFlagDropdownFocus,
    requestSaveAndNext,
    theme,
    effectiveTheme,
    toggleTheme,
  }
})
