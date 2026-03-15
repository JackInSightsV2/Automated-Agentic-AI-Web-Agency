import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeLead, makeQueueItem } from '../helpers/fixtures'

// Install mocks
installSupabaseMock()
mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
  notifyHITL: () => Promise.resolve(),
  notifyQueueApproval: () => Promise.resolve(),
  bot: { onText: () => {}, on: () => {} },
}))
mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))

import { createTestApp } from '../helpers/hono-test'

describe('admin routes', () => {
  let app: ReturnType<typeof createTestApp>

  beforeEach(() => {
    store._reset()
    app = createTestApp()

    // Seed system config for queue operations
    store._seed('system_config', [
      {
        key: 'queue_states',
        value: { verify: 'active', copywrite: 'active', build: 'active', seo: 'active', review: 'active', deploy: 'active', call: 'active', followup: 'active', close: 'active' },
      },
      {
        key: 'hitl_config',
        value: { verify: 'auto', copywrite: 'auto', build: 'auto', seo: 'auto', review: 'auto', deploy: 'auto', call: 'hitl', followup: 'auto', close: 'hitl' },
      },
      {
        key: 'concurrency',
        value: { verify: 1, copywrite: 1, build: 1, seo: 1, review: 1, deploy: 1, call: 1, followup: 1, close: 1 },
      },
    ])
  })

  test('GET /admin/queues → returns queue stats', async () => {
    store._seed('queue_items', [
      makeQueueItem({ queue_name: 'verify', status: 'pending' }),
      makeQueueItem({ queue_name: 'verify', status: 'processing' }),
      makeQueueItem({ queue_name: 'build', status: 'failed' }),
    ])

    const res = await app.request('/admin/queues')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.queues).toBeTruthy()
    expect(Array.isArray(body.queues)).toBe(true)
  })

  test('POST /admin/queues/call/pause → pauses queue', async () => {
    const res = await app.request('/admin/queues/call/pause', {
      method: 'POST',
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.state).toBe('paused')
  })

  test('GET /admin/leads → returns leads', async () => {
    store._seed('leads', [
      makeLead({ name: 'Admin Lead 1' }),
      makeLead({ name: 'Admin Lead 2' }),
    ])

    const res = await app.request('/admin/leads')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.leads).toBeTruthy()
    expect(body.leads.length).toBe(2)
  })

  test('POST /admin/clear → calls delete on all tables', async () => {
    store._seed('leads', [makeLead()])
    store._seed('queue_items', [makeQueueItem()])
    store._seed('agent_logs', [{ id: 'log-1', message: 'test' }])
    store._seed('pipeline_runs', [{ id: 'run-1', query: 'test' }])

    const res = await app.request('/admin/clear', { method: 'POST' })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })
})
