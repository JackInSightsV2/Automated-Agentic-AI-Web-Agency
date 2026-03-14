import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'

/**
 * Monitor agent: scans leads in post-deployment statuses and scores warmth.
 * Cron-based (every 60s), NOT queue-based. No Claude Code — direct DB queries.
 */
export async function runMonitorAgent(): Promise<void> {
  // Query leads in post-deployment statuses that haven't been promoted yet
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .in('status', ['deployed', 'emailed', 'called'])

  if (error) {
    await agentLog('monitor', `Failed to query leads: ${error.message}`, { level: 'error' })
    return
  }

  if (!leads || leads.length === 0) return

  for (const lead of leads) {
    let score = 0
    const signals: string[] = []

    // Email opened
    if (lead.email_opened_at) {
      score += 20
      signals.push('email opened')
    }

    // Email clicked
    if (lead.email_clicked_at) {
      score += 30
      signals.push('email clicked')
    }

    // Call outcome scoring
    if (lead.call_outcome) {
      const outcome = lead.call_outcome.toLowerCase()
      if (outcome.includes('interested') || outcome.includes('positive') || outcome.includes('callback')) {
        score += 40
        signals.push(`call: ${lead.call_outcome}`)
      } else if (outcome.includes('voicemail') || outcome.includes('no answer')) {
        score += 10
        signals.push(`call: ${lead.call_outcome}`)
      }
    }

    // Demo booked
    if (lead.demo_booked_at || lead.calendly_event_url) {
      score += 50
      signals.push('demo booked')
    }

    // Threshold: score >= 50 → promote to hitl_ready
    if (score >= 50) {
      await supabase.from('leads').update({
        status: 'hitl_ready',
        status_updated_at: new Date().toISOString()
      }).eq('id', lead.id)

      const signalList = signals.join(', ')
      await notify(
        `🔥 *Warm lead detected: ${lead.name}*\n` +
        `Score: ${score}/100\n` +
        `Signals: ${signalList}\n` +
        `Phone: ${lead.phone || 'N/A'}\n` +
        `Site: ${lead.vercel_deployment_url || 'N/A'}\n\n` +
        `_Ready for human follow-up_`
      )

      await agentLog('monitor', `${lead.name} promoted to hitl_ready (score: ${score}, signals: ${signalList})`, {
        leadId: lead.id,
        level: 'success',
        metadata: { score, signals }
      })
    }
  }
}
