import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { runScoutAgent } from '../agents/scout'
import { notify } from '../lib/telegram'
import { enqueue } from '../lib/queue'

export const pipelineRouter = new Hono()

// Start a new pipeline run
pipelineRouter.post('/start', async (c) => {
  const { query, location = 'London', limit = 3 } = await c.req.json()

  const { data: run } = await supabase
    .from('pipeline_runs')
    .insert({ query, location })
    .select()
    .single()

  if (!run) return c.json({ error: 'Failed to create pipeline run' }, 500)

  // Start async — return immediately
  runPipeline(run.id, `${query} ${location}`, Math.min(Math.max(limit, 1), 20)).catch(console.error)

  return c.json({ run_id: run.id, message: 'Pipeline started' })
})

// Get pipeline status
pipelineRouter.get('/status/:runId', async (c) => {
  const { runId } = c.req.param()

  const { data: run } = await supabase
    .from('pipeline_runs')
    .select('*')
    .eq('id', runId)
    .single()

  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, status, vercel_deployment_url, call_outcome, viability_score')
    .eq('pipeline_run_id', runId)

  return c.json({ run, leads })
})

// Tracking: email open pixel
pipelineRouter.get('/track/open/:leadId', async (c) => {
  const { leadId } = c.req.param()
  await supabase
    .from('leads')
    .update({ email_opened_at: new Date().toISOString(), status: 'opened', status_updated_at: new Date().toISOString() })
    .eq('id', leadId)

  // 1x1 transparent GIF
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' } })
})

// Tracking: email click
pipelineRouter.get('/track/click/:leadId', async (c) => {
  const { leadId } = c.req.param()
  const redirect = c.req.query('redirect') || '/'

  await supabase
    .from('leads')
    .update({ email_clicked_at: new Date().toISOString(), status: 'clicked', status_updated_at: new Date().toISOString() })
    .eq('id', leadId)

  return c.redirect(redirect)
})

// HITL — finalise with custom domain
pipelineRouter.post('/hitl/finalise', async (c) => {
  const { lead_id, domain } = await c.req.json()

  await supabase
    .from('leads')
    .update({ final_domain: domain, status: 'closed', status_updated_at: new Date().toISOString() })
    .eq('id', lead_id)

  return c.json({ success: true, message: `Domain ${domain} queued for setup` })
})

// Send Telegram message with site link to a lead
pipelineRouter.post('/notify/:leadId', async (c) => {
  const { leadId } = c.req.param()
  try {
    const { data: lead } = await supabase.from('leads').select('name, vercel_deployment_url').eq('id', leadId).single()
    if (!lead?.vercel_deployment_url) return c.json({ success: false, error: 'No deployment URL' }, 400)
    const calendly = process.env.CALENDLY_LINK || ''
    await notify(
      `Hi from ${process.env.AGENCY_NAME || 'Web Agency'}! We're a web design studio that helps local businesses get online.\n\n` +
      `We noticed ${lead.name} doesn't have a website yet, so we went ahead and mocked one up for you — completely free, no strings attached.\n\n` +
      `Have a look here: ${lead.vercel_deployment_url}\n\n` +
      `If you like it and want this as your actual website, book a quick chat with us: ${calendly}`
    )
    return c.json({ success: true, message: 'Telegram notification sent' })
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500)
  }
})

// Get all leads with optional status filter
pipelineRouter.get('/leads', async (c) => {
  const status = c.req.query('status')

  let query = supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
})

// Pipeline orchestration — now simplified: scout + enqueue to verify
async function runPipeline(runId: string, query: string, limit: number = 3) {
  try {
    await agentLog('orchestrator', `Pipeline started: "${query}" (limit: ${limit})`, { runId })

    // Phase 1: Scout
    const leadIds = await runScoutAgent(query, runId, limit)
    await supabase
      .from('pipeline_runs')
      .update({ leads_found: leadIds.length })
      .eq('id', runId)

    if (leadIds.length === 0) {
      await agentLog('orchestrator', 'No leads found, pipeline complete', { runId })
      await supabase.from('pipeline_runs').update({ completed_at: new Date().toISOString() }).eq('id', runId)
      return
    }

    // Phase 2: Enqueue all leads for verification — the queue system handles the rest
    for (const leadId of leadIds) {
      await enqueue({
        leadId,
        queueName: 'verify',
        pipelineRunId: runId,
      })
    }

    await notify(`🚀 Pipeline: ${leadIds.length} leads queued for verification`)
    await agentLog('orchestrator', `Pipeline: ${leadIds.length} leads queued for verification`, { runId, level: 'success' })

  } catch (err) {
    await agentLog('orchestrator', `Pipeline error: ${String(err)}`, { runId, level: 'error' })
  }
}

// Export for use from Telegram/crons
export { runPipeline }
