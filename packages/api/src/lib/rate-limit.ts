import type { Context, Next } from 'hono'

const hits = new Map<string, number[]>()

/**
 * Simple in-memory rate limiter middleware for Hono.
 * Not suitable for multi-process deployments — use Redis-backed limiter instead.
 */
export function rateLimit(opts: { windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
    const key = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    const now = Date.now()
    const windowStart = now - opts.windowMs

    const timestamps = (hits.get(key) || []).filter(t => t > windowStart)

    if (timestamps.length >= opts.max) {
      return c.json({ error: 'Too many requests' }, 429)
    }

    timestamps.push(now)
    hits.set(key, timestamps)

    await next()
  }
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 600000
  for (const [key, timestamps] of hits) {
    const filtered = timestamps.filter(t => t > cutoff)
    if (filtered.length === 0) hits.delete(key)
    else hits.set(key, filtered)
  }
}, 300000).unref()
