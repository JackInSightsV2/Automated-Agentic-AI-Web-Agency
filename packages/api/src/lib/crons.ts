import { supabase } from './supabase'
import { agentLog } from './logger'
import { notify } from './telegram'
import { checkPaidSessions } from './stripe'
import { runDeliveryPipeline } from '../agents/delivery'
import { dequeue, completeItem, failItem, isQueueActive, isWithinBusinessHours, getConcurrency, getProcessingCount } from './queue'
import { handleVerify, handleCopywrite, handleBuild, handleSeo, handleReview, handleDeploy, handleCall, handleFollowup, handleClose } from './queue-handlers'
import { runMonitorAgent } from '../agents/monitor'
import type { QueueName, QueueItem } from '../types'

/** Check Stripe for paid sessions, match to leads, and trigger delivery */
async function checkPayments() {
  try {
    const sessions = await checkPaidSessions()

    for (const session of sessions) {
      // Check if this lead is in spec_sent status (waiting for payment)
      const { data: lead } = await supabase
        .from('leads')
        .select('id, name, status, paid_at, contact_name')
        .eq('id', session.leadId)
        .single()

      if (!lead) continue
      if (lead.paid_at) continue // Already processed
      if (lead.status !== 'spec_sent') continue

      const contactName = lead.contact_name || lead.name.split(' ')[0]

      // Mark as paid
      await supabase.from('leads').update({
        status: 'paid',
        status_updated_at: new Date().toISOString(),
        paid_at: new Date().toISOString(),
      }).eq('id', lead.id)

      await agentLog('cron', `Payment received for ${lead.name}: £${session.amountTotal}`, {
        leadId: lead.id,
        level: 'success'
      })

      await notify(
        `Payment received from ${contactName} (${lead.name}) — £${session.amountTotal}!\n\n` +
        `Starting delivery process...`
      )

      // Trigger the delivery pipeline: apply changes → SEO → review → deploy
      runDeliveryPipeline(lead.id).catch(async (err) => {
        await agentLog('cron', `Delivery pipeline failed for ${lead.name}: ${String(err)}`, {
          leadId: lead.id,
          level: 'error'
        })
      })
    }
  } catch (err) {
    console.error('[CRON] Payment check error:', err)
  }
}

/** Process all queue stages */
async function processQueues() {
  const queues: [QueueName, (item: QueueItem) => Promise<void>][] = [
    ['verify', handleVerify],
    ['copywrite', handleCopywrite],
    ['build', handleBuild],
    ['seo', handleSeo],
    ['review', handleReview],
    ['deploy', handleDeploy],
    ['call', handleCall],
    ['followup', handleFollowup],
    ['close', handleClose],
  ]

  for (const [name, handler] of queues) {
    try {
      if (!await isQueueActive(name)) continue

      // Business hours enforcement for call and close queues
      if (['call', 'close'].includes(name) && !await isWithinBusinessHours()) continue

      // Concurrency check
      const maxWorkers = await getConcurrency(name)
      const currentWorkers = await getProcessingCount(name)
      if (currentWorkers >= maxWorkers) continue

      const item = await dequeue(name)
      if (item) {
        // Fire and forget — allows multiple items to process in parallel
        processItem(name, item, handler)
      }
    } catch (err) {
      console.error(`[CRON] Queue ${name} error:`, err)
    }
  }
}

async function processItem(name: QueueName, item: QueueItem, handler: (item: QueueItem) => Promise<void>) {
  try {
    await handler(item)
    await completeItem(item.id)
  } catch (err) {
    const errStr = String(err)

    // Business hours errors → put back in queue (reset to pending), don't mark as failed
    if (errStr.includes('outside business hours')) {
      await supabase
        .from('queue_items')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', item.id)
      await agentLog('queue', `${name}: outside business hours, "${item.lead_id}" returned to queue`, {
        leadId: item.lead_id,
        level: 'warn',
      })
      return
    }

    await failItem(item.id, errStr)
    await agentLog('queue', `${name} failed for lead ${item.lead_id}: ${errStr}`, {
      leadId: item.lead_id,
      level: 'error',
    })
  }
}

/** Auto-fetch: when leads reach the call stage, scout for more every 3.5 minutes */
async function autoFetchLeads() {
  try {
    // Check if any leads are waiting at the call stage (pending_approval = HITL gate)
    const { count: atCallStage } = await supabase
      .from('queue_items')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', 'call')
      .in('status', ['pending_approval', 'approved', 'pending'])

    if (!atCallStage || atCallStage === 0) return

    // Check we're not already scouting (no active pipeline runs in last 60s)
    const { data: recentScout } = await supabase
      .from('agent_logs')
      .select('created_at')
      .eq('agent', 'scout')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentScout) {
      const lastScoutAge = Date.now() - new Date(recentScout.created_at).getTime()
      if (lastScoutAge < 180000) return // Don't scout if we scouted in the last 3 minutes
    }

    await agentLog('cron', 'Auto-fetch: leads at call stage, scouting for more...', { level: 'info' })

    // Get the last pipeline run's query to reuse, or default
    const { data: lastRun } = await supabase
      .from('pipeline_runs')
      .select('query, location')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    const query = lastRun?.query || 'local businesses'
    const location = lastRun?.location || 'London'

    // Create a new pipeline run
    const { data: run } = await supabase
      .from('pipeline_runs')
      .insert({ query, location })
      .select()
      .single()

    if (run) {
      const { runPipeline } = await import('../routes/pipeline')
      runPipeline(run.id, `${query} ${location}`).catch(console.error)
      await notify(`🔄 Auto-fetch: scouting more ${query} in ${location}`)
    }
  } catch (err) {
    console.error('[CRON] Auto-fetch error:', err)
  }
}

let paymentInterval: ReturnType<typeof setInterval> | null = null
let queueInterval: ReturnType<typeof setInterval> | null = null
let autoFetchInterval: ReturnType<typeof setInterval> | null = null
let monitorInterval: ReturnType<typeof setInterval> | null = null

export function startCrons() {
  console.log('[CRON] Starting payment check — every 60 seconds')
  console.log('[CRON] Starting queue processor — every 15 seconds')
  console.log('[CRON] Starting auto-fetch — every 3.5 minutes')
  console.log('[CRON] Starting monitor — every 60 seconds')

  // Run immediately on startup
  checkPayments()

  // Payment check every 60 seconds
  paymentInterval = setInterval(checkPayments, 60 * 1000)

  // Queue processor every 15 seconds
  queueInterval = setInterval(processQueues, 15 * 1000)

  // Auto-fetch new leads every 3.5 minutes
  autoFetchInterval = setInterval(autoFetchLeads, 3.5 * 60 * 1000)

  // Monitor warm leads every 60 seconds
  monitorInterval = setInterval(async () => {
    try {
      await runMonitorAgent()
    } catch (err) {
      console.error('[CRON] Monitor error:', err)
    }
  }, 60 * 1000)
}

export function stopCrons() {
  if (paymentInterval) {
    clearInterval(paymentInterval)
    paymentInterval = null
  }
  if (queueInterval) {
    clearInterval(queueInterval)
    queueInterval = null
  }
  if (autoFetchInterval) {
    clearInterval(autoFetchInterval)
    autoFetchInterval = null
  }
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
  }
}

// Graceful shutdown — clean up intervals and Telegram bot on process exit
function handleShutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}, cleaning up...`)
  stopCrons()
  try {
    const { bot } = require('./telegram')
    bot.stopPolling()
  } catch { /* telegram not loaded */ }
  process.exit(0)
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))
