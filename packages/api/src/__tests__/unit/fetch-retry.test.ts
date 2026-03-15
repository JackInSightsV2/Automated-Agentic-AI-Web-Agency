import { describe, test, expect, afterEach } from 'bun:test'
import { mockFetch } from '../helpers/mock-fetch'

describe('fetchWithRetry', () => {
  let restore: () => void

  afterEach(() => {
    if (restore) restore()
  })

  test('returns response on first success', async () => {
    restore = mockFetch([
      { url: 'https://api.example.com/data', response: { ok: true } },
    ])

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    const res = await fetchWithRetry('https://api.example.com/data', { retries: 2, backoffMs: 10 })
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  test('retries on 500, succeeds on 2nd attempt', async () => {
    let callCount = 0
    const origFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      callCount++
      if (callCount === 1) {
        return new Response('Server Error', { status: 500 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    restore = () => { globalThis.fetch = origFetch }

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    const res = await fetchWithRetry('https://api.example.com/data', { retries: 2, backoffMs: 10 })
    expect(res.status).toBe(200)
    expect(callCount).toBe(2)
  })

  test('does NOT retry on 400', async () => {
    let callCount = 0
    const origFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      callCount++
      return new Response('Bad Request', { status: 400 })
    }) as unknown as typeof fetch

    restore = () => { globalThis.fetch = origFetch }

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    const res = await fetchWithRetry('https://api.example.com/data', { retries: 2, backoffMs: 10 })
    expect(res.status).toBe(400)
    expect(callCount).toBe(1)
  })

  test('does NOT retry on 404', async () => {
    let callCount = 0
    const origFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      callCount++
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    restore = () => { globalThis.fetch = origFetch }

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    const res = await fetchWithRetry('https://api.example.com/data', { retries: 2, backoffMs: 10 })
    expect(res.status).toBe(404)
    expect(callCount).toBe(1)
  })

  test('throws after exhausting retries on network error', async () => {
    const origFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      throw new Error('Network failure')
    }) as unknown as typeof fetch

    restore = () => { globalThis.fetch = origFetch }

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    expect(fetchWithRetry('https://api.example.com/data', { retries: 1, backoffMs: 10 })).rejects.toThrow('Network failure')
  })

  test('retries on network error then succeeds', async () => {
    let callCount = 0
    const origFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      callCount++
      if (callCount === 1) throw new Error('Network failure')
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    restore = () => { globalThis.fetch = origFetch }

    const { fetchWithRetry } = await import('../../lib/fetch-retry')
    const res = await fetchWithRetry('https://api.example.com/data', { retries: 2, backoffMs: 10 })
    expect(res.status).toBe(200)
    expect(callCount).toBe(2)
  })
})
