import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeLead } from '../helpers/fixtures'

// Install mocks before importing routers
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

describe('pipeline routes', () => {
  let app: ReturnType<typeof createTestApp>

  beforeEach(() => {
    store._reset()
    app = createTestApp()
  })

  test('GET /pipeline/leads → returns leads', async () => {
    const lead = makeLead({ name: 'Pipeline Lead' })
    store._seed('leads', [lead])

    const res = await app.request('/pipeline/leads')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(1)
    expect(body[0].name).toBe('Pipeline Lead')
  })

  test('GET /pipeline/leads?status=verified → filtered', async () => {
    store._seed('leads', [
      makeLead({ name: 'Verified One', status: 'verified' }),
      makeLead({ name: 'Discovered One', status: 'discovered' }),
    ])

    const res = await app.request('/pipeline/leads?status=verified')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.length).toBe(1)
    expect(body[0].name).toBe('Verified One')
  })

  test('GET /pipeline/track/open/:id → returns 1x1 GIF', async () => {
    store._seed('leads', [makeLead({ id: 'lead-open-test' })])

    const res = await app.request('/pipeline/track/open/lead-open-test')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
  })

  test('GET /pipeline/track/click/:id?redirect=evil.com → redirects to /', async () => {
    store._seed('leads', [makeLead({ id: 'lead-click-test' })])

    const res = await app.request('/pipeline/track/click/lead-click-test?redirect=https://evil.com')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })

  test('GET /pipeline/track/click/:id?redirect=vercel.app → allows', async () => {
    store._seed('leads', [makeLead({ id: 'lead-click-ok' })])

    const res = await app.request('/pipeline/track/click/lead-click-ok?redirect=https://mybiz.vercel.app')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://mybiz.vercel.app')
  })
})
