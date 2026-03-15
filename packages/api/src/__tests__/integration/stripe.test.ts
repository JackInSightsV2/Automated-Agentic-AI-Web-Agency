import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mockFetch } from '../helpers/mock-fetch'

describe('Stripe operations', () => {
  let restoreFetch: () => void

  beforeEach(() => {
    // Ensure env vars are set (may be cleared by other test files)
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy'
    process.env.STRIPE_PRICE_SETUP = process.env.STRIPE_PRICE_SETUP || 'price_setup_123'
    process.env.STRIPE_PRICE_DOMAIN = process.env.STRIPE_PRICE_DOMAIN || 'price_domain_456'
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
  })

  test('createCheckoutLink calls API with correct params', async () => {
    let capturedBody = ''

    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string || ''
      return new Response(JSON.stringify({
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        id: 'cs_test_123',
      }))
    }) as unknown as typeof fetch

    restoreFetch = () => { globalThis.fetch = origFetch }

    const { createCheckoutLink } = await import('../../lib/stripe')
    const url = await createCheckoutLink('lead-123', 'Test Biz', false)

    expect(url).toBe('https://checkout.stripe.com/pay/cs_test_123')
    expect(capturedBody).toContain('lead-123')
    expect(capturedBody).toContain('Test%20Biz')
    expect(capturedBody).not.toContain('line_items%5B1%5D')
  })

  test('adds domain line item when needsDomain=true', async () => {
    let capturedBody = ''

    const origFetch = globalThis.fetch
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string || ''
      return new Response(JSON.stringify({
        url: 'https://checkout.stripe.com/pay/cs_test_456',
        id: 'cs_test_456',
      }))
    }) as unknown as typeof fetch

    restoreFetch = () => { globalThis.fetch = origFetch }

    const { createCheckoutLink } = await import('../../lib/stripe')
    const url = await createCheckoutLink('lead-456', 'Domain Biz', true)

    expect(url).toBe('https://checkout.stripe.com/pay/cs_test_456')
    expect(capturedBody).toContain('line_items%5B1%5D')
    expect(capturedBody).toContain('price_domain_456')
  })

  test('checkPaidSessions filters correctly', async () => {
    restoreFetch = mockFetch([
      {
        url: /stripe.*checkout\/sessions/,
        response: {
          data: [
            { id: 'cs_1', metadata: { lead_id: 'lead-A' }, amount_total: 3500, payment_status: 'paid' },
            { id: 'cs_2', metadata: { lead_id: 'lead-B' }, amount_total: 6000, payment_status: 'paid' },
            { id: 'cs_3', metadata: {}, amount_total: 3500, payment_status: 'paid' },
            { id: 'cs_4', metadata: { lead_id: 'lead-C' }, amount_total: 3500, payment_status: 'unpaid' },
          ],
        },
      },
    ])

    const { checkPaidSessions } = await import('../../lib/stripe')
    const sessions = await checkPaidSessions()

    expect(sessions.length).toBe(2)
    expect(sessions[0].leadId).toBe('lead-A')
    expect(sessions[0].amountTotal).toBe(35)
    expect(sessions[1].leadId).toBe('lead-B')
    expect(sessions[1].amountTotal).toBe(60)
  })
})
