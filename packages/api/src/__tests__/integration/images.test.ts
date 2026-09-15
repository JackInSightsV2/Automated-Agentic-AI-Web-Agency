import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))

const lead = {
  id: 'lead-1',
  name: "Bob's Plumbing",
  category: 'plumber',
  address: '12 High St, Camden, London',
  creative_brief: JSON.stringify({ brand_voice: 'Friendly and reliable', color_palette: { primary: '#1e3a8a', accent: '#f59e0b' } }),
}

/** Counting fetch mock for the Images API */
function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: any }> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return handler(url, init)
  }) as unknown as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const PNG_BYTES = Buffer.from('fake-webp-bytes')

/** Assigning undefined to process.env stores the string "undefined"; delete is the only correct unset. */
function unsetEnv(...keys: string[]) {
  for (const key of keys) {
    // biome-ignore lint/performance/noDelete: process.env requires delete to unset
    delete process.env[key]
  }
}

describe('generateHeroImage', () => {
  let dir: string
  let restore: () => void = () => {}

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hero-'))
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.HERO_IMAGES = 'true'
    unsetEnv('OPENAI_IMAGE_MODEL', 'OPENAI_IMAGE_QUALITY', 'OPENAI_IMAGE_SIZE')
  })

  afterEach(() => {
    restore()
    rmSync(dir, { recursive: true, force: true })
  })

  test('writes public/hero.webp from b64_json and sends the documented parameters', async () => {
    const f = installFetch(() => new Response(JSON.stringify({
      data: [{ b64_json: PNG_BYTES.toString('base64') }],
      usage: { output_tokens: 1000 },
    }), { headers: { 'Content-Type': 'application/json' } }))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    const result = await generateHeroImage(lead, dir)

    expect(result).toBe('public/hero.webp')
    expect(readFileSync(join(dir, 'public/hero.webp'))).toEqual(PNG_BYTES)

    expect(f.calls.length).toBe(1)
    expect(f.calls[0].url).toBe('https://api.openai.com/v1/images/generations')
    const body = f.calls[0].body
    expect(body.model).toBe('gpt-image-2.5-flare')
    expect(body.size).toBe('1536x1024')
    expect(body.quality).toBe('medium')
    expect(body.output_format).toBe('webp')
    expect(body.background).toBe('opaque')
    expect(body.n).toBe(1)
  })

  test('prompt is photographic, text-free, and uses the brief', async () => {
    const { buildHeroPrompt } = await import('../../lib/images')
    const prompt = buildHeroPrompt(lead)
    expect(prompt).toContain("Bob's Plumbing")
    expect(prompt).toContain('plumber')
    expect(prompt).toContain('Camden, London')
    expect(prompt).toContain('No text')
    expect(prompt).toContain('#1e3a8a')
    expect(prompt).toContain('Friendly and reliable')
  })

  test('env overrides model, quality, and size', async () => {
    process.env.OPENAI_IMAGE_MODEL = 'gpt-image-1-mini'
    process.env.OPENAI_IMAGE_QUALITY = 'low'
    process.env.OPENAI_IMAGE_SIZE = '1024x1024'
    const f = installFetch(() => new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    await generateHeroImage(lead, dir)
    expect(f.calls[0].body.model).toBe('gpt-image-1-mini')
    expect(f.calls[0].body.quality).toBe('low')
    expect(f.calls[0].body.size).toBe('1024x1024')
  })

  test('downloads from url when b64_json is absent', async () => {
    const f = installFetch((url) => url.includes('cdn.example')
      ? new Response(PNG_BYTES)
      : new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/img.webp' }] })))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    expect(await generateHeroImage(lead, dir)).toBe('public/hero.webp')
    expect(readFileSync(join(dir, 'public/hero.webp'))).toEqual(PNG_BYTES)
  })

  test('API error → null, no file, no throw', async () => {
    const f = installFetch(() => new Response(JSON.stringify({ error: { message: 'Your organization must be verified', code: 'org_verification_required' } }), { status: 403 }))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    expect(await generateHeroImage(lead, dir)).toBeNull()
    expect(existsSync(join(dir, 'public/hero.webp'))).toBe(false)
  })

  test('network failure → null', async () => {
    const f = installFetch(() => { throw new Error('ECONNRESET') })
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    expect(await generateHeroImage(lead, dir)).toBeNull()
  })

  test('no OPENAI_API_KEY → skipped without calling the API', async () => {
    unsetEnv('OPENAI_API_KEY')
    const f = installFetch(() => new Response('{}'))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    expect(await generateHeroImage(lead, dir)).toBeNull()
    expect(f.calls.length).toBe(0)
  })

  test('HERO_IMAGES=false disables even with a key', async () => {
    process.env.HERO_IMAGES = 'false'
    const f = installFetch(() => new Response('{}'))
    restore = f.restore

    const { generateHeroImage } = await import('../../lib/images')
    expect(await generateHeroImage(lead, dir)).toBeNull()
    expect(f.calls.length).toBe(0)
  })
})
