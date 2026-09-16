import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { mockFetch } from '../helpers/mock-fetch'
import { makeLead } from '../helpers/fixtures'

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))
mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
  notifyQueueApproval: () => Promise.resolve(),
}))

const AUTO_ALL = { verify: 'auto', copywrite: 'auto', build: 'auto', seo: 'auto', review: 'auto', deploy: 'auto', call: 'auto', followup: 'auto', close: 'auto' }

describe('pollBlandCall', () => {
  let restoreFetch: () => void

  beforeEach(async () => {
    installSupabaseMock()
    store._reset()
    store._seed('system_config', [{ key: 'hitl_config', value: AUTO_ALL }])
    store._seed('queue_items', [])
    process.env.BLAND_AI_API_KEY = process.env.BLAND_AI_API_KEY || 'bland-test-key'
    const { clearConfigCache } = await import('../../lib/queue')
    clearConfigCache()
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
  })

  test('in-progress call → null, nothing changes', async () => {
    const lead = makeLead({ status: 'called', bland_call_id: 'call_1', call_completed_at: null, call_initiated_at: new Date().toISOString() })
    store._seed('leads', [lead])
    restoreFetch = mockFetch([{ url: /bland\.ai\/v1\/calls\/call_1/, response: { status: 'in-progress', completed: false } }])

    const { pollBlandCall } = await import('../../agents/caller')
    expect(await pollBlandCall(lead.id)).toBeNull()
    expect(store._get('leads')[0].call_outcome).toBeNull()
    expect(store._get('queue_items').length).toBe(0)
  })

  test('completed call records outcome, promotes interested leads, enqueues followup once', async () => {
    const lead = makeLead({ status: 'called', bland_call_id: 'call_2', call_completed_at: null, call_initiated_at: new Date().toISOString(), pipeline_run_id: 'run-1' })
    store._seed('leads', [lead])
    restoreFetch = mockFetch([{
      url: /bland\.ai\/v1\/calls\/call_2/,
      response: {
        status: 'completed',
        completed: true,
        summary: 'Spoke to Sarah, she is interested and asked us to text the link.',
        disposition_tag: 'interested', answered_by: 'human', analysis: { contact_name: 'Sarah', email: null },
        transcripts: [],
      },
    }])

    const { pollBlandCall } = await import('../../agents/caller')
    expect(await pollBlandCall(lead.id)).toBe('interested')
    // Second poll (next cron tick) is a no-op
    expect(await pollBlandCall(lead.id)).toBeNull()

    const updated = store._get('leads')[0]
    expect(updated.call_outcome).toBe('interested')
    expect(updated.status).toBe('hitl_ready')
    expect(updated.contact_name).toBe('Sarah')
    expect(updated.call_completed_at).toBeTruthy()

    const items = store._get('queue_items')
    expect(items.length).toBe(1)
    expect(items[0].queue_name).toBe('followup')
    expect(items[0].pipeline_run_id).toBe('run-1')
  })

  test('not interested → no follow-up queued', async () => {
    const lead = makeLead({ status: 'called', bland_call_id: 'call_3', call_completed_at: null, call_initiated_at: new Date().toISOString() })
    store._seed('leads', [lead])
    restoreFetch = mockFetch([{
      url: /bland\.ai\/v1\/calls\/call_3/,
      response: { status: 'completed', completed: true, summary: 'They said they were not interested.', transcripts: [] },
    }])

    const { pollBlandCall } = await import('../../agents/caller')
    expect(await pollBlandCall(lead.id)).toBe('not_interested')
    expect(store._get('leads')[0].status).toBe('called')
    expect(store._get('queue_items').length).toBe(0)
  })

  test('call that never completes times out as no_answer', async () => {
    const { CALL_TIMEOUT_MS } = await import('../../agents/caller')
    const lead = makeLead({
      status: 'called', bland_call_id: 'call_4', call_completed_at: null,
      call_initiated_at: new Date(Date.now() - CALL_TIMEOUT_MS - 1000).toISOString(),
    })
    store._seed('leads', [lead])
    restoreFetch = mockFetch([{ url: /bland\.ai\/v1\/calls\/call_4/, response: { status: 'queued', completed: false } }])

    const { pollBlandCall } = await import('../../agents/caller')
    expect(await pollBlandCall(lead.id)).toBe('no_answer')
    expect(store._get('leads')[0].call_completed_at).toBeTruthy()
    expect(store._get('queue_items').map(i => i.queue_name)).toEqual(['followup'])
  })
})
