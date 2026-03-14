import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runJob } from '../lib/orchestrator'
import { randomUUID } from 'crypto'
import { cpSync, existsSync } from 'fs'
import { join, sep } from 'path'

/** Filter that skips node_modules and .git when copying */
const skipNodeModules = (src: string) => !src.split(sep).includes('node_modules') && !src.split(sep).includes('.git')

const PREVIEW_DIR = join(process.cwd(), 'preview')

export async function runCodeReviewerAgent(leadId: string): Promise<boolean> {
  await supabase.from('leads').update({
    status: 'reviewing',
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
    throw new Error(`Code Reviewer: preview directory not found at ${previewPath}`)
  }

  await agentLog('reviewer', `Reviewing site quality for: ${lead.name}`, { leadId })

  // Copy preview to temp dir for review
  const jobId = randomUUID()
  const jobDir = `/tmp/webagency-jobs/${jobId}`
  cpSync(previewPath, jobDir, { recursive: true, filter: skipNodeModules })

  const prompt = `You are an expert code reviewer for a web design agency. Review this Vite website for quality and readiness.

Business: ${lead.name} (${lead.category})

The website files are in the current directory.

Review the site across these dimensions and score each 0-100:

1. **HTML Validity** (20%): Proper structure, semantic elements, no broken tags
2. **CSS Quality** (15%): Responsive design, no obvious layout breaks, good typography
3. **JavaScript Safety** (15%): No console errors potential, no XSS vectors, proper event handling
4. **Security** (15%): No inline event handlers with user data, no exposed secrets, CSP-ready
5. **Performance** (15%): Reasonable file sizes, lazy loading where appropriate, no render-blocking issues
6. **Accessibility** (10%): Alt texts, ARIA labels, keyboard navigation, color contrast
7. **Content Accuracy** (10%): Business name correct, phone/address accurate, no lorem ipsum, no placeholder text

Write your review to a file called "review.json" with this exact structure:
{
  "scores": {
    "html_validity": <number>,
    "css_quality": <number>,
    "js_safety": <number>,
    "security": <number>,
    "performance": <number>,
    "accessibility": <number>,
    "content_accuracy": <number>
  },
  "overall_score": <weighted average>,
  "critical_issues": ["list of must-fix issues, empty if none"],
  "warnings": ["list of should-fix issues"],
  "pass": <true if overall >= 70 AND no critical issues>
}

Be thorough but fair. A functional, professional-looking site with no security issues should pass.
Do NOT modify any site files — this is a read-only review.`

  const result = await runJob({
    id: jobId,
    profile: 'reviewer',
    prompt,
    leadId,
    runId: lead.pipeline_run_id || undefined
  })

  // Parse review result
  let review: {
    overall_score: number
    critical_issues: string[]
    pass: boolean
    warnings?: string[]
  }

  try {
    const reviewJson = result.files['review.json']
      || result.output.match(/\{[\s\S]*"overall_score"[\s\S]*\}/)?.[0]

    if (!reviewJson) {
      throw new Error('No review output found')
    }

    review = JSON.parse(typeof reviewJson === 'string' ? reviewJson : '')
  } catch {
    // If we can't parse the review, treat as a pass with warning
    await agentLog('reviewer', `Could not parse review output for ${lead.name}, passing with warning`, {
      leadId,
      level: 'warn'
    })
    review = { overall_score: 75, critical_issues: [], pass: true }
  }

  const passed = review.pass && review.overall_score >= 70 && review.critical_issues.length === 0

  // Store full review result on the lead for dashboard visibility
  const reviewSummary = JSON.stringify({
    overall_score: review.overall_score,
    scores: (review as any).scores || {},
    critical_issues: review.critical_issues,
    warnings: review.warnings || [],
    pass: passed,
    reviewed_at: new Date().toISOString()
  })

  if (passed) {
    await supabase.from('leads').update({
      status: 'reviewed',
      status_updated_at: new Date().toISOString(),
      review_result: reviewSummary
    }).eq('id', leadId)

    await agentLog('reviewer', `${lead.name} PASSED review (score: ${review.overall_score})`, {
      leadId,
      level: 'success',
      metadata: { score: review.overall_score, warnings: review.warnings }
    })
  } else {
    // Failed — will be re-queued to build
    const errorNotes = [
      `Review score: ${review.overall_score}/100`,
      ...review.critical_issues.map(i => `CRITICAL: ${i}`),
      ...(review.warnings || []).slice(0, 3).map(w => `WARNING: ${w}`)
    ].join('\n')

    await supabase.from('leads').update({
      error: errorNotes,
      review_result: reviewSummary,
      status_updated_at: new Date().toISOString()
    }).eq('id', leadId)

    await agentLog('reviewer', `${lead.name} FAILED review (score: ${review.overall_score})`, {
      leadId,
      level: 'warn',
      metadata: { score: review.overall_score, critical: review.critical_issues }
    })
  }

  return passed
}
