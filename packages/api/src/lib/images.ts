/**
 * Hero image generation via the OpenAI Images API.
 *
 * Runs in Bun before the SEO Claude Code job so the model only has to wire an
 * existing file into the CSS. Replaces the old flow where the subprocess called
 * the nano-banana (Gemini CLI) skill and spent LLM turns on it.
 *
 * Failure is non-fatal: returns null and the site keeps its gradient hero.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentLog } from './logger'
import { images } from './config'

export const HERO_IMAGE_PATH = 'public/hero.webp'

/** Generation can take up to ~2 minutes for complex prompts per OpenAI's docs. */
const REQUEST_TIMEOUT_MS = 150_000

interface HeroLead {
  name: string
  category: string | null
  address: string | null
  creative_brief?: string | null
}

/** Build a photographic, text-free prompt from the lead and its creative brief. */
export function buildHeroPrompt(lead: HeroLead): string {
  let palette = ''
  let voice = ''
  if (lead.creative_brief) {
    try {
      const brief = JSON.parse(lead.creative_brief)
      const p = brief.color_palette
      if (p?.primary) palette = ` Colour mood: ${[p.primary, p.secondary, p.accent].filter(Boolean).join(', ')}.`
      if (brief.brand_voice) voice = ` Brand feel: ${brief.brand_voice}.`
    } catch { /* malformed brief: ignore */ }
  }

  const area = lead.address ? lead.address.split(',').slice(-2).join(',').trim() : ''

  return (
    `Wide photorealistic hero background for the website of a ${lead.category || 'local business'} called ${lead.name}` +
    (area ? ` in ${area}` : '') +
    `. Editorial stock-photo quality, natural light, shallow depth of field, calm and professional.` +
    ` Composition leaves clear space across the middle for headline text.` +
    ` No text, no letters, no logos, no watermarks, no readable signage, no identifiable faces.` +
    palette + voice
  )
}

/**
 * Generate the hero image into `<siteDir>/public/hero.webp`.
 * Returns the relative path on success, null if disabled or generation failed.
 */
export async function generateHeroImage(
  lead: HeroLead & { id: string },
  siteDir: string,
): Promise<string | null> {
  if (!images.enabled) {
    await agentLog('seo', `Hero image skipped for ${lead.name} (OPENAI_API_KEY not set)`, { leadId: lead.id })
    return null
  }

  const prompt = buildHeroPrompt(lead)
  const started = Date.now()

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: images.model,
        prompt,
        n: 1,
        size: images.size,
        quality: images.quality,
        output_format: 'webp',
        output_compression: 80,
        background: 'opaque',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const body = await res.json() as {
      data?: Array<{ b64_json?: string; url?: string }>
      usage?: Record<string, unknown>
      error?: { message?: string; type?: string; code?: string }
    }

    if (!res.ok || body.error) {
      throw new Error(`${res.status} ${body.error?.message || body.error?.code || 'unknown error'}`)
    }

    const first = body.data?.[0]
    let bytes: Uint8Array | null = null
    if (first?.b64_json) {
      bytes = Buffer.from(first.b64_json, 'base64')
    } else if (first?.url) {
      const img = await fetch(first.url, { signal: AbortSignal.timeout(30_000) })
      if (!img.ok) throw new Error(`image download failed: ${img.status}`)
      bytes = new Uint8Array(await img.arrayBuffer())
    }
    if (!bytes || bytes.length === 0) throw new Error('response contained no image data')

    mkdirSync(join(siteDir, 'public'), { recursive: true })
    writeFileSync(join(siteDir, HERO_IMAGE_PATH), bytes)

    await agentLog('seo', `Hero image generated for ${lead.name} (${images.model}, ${images.quality}, ${Math.round(bytes.length / 1024)} KB, ${((Date.now() - started) / 1000).toFixed(1)}s)`, {
      leadId: lead.id,
      level: 'success',
      metadata: { model: images.model, quality: images.quality, size: images.size, usage: body.usage, prompt },
    })
    return HERO_IMAGE_PATH
  } catch (err) {
    await agentLog('seo', `Hero image generation failed for ${lead.name}, keeping gradient hero: ${String(err)}`, {
      leadId: lead.id,
      level: 'warn',
      metadata: { model: images.model, prompt },
    })
    return null
  }
}
