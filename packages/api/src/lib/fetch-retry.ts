/**
 * Fetch wrapper with retry and exponential backoff for external API calls.
 * Retries on 5xx server errors and network failures.
 */
export async function fetchWithRetry(
  url: string,
  opts?: RequestInit & { retries?: number; backoffMs?: number }
): Promise<Response> {
  const maxRetries = opts?.retries ?? 2
  const baseBackoff = opts?.backoffMs ?? 1000

  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts)

      // Retry on server errors (5xx), not client errors (4xx)
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(baseBackoff * 2 ** attempt)
        continue
      }

      return res
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        await sleep(baseBackoff * 2 ** attempt)
      }
    }
  }

  throw lastError || new Error(`fetchWithRetry: exhausted ${maxRetries} retries for ${url}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
