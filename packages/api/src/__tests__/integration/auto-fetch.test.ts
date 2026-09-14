import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeQueueItem } from '../helpers/fixtures'

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))
mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
  notifyQueueApproval: () => Promise.resolve(),
}))

const ACTIVE = { verify: 'active', copywrite: 'active', build: 'active', seo: 'active', review: 'active', deploy: 'active', call: 'active', followup: 'active', close: 'active' }

// A scout run is observable as a new pipeline_runs row (inserted synchronously
// inside autoFetchLeads before the pipeline itself is fired off).
const runsStarted = () => store._get('pipeline_runs').length

describe('autoFetchLeads', () => {
  beforeEach(async () => {
    installSupabaseMock()
    store._reset()
    process.env.MOCK_SCOUT = 'true' // real runPipeline, but scouting from bundled sample data
    store._seed('system_config', [{ key: 'queue_states', value: ACTIVE }, { key: 'hitl_config', value: {} }])
    store._seed('agent_logs', [])
    store._seed('pipeline_runs', [])
    store._seed('leads', [])
    const { clearConfigCache } = await import('../../lib/queue')
    clearConfigCache()
  })

  afterEach(async () => {
    // Let any fire-and-forget pipeline finish before the next test resets the store
    await new Promise(r => setTimeout(r, 20))
  })

  test('does nothing before any lead reaches the call stage', async () => {
    store._seed('queue_items', [makeQueueItem({ queue_name: 'verify', status: 'pending' })])
    const { autoFetchLeads } = await import('../../lib/crons')
    await autoFetchLeads()
    expect(runsStarted()).toBe(0)
  })

  test('scouts when a lead is waiting at call and the pipeline is not full', async () => {
    store._seed('queue_items', [
      makeQueueItem({ queue_name: 'call', status: 'pending_approval' }),
      makeQueueItem({ queue_name: 'build', status: 'processing' }),
    ])
    const { autoFetchLeads } = await import('../../lib/crons')
    await autoFetchLeads()
    expect(runsStarted()).toBe(1)
  })

  test('stops once AUTO_FETCH_MAX_INFLIGHT items are in flight (default 10)', async () => {
    const items = [makeQueueItem({ queue_name: 'call', status: 'pending_approval' })]
    for (let i = 0; i < 9; i++) items.push(makeQueueItem({ queue_name: 'build', status: 'pending' }))
    store._seed('queue_items', items)

    const { autoFetchLeads } = await import('../../lib/crons')
    await autoFetchLeads()
    expect(runsStarted()).toBe(0)
  })

  test('completed items do not count towards the cap', async () => {
    const items = [makeQueueItem({ queue_name: 'call', status: 'pending_approval' })]
    for (let i = 0; i < 20; i++) items.push(makeQueueItem({ queue_name: 'build', status: 'completed' }))
    store._seed('queue_items', items)

    const { autoFetchLeads } = await import('../../lib/crons')
    await autoFetchLeads()
    expect(runsStarted()).toBe(1)
  })

  test('does not scout while the verify queue is paused', async () => {
    store._seed('system_config', [{ key: 'queue_states', value: { ...ACTIVE, verify: 'paused' } }, { key: 'hitl_config', value: {} }])
    const { clearConfigCache } = await import('../../lib/queue')
    clearConfigCache()
    store._seed('queue_items', [makeQueueItem({ queue_name: 'call', status: 'pending_approval' })])

    const { autoFetchLeads } = await import('../../lib/crons')
    await autoFetchLeads()
    expect(runsStarted()).toBe(0)
  })
})
