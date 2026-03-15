import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import {
  getQueueStats,
  setQueueState,
  getHITLConfig,
  getQueueStates,
} from '../lib/queue'
import type { QueueName } from '../types'

export const adminRouter = new Hono()

const QUEUE_NAMES: QueueName[] = ['verify', 'copywrite', 'build', 'seo', 'review', 'deploy', 'call', 'followup', 'close']

// Queue stats
adminRouter.get('/queues', async (c) => {
  const stats = await getQueueStats()
  const states = await getQueueStates()
  const hitl = await getHITLConfig()

  const queues = QUEUE_NAMES.map((name) => ({
    name,
    state: states[name],
    hitl: hitl[name],
    ...stats[name],
  }))

  return c.json({ queues })
})

// Pause a queue
adminRouter.post('/queues/:name/pause', async (c) => {
  const name = c.req.param('name') as QueueName
  if (!QUEUE_NAMES.includes(name)) return c.json({ error: 'Invalid queue name' }, 400)
  await setQueueState(name, 'paused')
  return c.json({ success: true, queue: name, state: 'paused' })
})

// Resume a queue
adminRouter.post('/queues/:name/resume', async (c) => {
  const name = c.req.param('name') as QueueName
  if (!QUEUE_NAMES.includes(name)) return c.json({ error: 'Invalid queue name' }, 400)
  await setQueueState(name, 'active')
  return c.json({ success: true, queue: name, state: 'active' })
})

// Leads with filters
adminRouter.get('/leads', async (c) => {
  const status = c.req.query('status')
  const limit = Number.parseInt(c.req.query('limit') || '50')

  let query = supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ leads: data })
})

// Single lead detail
adminRouter.get('/leads/:id', async (c) => {
  const { id } = c.req.param()
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', id).single()
  if (error) return c.json({ error: error.message }, 404)

  // Also get queue history for this lead
  const { data: queueHistory } = await supabase
    .from('queue_items')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: true })

  // And agent logs
  const { data: logs } = await supabase
    .from('agent_logs')
    .select('*')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  return c.json({ lead, queueHistory, logs })
})

// System config
adminRouter.get('/config', async (c) => {
  const { data } = await supabase.from('system_config').select('*')
  const config: Record<string, unknown> = {}
  for (const row of data || []) {
    config[row.key] = row.value
  }
  return c.json({ config })
})

// Update config
adminRouter.post('/config', async (c) => {
  const body = await c.req.json()
  const { key, value } = body

  if (!key || value === undefined) return c.json({ error: 'key and value required' }, 400)

  await supabase
    .from('system_config')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  return c.json({ success: true, key, value })
})

// Approve HITL item — immediate execution (bypasses business hours + cron wait)
adminRouter.post('/queue-items/:id/approve', async (c) => {
  const { id } = c.req.param()
  const { mode = 'now' } = await c.req.json().catch(() => ({ mode: 'now' }))

  if (mode === 'queue') {
    // Queue mode: set to approved, let cron pick it up during business hours
    const { error } = await supabase
      .from('queue_items')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending_approval')

    if (error) return c.json({ error: error.message }, 400)
    return c.json({ success: true, mode: 'queue', message: 'Approved — will process during business hours' })
  }

  // Now mode: immediately mark as processing and execute the handler
  const { data: item, error: fetchError } = await supabase
    .from('queue_items')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending_approval')
    .single()

  if (fetchError || !item) return c.json({ error: 'Item not found or already processed' }, 400)

  // Mark as processing
  await supabase
    .from('queue_items')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', id)

  // Import and run the appropriate handler immediately
  const { agentLog } = await import('../lib/logger')
  const handlerMap: Record<string, string> = {
    call: 'handleCall',
    close: 'handleClose',
    followup: 'handleFollowup',
  }

  const handlerName = handlerMap[item.queue_name]
  if (!handlerName) {
    // Fallback: just mark as approved for non-mapped queues
    await supabase
      .from('queue_items')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', id)
    return c.json({ success: true, mode: 'queue' })
  }

  // Execute async — return immediately so dashboard doesn't hang
  const handlers = await import('../lib/queue-handlers')
  const handler = (handlers as any)[handlerName]

  ;(async () => {
    try {
      await handler(item)
      await supabase
        .from('queue_items')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', id)
      await agentLog('admin', `Immediate ${item.queue_name} execution complete`, { leadId: item.lead_id, level: 'success' })
    } catch (err) {
      await supabase
        .from('queue_items')
        .update({ status: 'failed', error: String(err), updated_at: new Date().toISOString() })
        .eq('id', id)
      await agentLog('admin', `Immediate ${item.queue_name} failed: ${String(err)}`, { leadId: item.lead_id, level: 'error' })
    }
  })()

  return c.json({ success: true, mode: 'now', message: 'Executing immediately' })
})

// Skip HITL item
adminRouter.post('/queue-items/:id/skip', async (c) => {
  const { id } = c.req.param()

  // Get the item to find lead_id
  const { data: item } = await supabase.from('queue_items').select('lead_id').eq('id', id).single()

  await supabase
    .from('queue_items')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (item) {
    await supabase
      .from('leads')
      .update({ status: 'rejected', status_updated_at: new Date().toISOString() })
      .eq('id', item.lead_id)
  }

  return c.json({ success: true })
})

// Pipeline metrics
adminRouter.get('/stats', async (c) => {
  const statusCounts: Record<string, number> = {}
  const statuses = [
    'discovered', 'verified', 'copywriting', 'briefed', 'building', 'built',
    'seo_optimizing', 'seo_optimized', 'reviewing', 'reviewed',
    'deployed', 'emailed', 'called', 'followed_up', 'clicked', 'booked',
    'hitl_ready', 'closing_call', 'spec_sent', 'paid', 'delivering', 'delivered',
    'closed', 'rejected',
  ]

  for (const status of statuses) {
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    statusCounts[status] = count || 0
  }

  const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true })
  const { count: totalRuns } = await supabase.from('pipeline_runs').select('*', { count: 'exact', head: true })

  return c.json({
    totalLeads: totalLeads || 0,
    totalRuns: totalRuns || 0,
    statusCounts,
  })
})

// Recent agent logs
adminRouter.get('/logs', async (c) => {
  const limit = Number.parseInt(c.req.query('limit') || '50')
  const { data } = await supabase
    .from('agent_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  return c.json({ logs: data || [] })
})

// Pending HITL items
adminRouter.get('/hitl', async (c) => {
  const { data } = await supabase
    .from('queue_items')
    .select('*, leads(*)')
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true })

  return c.json({ items: data || [] })
})

// Request changes on a lead — sends to build then straight to deploy (bypasses SEO + review)
adminRouter.post('/leads/:id/rebuild', async (c) => {
  const { id } = c.req.param()
  const { changes } = await c.req.json()

  const { data: lead } = await supabase.from('leads').select('name, status').eq('id', id).single()
  if (!lead) return c.json({ error: 'Lead not found' }, 404)

  // Mark as a change request and set status for build queue to pick up
  await supabase.from('leads').update({
    requested_changes: changes,
    skip_to_deploy: true,
    status: 'briefed',
    status_updated_at: new Date().toISOString(),
  }).eq('id', id)

  // Enqueue for build — the build handler will apply changes, then handleBuild routes to deploy
  const { enqueue } = await import('../lib/queue')
  await enqueue({ leadId: id, queueName: 'build' })

  const { agentLog } = await import('../lib/logger')
  await agentLog('admin', `Change request for "${lead.name}": ${changes}`, { leadId: id })

  return c.json({ success: true, message: `Change request queued for ${lead.name}` })
})

// Retry a failed queue item — re-enqueues at the same stage
adminRouter.post('/queue-items/:id/retry', async (c) => {
  const { id } = c.req.param()

  const { data: item, error } = await supabase
    .from('queue_items')
    .select('*')
    .eq('id', id)
    .eq('status', 'failed')
    .single()

  if (error || !item) return c.json({ error: 'Failed item not found' }, 404)

  // Reset the lead status to allow re-processing
  const statusReset: Record<string, string> = {
    verify: 'discovered',
    copywrite: 'verified',
    build: 'briefed',
    seo: 'built',
    review: 'seo_optimized',
    deploy: 'reviewed',
    call: 'deployed',
    followup: 'called',
    close: 'booked',
  }

  const resetTo = statusReset[item.queue_name]
  if (resetTo) {
    await supabase.from('leads').update({
      status: resetTo,
      status_updated_at: new Date().toISOString(),
      error: null,
    }).eq('id', item.lead_id)
  }

  // Delete the failed item and re-enqueue
  await supabase.from('queue_items').delete().eq('id', id)

  const { enqueue } = await import('../lib/queue')
  await enqueue({
    leadId: item.lead_id,
    queueName: item.queue_name as QueueName,
    pipelineRunId: item.pipeline_run_id || undefined,
  })

  const { agentLog } = await import('../lib/logger')
  await agentLog('admin', `Retrying ${item.queue_name} for lead ${item.lead_id}`, { leadId: item.lead_id })

  return c.json({ success: true, message: `Re-queued for ${item.queue_name}` })
})

// Get all failed items across all queues
adminRouter.get('/failed', async (c) => {
  const { data } = await supabase
    .from('queue_items')
    .select('*, leads(*)')
    .eq('status', 'failed')
    .order('created_at', { ascending: false })

  return c.json({ items: data || [] })
})

// Clear all data (leads, queue items, logs, pipeline runs)
adminRouter.post('/clear', async (c) => {
  await supabase.from('agent_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('queue_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('pipeline_runs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  return c.json({ success: true, message: 'All data cleared' })
})
