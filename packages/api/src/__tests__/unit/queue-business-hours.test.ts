import { describe, test, expect, beforeEach, afterEach, setSystemTime } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'

describe('isWithinBusinessHours', () => {
  beforeEach(() => {
    installSupabaseMock()
    store._reset()
    // Seed default business hours config
    store._seed('system_config', [
      {
        key: 'business_hours',
        value: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], timezone: 'Europe/London' },
      },
    ])
  })

  afterEach(() => {
    setSystemTime() // reset to real time
  })

  test('10:00 Mon London → true', async () => {
    // Monday 10:00 UTC (London is UTC in winter)
    setSystemTime(new Date('2026-01-05T10:00:00Z')) // Mon 5 Jan 2026
    const { isWithinBusinessHours } = await import('../../lib/queue')
    const result = await isWithinBusinessHours()
    expect(result).toBe(true)
  })

  test('20:00 Mon London → false', async () => {
    setSystemTime(new Date('2026-01-05T20:00:00Z')) // Mon 8pm
    const { isWithinBusinessHours } = await import('../../lib/queue')
    const result = await isWithinBusinessHours()
    expect(result).toBe(false)
  })

  test('Saturday → false', async () => {
    setSystemTime(new Date('2026-01-10T12:00:00Z')) // Sat noon
    const { isWithinBusinessHours } = await import('../../lib/queue')
    const result = await isWithinBusinessHours()
    expect(result).toBe(false)
  })
})
