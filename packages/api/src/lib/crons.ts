import { supabase } from './supabase'
import { agentLog } from './logger'
import { notify } from './telegram'
import { checkPaidSessions } from './stripe'
import { markLeadPaid } from './payments'
import { dequeue, completeItem, failItem, isQueueActive, isWithinBusinessHours, getConcurrency, getQueueStats, recoverStaleItems } from './queue'
import { handleVerify, handleCopywrite, handleBuild, handleSeo, handleReview, handleDeploy, handleCall, handleFollowup, handleClose } from './queue-handlers'
import { runMonitorAgent } from '../agents/monitor'
import { pollBlandCall } from '../agents/caller'
import { pollClosingCall } from '../agents/closer'
import type { QueueName, QueueItem } from '../types'

/** Items stuck in `processing` longer than this are failed so the slot frees up. */
const STALE_ITEM_MS = Number.parseInt(process.env.QUEUE_STALE_MINUTES || '30') * 60 * 1000

/** Auto-fetch will not scout while this many (or more) items are in flight. */
const AUTO_FETCH_MAX_INFLIGHT = Number.parseInt(process.env.AUTO_FETCH_MAX_INFLIGHT || '10')

/** Check Stripe for paid sessions, match to leads, and trigger delivery */
async function checkPayments() {
  try {
    const sessions = await checkPaidSessions()
    for (const session of sessions) {
      // markLeadPaid is conditional on status = spec_sent, so a session that was
      // already handled here or by the webhook is a no-op.
      await markLeadPaid(session.leadId, { source: 'stripe-poll', amount: session.amountTotal })
    }
  } catch (err) {
    console.error('[CRON] Payment check error:', err)
  }
}

/**
 * Record outcomes for in-flight Bland calls. There is no webhook in a
 * self-hosted setup, so this is what moves a lead past `called` / `closing_call`.
 */
async function checkCallOutcomes() {
  try {
    const { data: calling } = await supabase
      .from('leads')
      .select('id, name')
      .eq('status', 'called')
      .is('call_completed_at', null)

    for (const lead of calling || []) {
      try {
        await pollBlandCall(lead.id)
      } catch (err) {
        console.error(`[CRON] Call poll error for ${lead.name}:`, err)
      }
    }

    const { data: closing } = await supabase
      .from('leads')
      .select('id, name')
      .eq('status', 'closing_call')

    for (const lead of closing || []) {
      try {
        await pollClosingCall(lead.id)
      } catch (err) {
        console.error(`[CRON] Closing call poll error for ${lead.name}:`, err)
      }
    }
  } catch (err) {
    console.error('[CRON] Call outcome check error:', err)
  }
}

const HANDLERS: Array<[QueueName, (item: QueueItem) => Promise<void>]> = [
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

let queueTickRunning = false

/** Process all queue stages */
async function processQueues() {
  if (queueTickRunning) return // Previous tick still going — don't overlap
  queueTickRunning = true
  try {
    await failStaleItems()

    const stats = await getQueueStats()

    for (const [name, handler] of HANDLERS) {
      try {
        if (!await isQueueActive(name)) continue

        // Business hours enforcement for call and close queues
        if (['call', 'close'].includes(name) && !await isWithinBusinessHours()) continue

        // Concurrency check (dequeue re-checks atomically)
        const maxWorkers = await getConcurrency(name)
        if (stats[name].processing >= maxWorkers) continue

        const item = await dequeue(name)
        if (item) {
          // Fire and forget — allows multiple items to process in parallel
          processItem(name, item, handler)
        }
      } catch (err) {
        console.error(`[CRON] Queue ${name} error:`, err)
      }
    }
  } finally {
    queueTickRunning = false
  }
}

async function failStaleItems() {
  try {
    const stale = await recoverStaleItems(STALE_ITEM_MS)
    for (const item of stale) {
      await agentLog('queue', `${item.queue_name}: item for lead ${item.lead_id} stuck in processing for >${STALE_ITEM_MS / 60000}m — marked failed (retry from dashboard)`, {
        leadId: item.lead_id,
        level: 'warn',
      })
    }
  } catch (err) {
    console.error('[CRON] Stale item recovery error:', err)
  }
}

async function processItem(name: QueueName, item: QueueItem, handler: (item: QueueItem) => Promise<void>) {
  try {
    await handler(item)
    await completeItem(item.id)
  } catch (err) {
    const errStr = String(err)
    await failItem(item.id, errStr)
    await agentLog('queue', `${name} failed for lead ${item.lead_id}: ${errStr}`, {
      leadId: item.lead_id,
      level: 'error',
    })
  }
}

/**
 * Auto-fetch: once the first batch has reached the call stage, keep the
 * pipeline topped up — but only while fewer than AUTO_FETCH_MAX_INFLIGHT
 * items are pending/processing across all queues, and only while the verify
 * queue is active (so "Finish Work Day" / pause stops it).
 */
async function autoFetchLeads() {
  try {
    if (!await isQueueActive('verify')) return

    // Trigger: at least one lead has reached the call stage
    const { count: atCallStage } = await supabase
      .from('queue_items')
      .select('*', { count: 'exact', head: true })
      .eq('queue_name', 'call')
      .in('status', ['pending_approval', 'approved', 'pending'])

    if (!atCallStage || atCallStage === 0) return

    // Cap: total work in flight. A single unapproved HITL item must not make
    // this scout (and build, and deploy) new leads every 3.5 minutes forever.
    const { count: inFlight } = await supabase
      .from('queue_items')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'pending_approval', 'approved', 'processing'])

    if ((inFlight || 0) >= AUTO_FETCH_MAX_INFLIGHT) return

    // Check we're not already scouting (no scout activity in last 3 minutes)
    const { data: recentScout } = await supabase
      .from('agent_logs')
      .select('created_at')
      .eq('agent', 'scout')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (recentScout) {
      const lastScoutAge = Date.now() - new Date(recentScout.created_at).getTime()
      if (lastScoutAge < 180000) return
    }

    await agentLog('cron', `Auto-fetch: ${inFlight || 0}/${AUTO_FETCH_MAX_INFLIGHT} items in flight, scouting for more...`, { level: 'info' })

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
let callInterval: ReturnType<typeof setInterval> | null = null

export function startCrons() {
  console.log('[CRON] Starting payment check — every 60 seconds')
  console.log('[CRON] Starting queue processor — every 15 seconds')
  console.log('[CRON] Starting call outcome poller — every 30 seconds')
  console.log('[CRON] Starting auto-fetch — every 3.5 minutes')
  console.log('[CRON] Starting monitor — every 60 seconds')

  // Anything still 'processing' from before this process started is dead.
  recoverStaleItems(0)
    .then(async (items) => {
      if (items.length === 0) return
      console.log(`[CRON] Failed ${items.length} queue item(s) left processing by a previous run`)
      await agentLog('queue', `Server restarted: ${items.length} in-flight item(s) marked failed — retry from the dashboard`, { level: 'warn' })
    })
    .catch(err => console.error('[CRON] Startup recovery error:', err))

  // Run immediately on startup
  checkPayments()
  checkCallOutcomes()

  paymentInterval = setInterval(checkPayments, 60 * 1000)
  queueInterval = setInterval(processQueues, 15 * 1000)
  callInterval = setInterval(checkCallOutcomes, 30 * 1000)
  autoFetchInterval = setInterval(autoFetchLeads, 3.5 * 60 * 1000)
  monitorInterval = setInterval(async () => {
    try {
      await runMonitorAgent()
    } catch (err) {
      console.error('[CRON] Monitor error:', err)
    }
  }, 60 * 1000)
}

export function stopCrons() {
  for (const t of [paymentInterval, queueInterval, autoFetchInterval, monitorInterval, callInterval]) {
    if (t) clearInterval(t)
  }
  paymentInterval = queueInterval = autoFetchInterval = monitorInterval = callInterval = null
}

// Exported for tests
export { checkCallOutcomes, autoFetchLeads, processQueues, checkPayments }

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
