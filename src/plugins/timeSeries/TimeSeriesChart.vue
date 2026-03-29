<template>
  <div ref="containerRef" class="chart-container"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { TimeSeriesPoint } from '../../types/api'
import type { Flags, FlagLabels } from '../../types/state'
import { buildUplotData } from '../../utils/chartData'
import { flagColour as sharedFlagColour } from '../../utils/flagColour'
import { useAppStore } from '../../stores/app'

const appStore = useAppStore()

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const props = defineProps<{
  data: TimeSeriesPoint[]
  flags: Flags
  flagLabels: FlagLabels
  selectedDate: string | null
  yMin: number | null
  yMax: number | null
  unit: string
}>()

const emit = defineEmits<{
  pointClick: [date: string]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let uplot: uPlot | null = null
let resizeObserver: ResizeObserver | null = null

function flagColour(value: string): string {
  return sharedFlagColour(value, props.flagLabels, props.flags)
}


function getSize(): { width: number; height: number } {
  const el = containerRef.value
  if (!el) return { width: 300, height: 200 }
  return { width: el.clientWidth || 300, height: el.clientHeight || 200 }
}

function drawAnnotations(u: uPlot) {
  const ctx = u.ctx
  ctx.save()

  // Draw flag markers
  const flagEntries = Object.entries(props.flags)
  const seenValues: string[] = []
  for (const [dateStr, flagValue] of flagEntries) {
    const ts = Date.parse(dateStr) / 1000
    const cx = Math.round(u.valToPos(ts, 'x', true))
    if (cx < u.bbox.left || cx > u.bbox.left + u.bbox.width) continue

    const colour = flagColour(flagValue)
    ctx.strokeStyle = colour
    ctx.lineWidth = 2
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(cx, u.bbox.top)
    ctx.lineTo(cx, u.bbox.top + u.bbox.height)
    ctx.stroke()

    if (!seenValues.includes(flagValue)) {
      const label = flagValue
      ctx.fillStyle = colour
      ctx.font = '11px sans-serif'
      ctx.fillText(label, cx + 4, u.bbox.top + 14)
      seenValues.push(flagValue)
    }
  }

  // Draw selected-date indicator
  if (props.selectedDate) {
    const ts = Date.parse(props.selectedDate) / 1000
    const cx = Math.round(u.valToPos(ts, 'x', true))
    if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
      ctx.strokeStyle = cssVar('--accent')
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(cx, u.bbox.top)
      ctx.lineTo(cx, u.bbox.top + u.bbox.height)
      ctx.stroke()
    }
  }

  ctx.restore()
}

function createChart() {
  if (!containerRef.value) return
  const { width, height } = getSize()

  const opts: uPlot.Options = {
    width,
    height,
    scales: {
      x: { time: true },
      y: {
        range: props.yMin != null && props.yMax != null
          ? [props.yMin, props.yMax]
          : undefined,
      },
    },
    axes: [
      { stroke: cssVar('--text-muted'), ticks: { stroke: cssVar('--border') }, grid: { stroke: cssVar('--border') } },
      {
        label: props.unit,
        stroke: cssVar('--text-muted'),
        ticks: { stroke: cssVar('--border') },
        grid: { stroke: cssVar('--border') },
      },
    ],
    series: [
      {},
      {
        label: props.unit,
        stroke: cssVar('--accent'),
        width: 0,
        paths: () => null,
        points: { show: true, size: 8, fill: cssVar('--accent') },
      },
    ],
    hooks: {
      draw: [drawAnnotations],
      ready: [
        (u: uPlot) => {
          u.over.addEventListener('click', (e: MouseEvent) => {
            // u.over spans the full canvas width, so e.offsetX is already canvas-relative
            const clickTs = u.posToVal(e.offsetX, 'x')

            // Find the nearest non-null data point by timestamp distance
            const xs = u.data[0]
            const ys = u.data[1] as (number | null)[]
            let nearest = -1
            let minDist = Infinity
            for (let i = 0; i < xs.length; i++) {
              if (ys[i] == null) continue
              const dist = Math.abs(xs[i] - clickTs)
              if (dist < minDist) { minDist = dist; nearest = i }
            }
            if (nearest >= 0) {
              const dateStr = new Date(xs[nearest] * 1000).toISOString().slice(0, 10)
              emit('pointClick', dateStr)
            }
          })
        },
      ],
    },
    cursor: { show: true, x: false, y: false, drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
  }

  uplot = new uPlot(opts, buildUplotData(props.data), containerRef.value)
}

function destroyChart() {
  if (uplot) {
    uplot.destroy()
    uplot = null
  }
}

onMounted(() => {
  createChart()

  resizeObserver = new ResizeObserver(() => {
    if (uplot) {
      const { width, height } = getSize()
      uplot.setSize({ width, height })
    }
  })
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  destroyChart()
})

// Update data when it changes
watch(
  () => props.data,
  () => {
    if (uplot) {
      uplot.setData(buildUplotData(props.data))
    }
  },
)

// Redraw annotations when flags or selectedDate change (fast path — no data re-draw)
watch(
  [() => props.flags, () => props.flagLabels, () => props.selectedDate],
  () => {
    if (uplot) {
      uplot.redraw(false, true)
    }
  },
  { deep: true },
)

// Recreate chart when y-limits, unit, or theme change
watch(
  [() => props.yMin, () => props.yMax, () => props.unit, () => appStore.theme],
  () => {
    destroyChart()
    createChart()
  },
)
</script>

<style scoped>
.chart-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
