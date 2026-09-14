import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { installSupabaseMock, store } from '../helpers/mock-supabase'
import { mockFetch } from '../helpers/mock-fetch'
import { makeLead } from '../helpers/fixtures'

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))

const place = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: { text: name },
  formattedAddress: '1 High St, London',
  nationalPhoneNumber: '020 7946 0000',
  rating: 4.2,
  userRatingCount: 12,
  types: ['plumber'],
  ...extra,
})

describe('runScoutAgent (Google Places)', () => {
  let restoreFetch: () => void

  beforeEach(() => {
    installSupabaseMock()
    store._reset()
    process.env.MOCK_SCOUT = 'false'
    process.env.GOOGLE_PLACES_API_KEY = 'places-test-key'
  })

  afterEach(() => {
    if (restoreFetch) restoreFetch()
  })

  test('never re-inserts or resets a business already in the pipeline', async () => {
    const paying = makeLead({ name: 'Existing Plumber', google_place_id: 'p_existing', status: 'paid', pipeline_run_id: 'old-run' })
    store._seed('leads', [paying])

    restoreFetch = mockFetch([{
      url: /places:searchText/,
      response: { places: [place('p_existing', 'Existing Plumber'), place('p_new', 'New Plumber')] },
    }])

    const { runScoutAgent } = await import('../../agents/scout')
    const ids = await runScoutAgent('plumber London', 'new-run', 5)

    const leads = store._get('leads')
    expect(leads.length).toBe(2)

    const existing = leads.find(l => l.google_place_id === 'p_existing')
    expect(existing?.status).toBe('paid')
    expect(existing?.pipeline_run_id).toBe('old-run')
    expect(ids).not.toContain(existing?.id)

    const fresh = leads.find(l => l.google_place_id === 'p_new')
    expect(fresh?.status).toBe('discovered')
    expect(ids).toEqual([fresh?.id])
  })

  test('skips places with a website or no phone', async () => {
    restoreFetch = mockFetch([{
      url: /places:searchText/,
      response: { places: [
        place('p_site', 'Has Site', { websiteUri: 'https://example.com' }),
        place('p_nophone', 'No Phone', { nationalPhoneNumber: undefined }),
        place('p_ok', 'Good Lead'),
      ] },
    }])

    const { runScoutAgent } = await import('../../agents/scout')
    const ids = await runScoutAgent('plumber', 'run', 5)
    expect(ids.length).toBe(1)
    expect(store._get('leads')[0].name).toBe('Good Lead')
  })

  test('surfaces Google API errors instead of reporting zero leads', async () => {
    restoreFetch = mockFetch([{ url: /places:searchText/, status: 403, response: { error: { message: 'API key not valid' } } }])

    const { runScoutAgent } = await import('../../agents/scout')
    await expect(runScoutAgent('plumber', 'run', 5)).rejects.toThrow(/403/)
  })
})
