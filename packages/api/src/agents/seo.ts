import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runJob } from '../lib/orchestrator'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync } from 'node:fs'
import { join, sep } from 'node:path'

/** Filter that skips node_modules and .git when copying */
const skipNodeModules = (src: string) => !src.split(sep).includes('node_modules') && !src.split(sep).includes('.git')

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

  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40)
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

  const prompt = `You are an expert SEO specialist. Optimize this existing website for search engines AND generate a hero background image.

Business Details:
- Name: ${lead.name}
- Type: ${lead.category}
- Location: ${lead.address}
- Phone: ${lead.phone}
${seoKeywords}

The website files are in the current directory. This is a Vite project.

## STEP 1: Generate hero image

Use the /nano-banana skill to generate a professional hero background image for a ${lead.category} business called "${lead.name}". The image should look like a high-quality stock photo suitable for a website hero section.

After generating, copy the image to the public directory:
  mkdir -p public
  cp nanobanana-output/*.webp public/hero.webp 2>/dev/null || cp nanobanana-output/*.png public/hero.webp 2>/dev/null

Then update the CSS hero section to use background-image: url('/hero.webp') with a dark overlay gradient for text readability. Look for the .hero-bg class or the hero section styling.

If nano-banana fails, skip this step — the existing CSS gradient fallback is fine.

## STEP 2: SEO optimizations

Perform ALL of the following SEO optimizations:

1. **Meta tags** in index.html:
   - Descriptive <title> with business name, category, and location
   - <meta name="description"> (150-160 chars, compelling)
   - <meta name="keywords"> with relevant local SEO terms
   - Canonical URL: <link rel="canonical" href="https://${slug}.vercel.app/">

2. **Open Graph tags** in index.html:
   - og:title, og:description, og:type (website), og:url, og:locale

3. **LocalBusiness JSON-LD** structured data in index.html:
   <script type="application/ld+json">
   {
     "@context": "https://schema.org",
     "@type": "LocalBusiness",
     "name": "${lead.name}",
     "address": { "@type": "PostalAddress", "streetAddress": "${lead.address}" },
     ${lead.phone ? `"telephone": "${lead.phone}",` : ''}
     ${lead.google_rating ? `"aggregateRating": { "@type": "AggregateRating", "ratingValue": "${lead.google_rating}", "reviewCount": "${lead.google_review_count}" },` : ''}
     "url": "https://${slug}.vercel.app/"
   }
   </script>

4. **Semantic HTML**: Ensure proper heading hierarchy (h1 → h2 → h3), alt attributes on any images, aria-labels on interactive elements

5. **Create sitemap.xml** in the project root (public/ directory if it exists, otherwise root):
   Simple XML sitemap with the homepage URL

6. **Create robots.txt** in the project root (public/ directory if it exists, otherwise root):
   Allow all crawlers, reference sitemap

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

  await agentLog('seo', `SEO optimization complete for ${lead.name}`, {
    leadId,
    level: 'success',
    metadata: { files: Object.keys(result.files) }
  })
}
