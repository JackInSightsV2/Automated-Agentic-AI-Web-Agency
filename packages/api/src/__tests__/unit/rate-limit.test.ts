import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { rateLimit } from '../../lib/rate-limit'

function createApp(max: number) {
  const app = new Hono()
  const limiter = rateLimit({ windowMs: 60000, max })
  app.get('/test', limiter, (c) => c.json({ ok: true }))
  return app
}

describe('rateLimit', () => {
  test('requests within limit → 200', async () => {
    const app = createApp(5)

    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    })
    expect(res.status).toBe(200)
  })

  test('requests exceeding limit → 429', async () => {
    const app = createApp(2)

    // Make 2 requests (at limit)
    for (let i = 0; i < 2; i++) {
      await app.request('/test', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      })
    }

    // 3rd should be rate limited
    const res = await app.request('/test', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toContain('Too many requests')
  })

  test('different IPs have independent limits', async () => {
    const app = createApp(1)

    // First IP uses its 1 allowed request
    const res1 = await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(res1.status).toBe(200)

    // First IP is now limited
    const res2 = await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    })
    expect(res2.status).toBe(429)

    // Second IP still has its allowance
    const res3 = await app.request('/test', {
      headers: { 'x-forwarded-for': '192.168.1.2' },
    })
    expect(res3.status).toBe(200)
  })
})
