import { describe, test, expect, mock } from 'bun:test'
import { installSupabaseMock } from '../helpers/mock-supabase'

// Install mocks before importing the app
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

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const app = createTestApp()
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBe('webagency-os')
  })
})
