import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runJob } from '../lib/orchestrator'
import { randomUUID } from 'crypto'
import { cpSync, existsSync, readFileSync } from 'fs'
import { join, sep } from 'path'

/** Filter that skips node_modules and .git when copying */
const skipNodeModules = (src: string) => !src.split(sep).includes('node_modules') && !src.split(sep).includes('.git')

const PREVIEW_DIR = join(process.cwd(), 'preview')

export async function runBuilderAgent(leadId: string): Promise<string> {
  await updateLeadStatus(leadId, 'building')

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) throw new Error(`Lead ${leadId} not found`)

  await agentLog('builder', `Building Vite site for: ${lead.name}`, { leadId })

  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40)

  // Parse creative brief if available
  let briefSection = ''
  if (lead.creative_brief) {
    try {
      const brief = JSON.parse(lead.creative_brief)
      briefSection = `
CREATIVE BRIEF (follow this closely):
- Brand Voice: ${brief.brand_voice || 'Professional and approachable'}
- Color Palette: Primary ${brief.color_palette?.primary || '#2563eb'}, Secondary ${brief.color_palette?.secondary || '#1e40af'}, Accent ${brief.color_palette?.accent || '#f59e0b'}, Background ${brief.color_palette?.background || '#ffffff'}, Text ${brief.color_palette?.text || '#1f2937'}
- Typography: Headings "${brief.typography?.heading_font || 'Inter'}", Body "${brief.typography?.body_font || 'Inter'}"
- Hero: Headline "${brief.hero?.headline || ''}", Subheadline "${brief.hero?.subheadline || ''}", CTA "${brief.hero?.cta_text || 'Call Us'}"
- Sections: ${JSON.stringify(brief.sections || [])}
- USPs: ${(brief.unique_selling_points || []).join(', ')}
`
    } catch { /* use defaults if brief is malformed */ }
  }

  // Check if this is a rebuild after failed review
  const reviewErrors = lead.error && lead.error.includes('Review score') ? `
IMPORTANT — PREVIOUS REVIEW FEEDBACK (fix these issues):
${lead.error}
` : ''

  const prompt = `You are an expert web designer. Build a complete Vite + vanilla JavaScript website for a local business.

IMPORTANT: Focus ONLY on writing the website files. Do NOT use any skills or slash commands. Just write the code directly.

Business Details:
- Name: ${lead.name}
- Type: ${lead.category}
- Location: ${lead.address}
- Phone: ${lead.phone}
- Rating: ${lead.google_rating ? `${lead.google_rating}/5 (${lead.google_review_count} reviews)` : 'New business'}
${briefSection}${reviewErrors}
Create a Vite project with this structure:
  package.json       (name: "${slug}", with vite as devDependency)
  vite.config.js     (basic vite config)
  index.html         (entry HTML that loads /src/main.js)
  src/
    main.js          (JS for interactivity: smooth scroll, mobile nav toggle, scroll animations)
    style.css        (all styles — imported by main.js)

Requirements:
- package.json must have: "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" } and "devDependencies": { "vite": "^6.0.0" }
- vite.config.js: import { defineConfig } from 'vite'; export default defineConfig({})
- index.html: proper Vite entry with <script type="module" src="/src/main.js"></script>
- Professional, modern design that looks like it cost £2,000+ to build
- Sections: Hero (business name + tagline + CTA), About, Services (3-5 relevant services), Testimonials/Reviews, Contact (phone prominently displayed)
- Mobile responsive with hamburger menu
- Beautiful color scheme appropriate for a ${lead.category}
- "Call Us" CTA button linking to tel:${lead.phone}
- Footer with address and phone
- Hero section: use a bold CSS gradient background with an overlay for text readability. The CSS should include a class like .hero-bg that can later be replaced with a background-image URL (url('/hero.webp')) when an image is available
- Smooth scroll-to-section navigation
- Subtle scroll-triggered fade-in animations in main.js
- Google Fonts loaded via <link> in index.html

Write all files to the current directory. Make sure to create the src/ directory and all files.`

  const jobId = randomUUID()
  const jobDir = `/tmp/webagency-jobs/${jobId}`

  // If this is a review retry, copy existing site files so builder can fix rather than rebuild
  const isReviewRetry = !!(lead.error && lead.error.includes('Review score'))
  const previewExists = existsSync(join(PREVIEW_DIR, slug))

  if (isReviewRetry && previewExists) {
    const { mkdirSync } = await import('fs')
    mkdirSync(jobDir, { recursive: true })
    cpSync(join(PREVIEW_DIR, slug), jobDir, { recursive: true, filter: skipNodeModules })
    await agentLog('builder', `Review retry — copying existing site for fixes`, { leadId })
  }

  const finalPrompt = isReviewRetry && previewExists
    ? `You are an expert web developer. The website files in the current directory failed a quality review. Fix the issues listed below WITHOUT rebuilding from scratch — edit the existing files in place.

Business: ${lead.name} (${lead.category})

${reviewErrors}

Fix ONLY the issues listed above. Do not restructure or rewrite the site. Keep all existing content, styling, and functionality intact. Just fix what the reviewer flagged.

Do NOT run any build commands.`
    : prompt

  const result = await runJob({
    id: jobId,
    profile: 'builder',
    prompt: finalPrompt,
    leadId,
    runId: lead.pipeline_run_id || undefined
  })

  // Verify we got the essential files
  const hasIndex = result.files['index.html']
  const hasPackageJson = result.files['package.json']
  const hasMainJs = result.files['src/main.js']
  const hasStyleCss = result.files['src/style.css']

  if (!hasIndex && !isReviewRetry) {
    const fileList = Object.keys(result.files).join(', ')
    throw new Error(`Builder missing index.html. Got files: [${fileList}]. Error: ${result.error || 'none'}`)
  }

  // Copy the entire job directory to preview/
  const previewPath = join(PREVIEW_DIR, slug)
  cpSync(result.jobDir, previewPath, { recursive: true, force: true, filter: skipNodeModules })

  // Read the index.html for DB storage
  const html = result.files['index.html']

  await agentLog('builder', `Vite site built for ${lead.name} (${Object.keys(result.files).length} files)`, {
    leadId,
    level: 'success',
    metadata: { files: Object.keys(result.files), previewPath }
  })

  // Store the index.html in DB + mark as built
  await supabase
    .from('leads')
    .update({
      site_html: html,
      site_prompt: prompt,
      status: 'built',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('builder', `Preview ready: cd preview/${slug} && bun install && bun dev`, {
    leadId,
    level: 'success'
  })

  return html
}

async function updateLeadStatus(leadId: string, status: string) {
  await supabase
    .from('leads')
    .update({ status, status_updated_at: new Date().toISOString() })
    .eq('id', leadId)
}
