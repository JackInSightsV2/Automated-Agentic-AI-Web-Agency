import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runJob } from '../lib/orchestrator'
import { randomUUID } from 'node:crypto'

export async function runCopywriterAgent(leadId: string): Promise<void> {
  await supabase.from('leads').update({
    status: 'copywriting',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) throw new Error(`Lead ${leadId} not found`)

  await agentLog('copywriter', `Creating creative brief for: ${lead.name}`, { leadId })

  const prompt = `You are an expert brand strategist and copywriter working for a web design agency called ${process.env.AGENCY_NAME || 'Web Agency'}.

Your job: Create a comprehensive creative brief (as JSON) for building a website for this local business.

Business Details:
- Name: ${lead.name}
- Type/Category: ${lead.category}
- Location: ${lead.address}
- Phone: ${lead.phone}
- Rating: ${lead.google_rating ? `${lead.google_rating}/5 (${lead.google_review_count} reviews)` : 'New business'}
- Existing website: ${lead.website_detected || 'None'}

Use the /content-marketing skill to research the best content strategy for a ${lead.category} business.
Use the /theme-factory skill to select an appropriate visual theme.

Create a JSON creative brief with this exact structure — output ONLY the JSON, no markdown fences:
{
  "brand_voice": "description of tone and personality (e.g. professional yet approachable, warm and friendly)",
  "color_palette": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "text": "#hex"
  },
  "typography": {
    "heading_font": "Google Font name",
    "body_font": "Google Font name"
  },
  "hero": {
    "headline": "compelling headline",
    "subheadline": "supporting text",
    "cta_text": "button text",
    "cta_action": "tel:${lead.phone || ''}"
  },
  "sections": [
    { "name": "About", "copy": "2-3 paragraphs about the business" },
    { "name": "Services", "services": [{ "title": "...", "description": "..." }] },
    { "name": "Testimonials", "copy": "approach for social proof" },
    { "name": "Contact", "copy": "contact section copy" }
  ],
  "seo_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "unique_selling_points": ["usp1", "usp2", "usp3"]
}

Write the JSON to a file called "brief.json" in the current directory.`

  const jobId = randomUUID()
  const result = await runJob({
    id: jobId,
    profile: 'copywriter',
    prompt,
    leadId,
    runId: lead.pipeline_run_id || undefined
  })

  // Extract the brief from files or output
  let brief: string | null = null

  if (result.files['brief.json']) {
    brief = result.files['brief.json']
  } else {
    // Try to extract JSON from output
    const jsonMatch = result.output.match(/\{[\s\S]*"brand_voice"[\s\S]*\}/)
    if (jsonMatch) {
      brief = jsonMatch[0]
    }
  }

  if (!brief) {
    throw new Error(`Copywriter failed to produce a creative brief. Output: ${result.output.slice(0, 300)}`)
  }

  // Validate it's parseable JSON
  try {
    JSON.parse(brief)
  } catch {
    throw new Error(`Copywriter produced invalid JSON brief: ${brief.slice(0, 300)}`)
  }

  // Store brief and update status
  await supabase.from('leads').update({
    creative_brief: brief,
    status: 'briefed',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  await agentLog('copywriter', `Creative brief ready for ${lead.name}`, {
    leadId,
    level: 'success'
  })
}
