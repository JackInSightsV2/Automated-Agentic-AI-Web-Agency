import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { supabase } from '../lib/supabase'
import { getQueueStats, getQueueStates, getBusinessHours, getHITLConfig, getConcurrencyConfig } from '../lib/queue'

export const eventsRouter = new Hono()

eventsRouter.get('/stream', async (c) => {
  return streamSSE(c, async (stream) => {
    let running = true

    stream.onAbort(() => {
      running = false
    })

    while (running) {
      try {
        const [queueStats, queueStates, businessHours, hitlConfig, concurrency] = await Promise.all([
          getQueueStats(),
          getQueueStates(),
          getBusinessHours(),
          getHITLConfig(),
          getConcurrencyConfig(),
        ])

        // Worker names
        const { data: workerNamesRow } = await supabase
          .from('system_config')
          .select('value')
          .eq('key', 'worker_names')
          .single()

        // Recent logs (more for better visibility)
        const { data: recentLogs } = await supabase
          .from('agent_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(25)

        // Active leads (in-progress statuses) — include all fields the dashboard needs
        const { data: activeLeads } = await supabase
          .from('leads')
          .select('id, name, status, category, phone, viability_score, vercel_deployment_url, call_outcome, error, updated_at')
          .order('updated_at', { ascending: false })
          .limit(30)

        // Pending HITL items
        const { data: hitlItems } = await supabase
          .from('queue_items')
          .select('id, lead_id, queue_name, created_at')
          .eq('status', 'pending_approval')
          .order('created_at', { ascending: true })

        // Currently processing items (what each agent is working on right now)
        const { data: processingItems } = await supabase
          .from('queue_items')
          .select('id, lead_id, queue_name, updated_at, leads(name, category)')
          .eq('status', 'processing')

        const payload = {
          queues: queueStats,
          queueStates,
          businessHours,
          hitlConfig,
          concurrency,
          workerNames: (workerNamesRow?.value || {}) as Record<string, string>,
          recentLogs: recentLogs || [],
          activeLeads: activeLeads || [],
          hitlItems: hitlItems || [],
          processingItems: processingItems || [],
          timestamp: new Date().toISOString(),
        }

        await stream.writeSSE({
          event: 'update',
          data: JSON.stringify(payload),
        })
      } catch (err) {
        console.error('[SSE] Error:', err)
      }

      await stream.sleep(2000)
    }
  })
})

// GET /events/agent-feed?agent=builder&since=<ISO timestamp>
// Streams logs for a specific agent, polling every 1s for new entries
eventsRouter.get('/agent-feed', async (c) => {
  return streamSSE(c, async (stream) => {
    let running = true
    const agent = c.req.query('agent') || ''
    let lastSeen = c.req.query('since') || new Date(Date.now() - 60000).toISOString()

    stream.onAbort(() => { running = false })

    while (running) {
      try {
        let query = supabase
          .from('agent_logs')
          .select('*')
          .gt('created_at', lastSeen)
          .order('created_at', { ascending: true })
          .limit(50)

        if (agent) {
          query = query.eq('agent', agent)
        }

        const { data: logs } = await query

        if (logs && logs.length > 0) {
          lastSeen = logs[logs.length - 1].created_at

          await stream.writeSSE({
            event: 'logs',
            data: JSON.stringify(logs),
          })
        }
      } catch (err) {
        console.error('[SSE agent-feed] Error:', err)
      }

      await stream.sleep(1000)
    }
  })
})
