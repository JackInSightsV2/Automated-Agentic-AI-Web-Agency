import { supabase } from './supabase'
import { agentLog } from './logger'
import { notify } from './telegram'
import { runDeliveryPipeline } from '../agents/delivery'

/**
 * Mark a lead as paid exactly once and kick off delivery.
 *
 * Used by the Stripe poller, the Stripe webhook, and the manual /closing/paid
 * endpoint. The update is conditional on the lead still being in `spec_sent`
 * (or, for manual/forced use, on not yet having `paid_at`), so two callers
 * racing each other cannot both start delivery.
 *
 * Returns true if this call performed the transition, false if it was already done.
 */
export async function markLeadPaid(
  leadId: string,
  opts: { source: 'stripe-poll' | 'stripe-webhook' | 'manual'; amount?: number | null; force?: boolean },
): Promise<boolean> {
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, status, paid_at, contact_name, total_price, desired_domain, needs_domain, requested_changes')
    .eq('id', leadId)
    .single()

  if (!lead) return false
  if (lead.paid_at) return false
  if (!opts.force && lead.status !== 'spec_sent') return false

  const now = new Date().toISOString()

  // Conditional update: only the caller that observes the expected status wins.
  let update = supabase
    .from('leads')
    .update({ status: 'paid', status_updated_at: now, paid_at: now })
    .eq('id', leadId)
  update = opts.force ? update.eq('status', lead.status) : update.eq('status', 'spec_sent')
  const { data: updated } = await update.select('id').single()

  if (!updated) return false // Someone else got there first

  const contactName = lead.contact_name || lead.name.split(' ')[0]
  const amount = opts.amount ?? lead.total_price
  const amountText = amount != null ? ` — £${amount}` : ''

  await agentLog(opts.source === 'manual' ? 'closer' : 'stripe', `Payment received for ${lead.name}${amountText} (${opts.source})`, {
    leadId,
    level: 'success',
  })

  await notify(
    `Payment received from ${contactName} (${lead.name})${amountText}!\n\n` +
    (opts.source === 'manual'
      ? `Domain: ${lead.desired_domain || (lead.needs_domain ? 'Needs registration' : 'TBC')}\n` +
        `Changes: ${lead.requested_changes || 'None'}\n\n`
      : '') +
    `Starting delivery pipeline...`,
  )

  runDeliveryPipeline(leadId).catch(async (err) => {
    await agentLog('delivery', `Delivery pipeline failed for ${lead.name}: ${String(err)}`, {
      leadId,
      level: 'error',
    })
  })

  return true
}
