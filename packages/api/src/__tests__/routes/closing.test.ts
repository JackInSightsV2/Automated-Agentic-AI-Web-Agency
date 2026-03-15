import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import crypto from 'node:crypto'

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

describe('closing routes', () => {
  let app: ReturnType<typeof createTestApp>

  beforeEach(() => {
    store._reset()
    // Ensure webhook secret is set (may be deleted by other tests)
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
    app = createTestApp()
  })

  test('POST /closing/stripe/webhook valid sig → 200', async () => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET!
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { metadata: { lead_id: 'lead-pay-1' }, amount_total: 3500 } },
    })
    const timestamp = Math.floor(Date.now() / 1000)
    const signedPayload = `${timestamp}.${payload}`
    const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
    const signature = `t=${timestamp},v1=${sig}`

    const res = await app.request('/closing/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.received).toBe(true)
  })

  test('POST /closing/stripe/webhook invalid sig → 400', async () => {
    const payload = JSON.stringify({ type: 'checkout.session.completed' })
    // Use a valid-length hex string (64 chars = 32 bytes, matches SHA-256 output)
    const fakeSig = 'a'.repeat(64)

    const res = await app.request('/closing/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${fakeSig}`,
      },
      body: payload,
    })

    expect(res.status).toBe(400)
  })

  test('GET /closing/payment-success → HTML with agency name', async () => {
    const res = await app.request('/closing/payment-success')

    expect(res.status).toBe(200)
    const html = await res.text()
    // agency.name reads from process.env.AGENCY_NAME dynamically
    const expectedName = process.env.AGENCY_NAME || 'Web Agency'
    expect(html).toContain(expectedName)
    expect(html).toContain('Thanks for your payment')
  })
})
