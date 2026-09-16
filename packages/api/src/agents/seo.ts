import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runJob } from '../lib/orchestrator'
import { leadSlug } from '../lib/slug'
import { generateHeroImage } from '../lib/images'
import { SITE_URL_PLACEHOLDER } from './deployer'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { skipInternal as skipNodeModules } from '../lib/fs'

const PREVIEW_DIR = join(process.cwd(), 'preview')

export async function runSeoAgent(leadId: string): Promise<void> {
  await supabase.from('leads').update({
    status: 'seo_optimizing',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const slug = leadSlug(lead.name)
  const previewPath = join(PREVIEW_DIR, slug)

  if (!existsSync(previewPath)) {
    throw new Error(`SEO: preview directory not found at ${previewPath}`)
  }

  await agentLog('seo', `Optimizing SEO for: ${lead.name}`, { leadId })

  // Copy preview to a temp job dir for Claude Code to work on
  const jobId = randomUUID()
  const jobDir = `/tmp/webagency-jobs/${jobId}`
  cpSync(previewPath, jobDir, { recursive: true, filter: skipNodeModules })

  // Parse creative brief for SEO keywords if available
  let seoKeywords = ''
  if (lead.creative_brief) {
    try {
      const brief = JSON.parse(lead.creative_brief)
      if (brief.seo_keywords) {
        seoKeywords = `Target SEO keywords: ${brief.seo_keywords.join(', ')}`
      }
    } catch { /* ignore parse errors */ }
  }

  // The final hostname is only known at deploy time; the deployer replaces this
  // placeholder in every text file before building.
  const siteUrl = `https://${SITE_URL_PLACEHOLDER}/`

  // Generate the hero image here (OpenAI Images API) rather than inside the
  // Claude Code job, so the model only has to wire an existing file into CSS.
  const heroPath = await generateHeroImage(lead, jobDir)

  const heroStep = heroPath
    ? `## STEP 1: Wire in the hero image

A hero background image has already been generated at ${heroPath} (1536x1024 landscape, WebP). Do NOT generate, download, or replace it.

Update the CSS hero section to use background-image: url('/hero.webp') with a dark overlay gradient so headline text stays readable. Look for the .hero-bg class or the hero section styling. Use background-size: cover and background-position: center. Keep the existing gradient as the fallback layer beneath the image.`
    : `## STEP 1: Hero image

No hero image is available for this site. Keep the existing CSS gradient hero exactly as it is. Do NOT try to generate, fetch, or reference any image file.`

  const prompt = `You are an expert SEO specialist. Optimize this existing website for search engines.

Two subagents are available (Task tool). Use them in STEP 2, then apply their output yourself:
- "seo-meta-optimizer": give it the business details and ask for the <title>, meta description, and Open Graph title/description, within character limits.
- "seo-structure-architect": give it index.html and ask for the corrected heading hierarchy and the LocalBusiness JSON-LD.
Do not use any skills or slash commands. Edit the files directly.

Business Details:
- Name: ${lead.name}
- Type: ${lead.category}
- Location: ${lead.address}
- Phone: ${lead.phone}
${seoKeywords}

The website files are in the current directory. This is a Vite project.

The site's public URL is not known yet. Wherever a URL for the site itself is needed, write EXACTLY this placeholder and nothing else: ${siteUrl}
It will be replaced with the real address automatically at deploy time. Do NOT invent a domain.

${heroStep}

## STEP 2: SEO optimizations

Perform ALL of the following SEO optimizations:

1. **Meta tags** in index.html:
   - Descriptive <title> with business name, category, and location
   - <meta name="description"> (150-160 chars, compelling)
   - <meta name="keywords"> with relevant local SEO terms
   - Canonical URL: <link rel="canonical" href="${siteUrl}">

2. **Open Graph tags** in index.html:
   - og:title, og:description, og:type (website), og:url (${siteUrl}), og:locale

3. **LocalBusiness JSON-LD** structured data in index.html:
   <script type="application/ld+json">
   {
     "@context": "https://schema.org",
     "@type": "LocalBusiness",
     "name": ${JSON.stringify(lead.name)},
     "address": { "@type": "PostalAddress", "streetAddress": ${JSON.stringify(lead.address || '')} },
     ${lead.phone ? `"telephone": ${JSON.stringify(lead.phone)},` : ''}
     ${lead.google_rating ? `"aggregateRating": { "@type": "AggregateRating", "ratingValue": "${lead.google_rating}", "reviewCount": "${lead.google_review_count}" },` : ''}
     "url": "${siteUrl}"
   }
   </script>

4. **Semantic HTML**: Ensure proper heading hierarchy (h1 → h2 → h3), alt attributes on any images, aria-labels on interactive elements

5. **Create public/sitemap.xml**:
   Simple XML sitemap with the single homepage URL ${siteUrl}

6. **Create public/robots.txt**:
   Allow all crawlers, reference the sitemap at ${siteUrl}sitemap.xml

7. **Performance**: Add loading="lazy" to any images, ensure CSS is optimized

Edit files in place. Do NOT run any build commands.`

  const result = await runJob({
    id: jobId,
    profile: 'seo',
    prompt,
    leadId,
    runId: lead.pipeline_run_id || undefined
  })

  if (!result.success) {
    throw new Error(`SEO agent failed: ${result.error}`)
  }

  // Copy optimized files back to preview
  cpSync(result.jobDir, previewPath, { recursive: true, force: true, filter: skipNodeModules })

  // Update status
  await supabase.from('leads').update({
    status: 'seo_optimized',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  await agentLog('seo', `SEO optimization complete for ${lead.name}${heroPath ? ' (with hero image)' : ' (gradient hero)'}`, {
    leadId,
    level: 'success',
    metadata: { files: Object.keys(result.files), heroImage: heroPath }
  })
}
