import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeLead, makeQueueItem } from '../helpers/fixtures'

// Mock telegram and logger
mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
  notifyQueueApproval: () => Promise.resolve(),
}))
mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))

describe('queue operations', () => {
  beforeEach(() => {
    installSupabaseMock()
    store._reset()

    // Seed system config
    store._seed('system_config', [
      {
        key: 'hitl_config',
        value: { verify: 'auto', copywrite: 'auto', build: 'auto', seo: 'auto', review: 'auto', deploy: 'auto', call: 'hitl', followup: 'auto', close: 'hitl' },
      },
      {
        key: 'concurrency',
        value: { verify: 2, copywrite: 1, build: 1, seo: 1, review: 1, deploy: 1, call: 1, followup: 1, close: 1 },
      },
      {
        key: 'queue_states',
        value: { verify: 'active', copywrite: 'active', build: 'active', seo: 'active', review: 'active', deploy: 'active', call: 'active', followup: 'active', close: 'active' },
      },
    ])
  })

  test('enqueue inserts "pending" when HITL auto', async () => {
    const lead = makeLead()
    store._seed('leads', [lead])
    store._seed('queue_items', [])

    const { enqueue } = await import('../../lib/queue')
    const id = await enqueue({ leadId: lead.id, queueName: 'verify' })

    expect(id).toBeTruthy()
    const items = store._get('queue_items')
    expect(items.length).toBe(1)
    expect(items[0].status).toBe('pending')
  })

  test('enqueue inserts "pending_approval" when HITL on', async () => {
    const lead = makeLead()
    store._seed('leads', [lead])
    store._seed('queue_items', [])

    const { enqueue } = await import('../../lib/queue')
    const id = await enqueue({ leadId: lead.id, queueName: 'call' }) // call has hitl: 'hitl'

    expect(id).toBeTruthy()
    const items = store._get('queue_items')
    expect(items.length).toBe(1)
    expect(items[0].status).toBe('pending_approval')
  })

  test('dequeue returns null at concurrency limit', async () => {
    // Seed 1 processing item (concurrency for call is 1)
    store._seed('queue_items', [
      makeQueueItem({ queue_name: 'call', status: 'approved' }),
      makeQueueItem({ queue_name: 'call', status: 'processing' }),
    ])

    const { dequeue } = await import('../../lib/queue')
    const item = await dequeue('call')
    expect(item).toBeNull()
  })

  test('dequeue atomically marks "processing"', async () => {
    const pending = makeQueueItem({ queue_name: 'verify', status: 'pending' })
    store._seed('queue_items', [pending])

    const { dequeue } = await import('../../lib/queue')
    const item = await dequeue('verify')

    expect(item).toBeTruthy()
    expect(item?.status).toBe('processing')
  })

  test('completeItem updates status correctly', async () => {
    const item = makeQueueItem({ status: 'processing' })
    store._seed('queue_items', [item])

    const { completeItem } = await import('../../lib/queue')
    await completeItem(item.id)

    const updated = store._get('queue_items').find(i => i.id === item.id)
    expect(updated?.status).toBe('completed')
  })

  test('failItem updates status and error', async () => {
    const item = makeQueueItem({ status: 'processing', attempts: 0 })
    store._seed('queue_items', [item])

    const { failItem } = await import('../../lib/queue')
    await failItem(item.id, 'Something went wrong')

    const updated = store._get('queue_items').find(i => i.id === item.id)
    expect(updated?.status).toBe('failed')
    expect(updated?.error).toBe('Something went wrong')
  })
})
