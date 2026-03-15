/**
 * Replaces globalThis.fetch with a URL-pattern-matched mock.
 *
 * Usage:
 *   const restore = mockFetch([
 *     { url: /company-information/, response: { items: [] } },
 *     { url: /bland\.ai/, response: { call_id: '123' } },
 *   ])
 *   // ... run test ...
 *   restore()
 */

interface MockHandler {
  url: string | RegExp
  method?: string
  status?: number
  response?: unknown
  headers?: Record<string, string>
}

export function mockFetch(handlers: MockHandler[]): () => void {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
    const method = (init?.method || 'GET').toUpperCase()

    for (const handler of handlers) {
      const urlMatch = typeof handler.url === 'string'
        ? url.includes(handler.url)
        : handler.url.test(url)

      if (!urlMatch) continue
      if (handler.method && handler.method.toUpperCase() !== method) continue

      const status = handler.status ?? 200
      const body = typeof handler.response === 'string'
        ? handler.response
        : JSON.stringify(handler.response ?? {})

      return new Response(body, {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...handler.headers,
        },
      })
    }

    // No match — return 404
    return new Response(JSON.stringify({ error: 'No mock handler matched', url }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}
