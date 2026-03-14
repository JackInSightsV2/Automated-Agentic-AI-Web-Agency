import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'
import { runCloserAgent, pollClosingCall } from '../agents/closer'
import { runDeliveryPipeline } from '../agents/delivery'
import { createCheckoutLink, verifyWebhookSignature } from '../lib/stripe'
import { rateLimit } from '../lib/rate-limit'
import { agency } from '../lib/config'

export const closingRouter = new Hono()

// Rate limit the Calendly webhook to prevent abuse
const webhookLimiter = rateLimit({ windowMs: 60000, max: 30 })

// Calendly webhook — fires when someone books a call
closingRouter.post('/calendly/webhook', webhookLimiter, async (c) => {
  const body = await c.req.json()

  const event = body.event || body.payload?.event
  if (event !== 'invitee.created') {
    return c.json({ ok: true, message: 'Ignored event' })
  }

  const payload = body.payload || body
  const invitee = payload.invitee || payload
  const name = invitee.name || invitee.first_name || ''
  const email = invitee.email || ''
  const eventUrl = payload.event?.uri || payload.uri || ''

  await agentLog('closer', `Calendly booking received: ${name} (${email})`, {
    metadata: { name, email, eventUrl }
  })

  // Try to match to an existing lead
  let lead = null

  if (email) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, status')
      .eq('email', email)
      .single()
    lead = data
  }

  if (!lead && name) {
    const { data } = await supabase
      .from('leads')
      .select('id, name, status')
      .ilike('name', `%${name}%`)
      .limit(1)
      .single()
    lead = data
  }

  if (!lead) {
    await agentLog('closer', `No matching lead for Calendly booking: ${name}`, { level: 'warn' })
    await notify(
      `New Calendly booking but no matching lead:\n` +
      `Name: ${name}\nEmail: ${email}\n\n` +
      `You may need to manually trigger the closing call.`
    )
    return c.json({ ok: true, message: 'No matching lead' })
  }

  await supabase.from('leads').update({
    status: 'booked',
    status_updated_at: new Date().toISOString(),
    demo_booked_at: new Date().toISOString(),
    calendly_event_url: eventUrl,
    email: email || undefined
  }).eq('id', lead.id)

  await notify(
    `Call booked — ${lead.name}\n` +
    `Calendly: ${name} (${email})\n\n` +
    `Triggering closing call...`
  )

  runCloserAgent(lead.id).catch(async (err) => {
    await agentLog('closer', `Closing call failed for ${lead.name}: ${String(err)}`, {
      leadId: lead.id, level: 'error'
    })
  })

  return c.json({ ok: true, lead_id: lead.id })
})

// Manually trigger a closing call
closingRouter.post('/call/:leadId', async (c) => {
  const { leadId } = c.req.param()
  try {
    await runCloserAgent(leadId)
    return c.json({ success: true, message: 'Closing call initiated' })
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500)
  }
})

// Poll closing call result
closingRouter.get('/poll/:leadId', async (c) => {
  const { leadId } = c.req.param()
  const result = await pollClosingCall(leadId)
  return c.json({ result })
})

// Stripe checkout success redirect — shows a thank you page
closingRouter.get('/payment-success', async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Payment Received — ${agency.name}</title>
    <style>
      body { font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #fafafa; }
      .card { text-align: center; max-width: 480px; padding: 48px; background: white; border-radius: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      h1 { color: #E84393; margin-bottom: 16px; }
      p { color: #525252; line-height: 1.7; }
    </style>
    </head>
    <body>
      <div class="card">
        <h1>Thanks for your payment!</h1>
        <p>We've received your payment and we're getting to work on your website right away.</p>
        <p>We'll send you a message once the changes are done and the site is ready for you to review before we connect your domain.</p>
        <p style="margin-top: 24px; font-weight: 600; color: #E84393;">— ${agency.name}</p>
      </div>
    </body>
    </html>
  `)
})

// Stripe webhook — instant payment notification (complements polling)
closingRouter.post('/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  if (!sig) return c.json({ error: 'Missing stripe-signature header' }, 400)

  const body = await c.req.text()
  const event = verifyWebhookSignature(body, sig)

  if (!event) {
    // If no webhook secret configured, fall back to trusting the payload
    // (polling is the primary mechanism; webhook is supplementary)
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      try {
        const parsed = JSON.parse(body)
        await handleStripeEvent(parsed)
        return c.json({ received: true })
      } catch {
        return c.json({ error: 'Invalid payload' }, 400)
      }
    }
    return c.json({ error: 'Invalid signature' }, 400)
  }

  await handleStripeEvent(event)
  return c.json({ received: true })
})

async function handleStripeEvent(event: any) {
  if (event.type !== 'checkout.session.completed') return

  const session = event.data?.object
  const leadId = session?.metadata?.lead_id
  if (!leadId) return

  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, status, paid_at, contact_name')
    .eq('id', leadId)
    .single()

  if (!lead || lead.paid_at || lead.status !== 'spec_sent') return

  const contactName = lead.contact_name || lead.name.split(' ')[0]
  const amountTotal = (session.amount_total || 0) / 100

  await supabase.from('leads').update({
    status: 'paid',
    status_updated_at: new Date().toISOString(),
    paid_at: new Date().toISOString(),
  }).eq('id', leadId)

  await agentLog('stripe', `Webhook: payment received for ${lead.name}: £${amountTotal}`, {
    leadId,
    level: 'success'
  })

  await notify(
    `Payment received (webhook) from ${contactName} (${lead.name}) — £${amountTotal}!\n\n` +
    `Starting delivery pipeline...`
  )

  runDeliveryPipeline(leadId).catch(async (err) => {
    await agentLog('delivery', `Delivery pipeline failed for ${lead.name}: ${String(err)}`, {
      leadId, level: 'error'
    })
  })
}

// Mark as paid (manual trigger) and start delivery
closingRouter.post('/paid/:leadId', async (c) => {
  const { leadId } = c.req.param()

  const { data: lead } = await supabase
    .from('leads')
    .select('name, contact_name, desired_domain, needs_domain, needs_email_setup, cta_type, cta_value, requested_changes, total_price, vercel_deployment_url')
    .eq('id', leadId)
    .single()

  if (!lead) return c.json({ error: 'Lead not found' }, 404)

  const contactName = lead.contact_name || lead.name.split(' ')[0]

  await supabase.from('leads').update({
    status: 'paid',
    status_updated_at: new Date().toISOString(),
    paid_at: new Date().toISOString()
  }).eq('id', leadId)

  await notify(
    `Payment received from ${contactName} (${lead.name}) — £${lead.total_price}!\n\n` +
    `Domain: ${lead.desired_domain || (lead.needs_domain ? 'Needs registration' : 'TBC')}\n` +
    `Changes: ${lead.requested_changes || 'None'}\n\n` +
    `Starting delivery pipeline...`
  )

  await agentLog('closer', `Payment received for ${lead.name}: £${lead.total_price}`, {
    leadId, level: 'success'
  })

  // Trigger delivery pipeline: apply changes → SEO → review → deploy
  runDeliveryPipeline(leadId).catch(async (err) => {
    await agentLog('delivery', `Delivery pipeline failed for ${lead.name}: ${String(err)}`, {
      leadId, level: 'error'
    })
  })

  return c.json({ success: true, message: 'Paid — delivery pipeline started' })
})

// Generate a payment link for a lead (manual)
closingRouter.post('/payment-link/:leadId', async (c) => {
  const { leadId } = c.req.param()

  const { data: lead } = await supabase
    .from('leads')
    .select('name, needs_domain, stripe_payment_link')
    .eq('id', leadId)
    .single()

  if (!lead) return c.json({ error: 'Lead not found' }, 404)

  if (lead.stripe_payment_link) {
    return c.json({ success: true, url: lead.stripe_payment_link })
  }

  const url = await createCheckoutLink(leadId, lead.name, lead.needs_domain || false)

  await supabase.from('leads').update({ stripe_payment_link: url }).eq('id', leadId)

  return c.json({ success: true, url })
})

// Manually trigger delivery
closingRouter.post('/deliver/:leadId', async (c) => {
  const { leadId } = c.req.param()
  try {
    runDeliveryPipeline(leadId).catch(async (err) => {
      await agentLog('delivery', `Manual delivery failed: ${String(err)}`, { leadId, level: 'error' })
    })
    return c.json({ success: true, message: 'Delivery pipeline started' })
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500)
  }
})
