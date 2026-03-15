import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { mockFetch } from '../helpers/mock-fetch'
import { makeLead } from '../helpers/fixtures'

// Mock logger and telegram
mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))
mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
}))

describe('runVerifierAgent', () => {
  let restoreFetch: () => void

  beforeEach(() => {
    installSupabaseMock()
    store._reset()
    // Ensure env vars are set (may be cleared by other test files)
    process.env.COMPANIES_HOUSE_API_KEY = process.env.COMPANIES_HOUSE_API_KEY || 'ch-test-key'
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
  })

  test('active company on Companies House → +30 score', async () => {
    const lead = makeLead({ name: 'Test Corp', google_rating: 4.5, google_review_count: 30 })
    store._seed('leads', [lead])

    restoreFetch = mockFetch([
      {
        url: /company-information.*search/,
        response: {
          items: [{ company_name: 'Test Corp', company_number: '12345678', company_status: 'active' }],
        },
      },
      {
        url: /filing-history/,
        response: {
          items: [{ date: new Date().toISOString().split('T')[0], description: 'Confirmation statement', type: 'CS01' }],
        },
      },
      {
        url: /hmrc\.gov\.uk/,
        status: 404,
        response: {},
      },
    ])

    const { runVerifierAgent } = await import('../../agents/verifier')
    const viable = await runVerifierAgent(lead.id)

    expect(viable).toBe(true)
    const updated = store._get('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('verified')
    expect((updated?.viability_score as number)).toBeGreaterThanOrEqual(40)
  })

  test('dissolved company → -50 score → rejected', async () => {
    const lead = makeLead({ name: 'Dead Corp', google_rating: null, google_review_count: null, phone: null })
    store._seed('leads', [lead])

    restoreFetch = mockFetch([
      {
        url: /company-information.*search/,
        response: {
          items: [{ company_name: 'Dead Corp', company_number: '99999999', company_status: 'dissolved' }],
        },
      },
      {
        url: /filing-history/,
        response: { items: [] },
      },
      {
        url: /hmrc\.gov\.uk/,
        status: 404,
        response: {},
      },
    ])

    const { runVerifierAgent } = await import('../../agents/verifier')
    const viable = await runVerifierAgent(lead.id)

    expect(viable).toBe(false)
    const updated = store._get('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('rejected')
  })

  test('no Companies House match → +15 sole trader', async () => {
    const lead = makeLead({ name: 'Joe Plumbing', phone: '+447777000000' })
    store._seed('leads', [lead])

    restoreFetch = mockFetch([
      {
        url: /company-information.*search/,
        response: { items: [] },
      },
      {
        url: /hmrc\.gov\.uk/,
        status: 404,
        response: {},
      },
    ])

    const { runVerifierAgent } = await import('../../agents/verifier')
    const viable = await runVerifierAgent(lead.id)

    // base 20 + 15 (sole trader) + 20 (rating 4.5) + 10 (25 reviews) + 10 (has phone) = 75
    expect(viable).toBe(true)
  })

  test('recent HMRC filing → +15', async () => {
    const lead = makeLead({ name: 'Filing Corp' })
    store._seed('leads', [lead])

    restoreFetch = mockFetch([
      {
        url: /company-information.*search/,
        response: {
          items: [{ company_name: 'Filing Corp', company_number: '11111111', company_status: 'active' }],
        },
      },
      {
        url: /filing-history/,
        response: {
          items: [{ date: new Date().toISOString().split('T')[0], description: 'Accounts', type: 'AA' }],
        },
      },
      {
        url: /hmrc\.gov\.uk/,
        status: 404,
        response: {},
      },
    ])

    const { runVerifierAgent } = await import('../../agents/verifier')
    await runVerifierAgent(lead.id)

    const updated = store._get('leads').find(l => l.id === lead.id)
    expect((updated?.viability_notes as string)).toContain('HMRC compliance')
  })

  test('high Google rating + reviews → appropriate additions', async () => {
    const lead = makeLead({ name: 'Great Biz', google_rating: 4.8, google_review_count: 100 })
    store._seed('leads', [lead])

    restoreFetch = mockFetch([
      {
        url: /company-information.*search/,
        response: { items: [] },
      },
      {
        url: /hmrc\.gov\.uk/,
        status: 404,
        response: {},
      },
    ])

    const { runVerifierAgent } = await import('../../agents/verifier')
    await runVerifierAgent(lead.id)

    const updated = store._get('leads').find(l => l.id === lead.id)
    // base 20 + 15 (sole trader) + 20 (rating ≥4) + 20 (reviews ≥50) + 10 (phone) = 85
    expect((updated?.viability_score as number)).toBeGreaterThanOrEqual(80)
  })
})
