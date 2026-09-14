import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeLead } from '../helpers/fixtures'

let deliveries: string[] = []
let notifications: string[] = []

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))
mock.module('../../lib/telegram', () => ({
  notify: (msg: string) => { notifications.push(msg); return Promise.resolve() },
  notifyQueueApproval: () => Promise.resolve(),
}))
mock.module('../../agents/delivery', () => ({
  runDeliveryPipeline: (id: string) => { deliveries.push(id); return Promise.resolve() },
  applyDeliveryChanges: () => Promise.resolve(true),
}))

describe('markLeadPaid', () => {
  beforeEach(() => {
    installSupabaseMock()
    store._reset()
    deliveries = []
    notifications = []
  })

  test('transitions spec_sent → paid exactly once and starts delivery once', async () => {
    const lead = makeLead({ status: 'spec_sent', total_price: 35 })
    store._seed('leads', [lead])

    const { markLeadPaid } = await import('../../lib/payments')

    // Poller and webhook race for the same payment
    const [a, b] = await Promise.all([
      markLeadPaid(lead.id, { source: 'stripe-poll', amount: 35 }),
      markLeadPaid(lead.id, { source: 'stripe-webhook', amount: 35 }),
    ])
    const third = await markLeadPaid(lead.id, { source: 'stripe-poll', amount: 35 })

    expect([a, b].filter(Boolean).length).toBe(1)
    expect(third).toBe(false)
    expect(deliveries).toEqual([lead.id])
    expect(notifications.length).toBe(1)

    const updated = store._get('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('paid')
    expect(updated?.paid_at).toBeTruthy()
  })

  test('ignores leads that are not awaiting payment', async () => {
    const lead = makeLead({ status: 'called' })
    store._seed('leads', [lead])

    const { markLeadPaid } = await import('../../lib/payments')
    expect(await markLeadPaid(lead.id, { source: 'stripe-webhook' })).toBe(false)
    expect(deliveries).toEqual([])
    expect(store._get('leads')[0].status).toBe('called')
  })

  test('force (manual) works from any status but never twice', async () => {
    const lead = makeLead({ status: 'hitl_ready' })
    store._seed('leads', [lead])

    const { markLeadPaid } = await import('../../lib/payments')
    expect(await markLeadPaid(lead.id, { source: 'manual', force: true })).toBe(true)
    expect(await markLeadPaid(lead.id, { source: 'manual', force: true })).toBe(false)
    expect(deliveries).toEqual([lead.id])
  })
})
