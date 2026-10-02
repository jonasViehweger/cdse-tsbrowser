import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let scheduler: typeof import('./requestScheduler')

/** Start `n` acquisitions and record the order they are granted in. */
function acquire(n: number, priority: 'foreground' | 'background', granted: string[], label = priority) {
  for (let i = 0; i < n; i++) scheduler.acquireSlot(priority).then(() => granted.push(`${label}${i}`))
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  scheduler = await import('./requestScheduler')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('acquireSlot', () => {
  it('lets one request through every 200 ms', async () => {
    const granted: string[] = []
    acquire(3, 'foreground', granted)
    await vi.advanceTimersByTimeAsync(0)
    expect(granted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(199)
    expect(granted).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(granted).toHaveLength(3)
  })

  it('serves waiting foreground requests before background ones', async () => {
    const granted: string[] = []
    acquire(2, 'background', granted)
    await vi.advanceTimersByTimeAsync(0)
    acquire(1, 'foreground', granted)
    await vi.advanceTimersByTimeAsync(400)
    expect(granted).toEqual(['background0', 'foreground0', 'background1'])
  })

  it('holds every request back after a pause', async () => {
    const granted: string[] = []
    scheduler.pauseFor(1000)
    acquire(1, 'foreground', granted)
    await vi.advanceTimersByTimeAsync(999)
    expect(granted).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(granted).toHaveLength(1)
  })
})
