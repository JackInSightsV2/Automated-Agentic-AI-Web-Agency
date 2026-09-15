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
  beforeEach(async () => {
    installSupabaseMock()
    store._reset()
    const { clearConfigCache } = await import('../../lib/queue')
    clearConfigCache()

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

  test('getQueueStats aggregates every queue from one query', async () => {
    store._seed('queue_items', [
      makeQueueItem({ queue_name: 'verify', status: 'pending' }),
      makeQueueItem({ queue_name: 'verify', status: 'pending' }),
      makeQueueItem({ queue_name: 'build', status: 'processing' }),
      makeQueueItem({ queue_name: 'call', status: 'pending_approval' }),
      makeQueueItem({ queue_name: 'seo', status: 'failed' }),
      makeQueueItem({ queue_name: 'seo', status: 'completed' }), // not counted
    ])

    const { getQueueStats } = await import('../../lib/queue')
    const stats = await getQueueStats()

    expect(stats.verify.pending).toBe(2)
    expect(stats.build.processing).toBe(1)
    expect(stats.call.pending_approval).toBe(1)
    expect(stats.seo.failed).toBe(1)
    expect(stats.seo.pending).toBe(0)
    // Every queue is present even with no items
    expect(stats.copywrite).toEqual({ pending: 0, processing: 0, failed: 0, pending_approval: 0 })
    expect(Object.keys(stats).length).toBe(9)
  })

  test('setQueueState invalidates the config cache', async () => {
    const { getQueueStates, setQueueState } = await import('../../lib/queue')
    expect((await getQueueStates()).build).toBe('active')
    await setQueueState('build', 'paused')
    expect((await getQueueStates()).build).toBe('paused')
  })
})

describe('recoverStaleItems', () => {
  beforeEach(async () => {
    installSupabaseMock()
    store._reset()
    const { clearConfigCache } = await import('../../lib/queue')
    clearConfigCache()
  })

  test('maxAge 0 (startup) fails every processing item', async () => {
    const fresh = makeQueueItem({ queue_name: 'build', status: 'processing', updated_at: new Date().toISOString() })
    const pending = makeQueueItem({ queue_name: 'build', status: 'pending' })
    store._seed('queue_items', [fresh, pending])

    const { recoverStaleItems } = await import('../../lib/queue')
    const recovered = await recoverStaleItems(0)

    expect(recovered.map(i => i.id)).toEqual([fresh.id])
    const items = store._get('queue_items')
    expect(items.find(i => i.id === fresh.id)?.status).toBe('failed')
    expect(items.find(i => i.id === fresh.id)?.error).toContain('restarted')
    expect(items.find(i => i.id === pending.id)?.status).toBe('pending')
  })

  test('only items older than maxAge are failed', async () => {
    const old = makeQueueItem({ queue_name: 'seo', status: 'processing', updated_at: new Date(Date.now() - 45 * 60000).toISOString() })
    const recent = makeQueueItem({ queue_name: 'seo', status: 'processing', updated_at: new Date(Date.now() - 5 * 60000).toISOString() })
    store._seed('queue_items', [old, recent])

    const { recoverStaleItems } = await import('../../lib/queue')
    const recovered = await recoverStaleItems(30 * 60000)

    expect(recovered.map(i => i.id)).toEqual([old.id])
    const items = store._get('queue_items')
    expect(items.find(i => i.id === old.id)?.status).toBe('failed')
    expect(items.find(i => i.id === recent.id)?.status).toBe('processing')
  })
})
