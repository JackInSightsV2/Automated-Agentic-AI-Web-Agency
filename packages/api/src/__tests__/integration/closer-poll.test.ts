import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { makeLead } from '../helpers/fixtures'

let notifications: string[] = []

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))
mock.module('../../lib/telegram', () => ({
  notify: (msg: string) => { notifications.push(msg); return Promise.resolve() },
  notifyQueueApproval: () => Promise.resolve(),
}))

/** Counting fetch mock: Bland GET returns a completed call, Stripe POST returns a session. */
function installFetch(call: Record<string, unknown>) {
  const counts = { bland: 0, stripe: 0 }
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('bland.ai')) {
      counts.bland++
      return new Response(JSON.stringify(call), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.includes('stripe.com')) {
      counts.stripe++
      return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/pay/cs_1' }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { counts, restore: () => { globalThis.fetch = original } }
}

describe('pollClosingCall', () => {
  let restore: () => void = () => {}

  beforeEach(() => {
    installSupabaseMock()
    store._reset()
    notifications = []
    process.env.BLAND_AI_API_KEY = process.env.BLAND_AI_API_KEY || 'bland-test-key'
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy'
    process.env.STRIPE_PRICE_SETUP = process.env.STRIPE_PRICE_SETUP || 'price_setup_123'
    process.env.STRIPE_PRICE_DOMAIN = process.env.STRIPE_PRICE_DOMAIN || 'price_domain_456'
    // Twilio SDK is mocked globally in setup.ts; make sure SMS path is taken
    process.env.TWILIO_SMS_FROM = process.env.TWILIO_SMS_FROM || '+15551234567'
  })

  afterEach(() => restore())

  test('going ahead: one Stripe session, spec_sent, second poll is a no-op', async () => {
    const lead = makeLead({ status: 'closing_call', closing_call_id: 'cc_1', closing_call_at: new Date().toISOString(), phone: '07700900000' })
    store._seed('leads', [lead])

    const fetchMock = installFetch({
      status: 'completed',
      completed: true,
      summary: 'Customer agreed to proceed. Wants a phone CTA.',
      analysis: { wants_to_go_ahead: true, needs_domain_registration: true, needs_email_setup: true, cta_type: 'phone', cta_value: '07700 900000' },
      transcripts: [{ user: 'customer', text: "Yes let's do it" }],
    })
    restore = fetchMock.restore

    const { pollClosingCall } = await import('../../agents/closer')

    expect(await pollClosingCall(lead.id)).toBe('going_ahead')
    expect(await pollClosingCall(lead.id)).toBeNull()
    expect(await pollClosingCall(lead.id)).toBeNull()

    expect(fetchMock.counts.stripe).toBe(1)
    expect(notifications.length).toBe(1)

    const updated = store._get('leads')[0]
    expect(updated.status).toBe('spec_sent')
    expect(updated.stripe_payment_link).toBe('https://checkout.stripe.com/pay/cs_1')
    expect(updated.needs_domain).toBe(true)
    expect(updated.cta_type).toBe('phone')
    expect(updated.total_price).toBe(35 + 25)
  })

  test('undecided: hitl_ready, no Stripe session', async () => {
    const lead = makeLead({ status: 'closing_call', closing_call_id: 'cc_2', closing_call_at: new Date().toISOString() })
    store._seed('leads', [lead])

    const fetchMock = installFetch({
      status: 'completed', completed: true,
      summary: 'Customer wants to think about it and will call back.',
      transcripts: [{ user: 'customer', text: 'Let me think about it' }],
    })
    restore = fetchMock.restore

    const { pollClosingCall } = await import('../../agents/closer')
    expect(await pollClosingCall(lead.id)).toBe('undecided')
    expect(fetchMock.counts.stripe).toBe(0)
    expect(store._get('leads')[0].status).toBe('hitl_ready')
  })

  test('lead already past closing_call is ignored', async () => {
    const lead = makeLead({ status: 'spec_sent', closing_call_id: 'cc_3', closing_summary: 'done' })
    store._seed('leads', [lead])
    const fetchMock = installFetch({ status: 'completed', completed: true, summary: 'agreed to proceed' })
    restore = fetchMock.restore

    const { pollClosingCall } = await import('../../agents/closer')
    expect(await pollClosingCall(lead.id)).toBeNull()
    expect(fetchMock.counts.bland).toBe(0)
  })

  test('call that failed on Bland side → hitl_ready for the human', async () => {
    const lead = makeLead({ status: 'closing_call', closing_call_id: 'cc_4', closing_call_at: new Date().toISOString() })
    store._seed('leads', [lead])
    const fetchMock = installFetch({ status: 'failed', completed: false, error_message: 'no answer' })
    restore = fetchMock.restore

    const { pollClosingCall } = await import('../../agents/closer')
    expect(await pollClosingCall(lead.id)).toBe('no_answer')
    expect(store._get('leads')[0].status).toBe('hitl_ready')
    expect(fetchMock.counts.stripe).toBe(0)
  })
})
