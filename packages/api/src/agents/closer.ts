import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'
import { sendClientMessage } from '../lib/twilio'
import { startCall, getCall, isCallFinished, isCallFailed } from '../lib/bland'
import { createCheckoutLink } from '../lib/stripe'
import { agency, pricing, getCallPhone } from '../lib/config'

/** Structured fields we ask Bland to extract after the closing call (see lib/bland.ts). */
const CLOSING_ANALYSIS_SCHEMA = {
  wants_to_go_ahead: 'true only if the customer clearly agreed to buy the website; false if undecided, wants to think about it, or declined',
  domain_name: 'Domain name the customer already owns (e.g. example.co.uk), or null',
  needs_domain_registration: 'true if the customer has no domain and wants us to register one',
  needs_email_setup: 'true if the customer wants a professional email address set up',
  cta_type: 'How customers should contact them on the site: "phone" or "email_form", or null',
  cta_value: 'The phone number or email address for the CTA, or null',
  requested_changes: 'Any changes the customer asked for on the website, as a short sentence, or null',
}

/** A closing call that has not completed after this long is treated as unanswered. */
export const CLOSING_CALL_TIMEOUT_MS = 45 * 60 * 1000

export async function runCloserAgent(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    await agentLog('closer', `Lead not found: ${leadId}`, { leadId, level: 'error' })
    return
  }

  const phone = getCallPhone(lead.phone)
  const contactName = lead.contact_name
  const greeting = contactName
    ? `"Hi there! Is that ${contactName}? ... Brilliant! It's ${agency.callerName} here from ${agency.name} — thanks so much for booking a chat with us! How are you doing today?"`
    : `"Hi there! Am I speaking with someone from ${lead.name}? ... Lovely! And what's your name? ... [REMEMBER THEIR NAME AND USE IT FOR THE REST OF THE CALL] ... Nice to meet you! It's ${agency.callerName} here from ${agency.name} — thanks so much for booking a chat with us! How are you doing today?"`

  await agentLog('closer', `Initiating closing call to: ${lead.name}${contactName ? ` (${contactName})` : ''} (${phone})`, { leadId })

  const suggestedDomain = lead.name.toLowerCase().replace(/[^a-z0-9]/g, '') + agency.defaultTld
  const calendly = process.env.CALENDLY_LINK || 'a booking link we will text over'

  const task = `You are ${agency.callerName} from ${agency.name}, a web design studio in London. You're making a follow-up call to ${lead.name}${contactName ? ` — you spoke to ${contactName} last time` : ''} who booked a call after seeing the website you built for them. Be warm, friendly, and professional — like chatting with a neighbour who's interested in your services.

IMPORTANT: This is a consultative conversation, not a sales pitch. Take your time. Listen. Let them talk. Ask follow-up questions naturally.${contactName ? ` You already know their name is ${contactName} — use it naturally throughout the call.` : ''}

Here's how the call should flow:

1. WARM OPENER:
${greeting}

2. REFERENCE THE WEBSITE:
"So, you had a chance to look at the website we put together for you — what did you think? ... [Listen and respond naturally. If they loved it, be enthusiastic. If they have concerns, acknowledge them.]"

3. EXPLAIN THE OFFER (naturally, not scripted):
"So here's how it works — it's really simple. To get the site live on your own domain, it's just £${pricing.setup} as a one-off setup fee, and then £${pricing.monthly} a month which covers hosting and any small changes you need. So if you want to update your phone number, change some text, add a photo — that's all included."

4. DOMAIN NAME — ask this naturally:
"Now, do you already have a domain name for your business? Like a ${agency.defaultTld} or .com? ...
   - If YES: "Perfect, what is it?" [Repeat back to confirm] "Lovely, we'll get the site set up on that."
   - If NO: "No worries at all! We can sort that out for you. Something like ${suggestedDomain} might work nicely — or we can come up with a few options. There's an extra £${pricing.domain} for domain registration and setting up a professional email address for you — so you'd get something like hello@yourdomain${agency.defaultTld}. Would you like us to sort that?"

5. CTA SETUP — how they want customers to reach them:
"One quick question — on the website, how would you like people to get in touch with you? Would you prefer:
   - A phone number they can tap to call you directly?
   - Or a contact form where they fill in their details and you get an email?
   ... [If phone] Great, what's the best number to put on there?
   ... [If email form] Perfect, which email should the form submissions go to?"

6. ANY CHANGES:
"Is there anything you'd like us to change on the site? Maybe different photos, updated text, or anything like that? ... [Note down whatever they say]"

7. WRAP UP & NEXT STEPS:
"Lovely! So here's what happens next — I'll send you a quick summary of everything we discussed, along with a payment link. Once that's sorted, we'll get cracking on getting your site live. The whole thing usually takes about 24 hours once we have everything.

Is there anything else you'd like to ask? ...

Brilliant, thanks so much for your time${contactName ? ` ${contactName}` : ''}! I'll get that summary over to you shortly. Have a great day!"

8. IF VOICEMAIL:
"Hi there, it's ${agency.callerName} from ${agency.name}! We had a call booked to chat about the website we built for ${lead.name}. No worries — I'll drop you a message with all the details. If you'd like to rebook, there's a link in there too. Have a lovely day!"

INFORMATION YOU MUST COLLECT (ask naturally, don't interrogate):
- Do they want to go ahead? (yes/no/thinking about it) — ask this explicitly before wrapping up
- Domain name: do they have one, or need us to register one?
- CTA preference: phone number or email contact form?
- CTA value: the phone number or email address
- Any changes they want to the website
- Email setup: do they want a professional email? (only if they need a domain)

Business context:
- Business name: ${lead.name}
- Category: ${lead.category}
- Website we built: ${lead.vercel_deployment_url}
- Pricing: £${pricing.setup} setup + £${pricing.monthly}/month
- Domain + email setup: extra £${pricing.domain}
- Booking link: ${calendly}
${lead.google_rating ? `- Their Google rating: ${lead.google_rating}/5 (${lead.google_review_count} reviews)` : ''}

Style notes:
- Warm British conversational tone
- Use natural filler words: "lovely", "brilliant", "perfect", "no worries"
- Don't rush — pause between sections
- If they're unsure, don't push: "Take your time, no pressure at all"
- Repeat back important details (domain names, phone numbers, emails)
- Aim for 3-5 minutes`

  const callId = await startCall({
    phone_number: phone,
    task,
    max_duration: 8,
    wait_for_greeting: true,
    interruption_threshold: 500,
    analysis_schema: CLOSING_ANALYSIS_SCHEMA,
    metadata: { lead_id: leadId, call_type: 'closing' },
  })

  await supabase
    .from('leads')
    .update({
      closing_call_id: callId,
      closing_call_at: new Date().toISOString(),
      closing_summary: null,
      status: 'closing_call',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('closer', `Closing call initiated: ${callId}`, { leadId, level: 'success' })
}

/**
 * Check whether the closing call has finished and, if so, record what was
 * agreed, generate the payment link, and text the job spec to the customer.
 *
 * Idempotent: the lead is moved out of `closing_call` with a conditional
 * update BEFORE any message is sent, so a second poller (cron, manual
 * /closing/poll, or the script) can never send a second SMS or create a
 * second Stripe session.
 */
export async function pollClosingCall(leadId: string): Promise<'going_ahead' | 'undecided' | 'no_answer' | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('closing_call_id, closing_call_at, name, status, vercel_deployment_url, phone, email, contact_name')
    .eq('id', leadId)
    .single()

  if (!lead?.closing_call_id) return null
  if (lead.status !== 'closing_call') return null // Already processed (or never started)
  if (!process.env.BLAND_AI_API_KEY) return null

  const call = await getCall(lead.closing_call_id)

  const startedAt = lead.closing_call_at ? new Date(lead.closing_call_at).getTime() : Date.now()
  const timedOut = Date.now() - startedAt > CLOSING_CALL_TIMEOUT_MS

  if (!isCallFinished(call) && !isCallFailed(call) && !timedOut) return null

  // Call never completed: hand back to the human rather than guessing.
  if (!isCallFinished(call)) {
    const { data: updated } = await supabase
      .from('leads')
      .update({
        closing_summary: `Closing call did not complete (Bland status: ${call.status || 'unknown'}${timedOut ? ', timed out' : ''})`,
        status: 'hitl_ready',
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', leadId)
      .eq('status', 'closing_call')
      .select('id')
      .single()
    if (!updated) return null

    await agentLog('closer', `Closing call for ${lead.name} did not complete → hitl_ready`, { leadId, level: 'warn' })
    await notify(`Closing call with *${lead.name}* did not complete. Rebook or call manually.`).catch(() => {})
    return 'no_answer'
  }

  const details = extractClosingDetails(call.transcripts || [], call.summary || '', call.analysis)
  const totalPrice = pricing.setup + (details.needsDomain ? pricing.domain : 0)

  const updateData: Record<string, unknown> = {
    closing_summary: call.summary || '(no summary)',
    status_updated_at: new Date().toISOString(),
    total_price: totalPrice,
    status: details.wantsToGoAhead ? 'spec_sent' : 'hitl_ready',
  }
  if (details.domain) updateData.desired_domain = details.domain
  if (details.needsDomain) updateData.needs_domain = true
  if (details.needsEmail) updateData.needs_email_setup = true
  if (details.ctaType) updateData.cta_type = details.ctaType
  if (details.ctaValue) updateData.cta_value = details.ctaValue
  if (details.changes) updateData.requested_changes = details.changes

  // Payment link before the write so it can be stored atomically with the status change
  let paymentUrl: string | null = null
  if (details.wantsToGoAhead) {
    try {
      paymentUrl = await createCheckoutLink(leadId, lead.name, details.needsDomain)
      updateData.stripe_payment_link = paymentUrl
    } catch (err) {
      await agentLog('closer', `Stripe link failed: ${String(err)}`, { leadId, level: 'warn' })
    }
  }

  // Claim the transition. If another poller already did, stop here — no messages.
  const { data: updated } = await supabase
    .from('leads')
    .update(updateData)
    .eq('id', leadId)
    .eq('status', 'closing_call')
    .select('id')
    .single()

  if (!updated) return null

  await agentLog('closer', `Closing call complete for ${lead.name}: ${details.wantsToGoAhead ? 'GOING AHEAD' : 'not yet decided'}`, {
    leadId,
    level: 'success',
    metadata: { summary: call.summary, analysis: call.analysis, details }
  })

  if (!details.wantsToGoAhead) {
    await notify(
      `*Closing call complete: ${lead.name}*\n\n` +
      `Not a clear yes — marked hitl_ready for you to follow up.\n\n` +
      `${(call.summary || '').slice(0, 400)}`
    ).catch(() => {})
    return 'undecided'
  }

  // Send friendly summary + payment link to client via Twilio SMS/WhatsApp
  const spec = buildJobSpec({ ...lead, stripe_payment_link: paymentUrl }, details, totalPrice)
  if (lead.phone) {
    try {
      await sendClientMessage({ phone: lead.phone, message: spec, leadId })
      await agentLog('closer', `Job spec sent to client via Twilio`, { leadId, level: 'success' })
    } catch (err) {
      await agentLog('closer', `Failed to send spec via Twilio: ${String(err)}`, { leadId, level: 'warn' })
    }
  }

  const contactName = lead.contact_name || lead.name.split(' ')[0]
  await notify(
    `*Closing call complete: ${lead.name}*\n\n` +
    `${contactName} wants to go ahead!\n` +
    `Total: £${totalPrice}\n` +
    `Domain: ${details.domain || (details.needsDomain ? 'needs registration' : 'N/A')}\n` +
    `CTA: ${details.ctaType || 'N/A'} → ${details.ctaValue || 'N/A'}\n` +
    `Changes: ${details.changes || 'none'}\n\n` +
    `Job spec + payment link sent to client via SMS/WhatsApp.`
  ).catch(() => {})

  return 'going_ahead'
}

interface ClosingDetails {
  wantsToGoAhead: boolean
  domain: string | null
  needsDomain: boolean
  needsEmail: boolean
  ctaType: 'phone' | 'email_form' | null
  ctaValue: string | null
  changes: string | null
}

// Explicit commitment phrases only. Bare "yes", "perfect", "brilliant" are not
// enough: the customer says "yes" to "is that Sarah?" and the AI says "brilliant"
// in every call. Customer transcript and Bland's summary are checked separately.
const CUSTOMER_COMMITS = /\b(go ahead|let'?s do (it|that|this)|sign me up|sounds good|sounds great|i'?m in|we'?re in|happy to (go ahead|proceed|do that)|let'?s get (it |that )?(started|going|sorted)|yes,? (please|let'?s|go|do it)|count me in|get it (set up|sorted|live))\b/
const SUMMARY_COMMITS = /\b(agreed to (proceed|go ahead|buy|purchase|sign up)|wants? to (go ahead|proceed|move forward)|decided to (go ahead|proceed)|(is|are) going ahead|will (go ahead|proceed)|confirmed (that )?(they|he|she) (want|would like)|ready to (proceed|go ahead|pay)|happy to proceed)\b/
const HESITATIONS = /\b(not sure|maybe|think about|thinking about|not yet|not right now|no thanks|no thank you|not interested|can'?t afford|too expensive|call (me |us )?back|get back to (you|us)|speak to (my|the) (partner|wife|husband|boss|accountant)|decline|not ready|undecided|voicemail|did not answer|no answer)\b/

export function extractClosingDetails(
  transcripts: Array<{ user: string; text: string }>,
  summary: string,
  analysis?: Record<string, unknown> | null,
): ClosingDetails {
  const customerText = transcripts
    .filter(t => t.user !== 'assistant')
    .map(t => t.text)
    .join(' ')
    .toLowerCase()

  const summaryText = summary.toLowerCase()
  const allText = `${customerText} ${summaryText}`

  const a = analysis || {}
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : null)
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null)

  // Going ahead: structured answer wins; otherwise explicit commitment with no hesitation
  const structuredGoAhead = bool(a.wants_to_go_ahead)
  const wantsToGoAhead = structuredGoAhead !== null
    ? structuredGoAhead
    : (CUSTOMER_COMMITS.test(customerText) || SUMMARY_COMMITS.test(summaryText)) && !HESITATIONS.test(allText)

  // Domain detection
  const structuredDomain = str(a.domain_name)
  const domainMatch = customerText.match(/([a-z0-9-]+\.(co\.uk|com|org|net|uk))/i)
  const domain = structuredDomain && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(structuredDomain)
    ? structuredDomain.toLowerCase()
    : domainMatch ? domainMatch[0] : null
  const needsDomain = bool(a.needs_domain_registration)
    ?? (/don'?t have|no domain|need a domain|register|sort that out/.test(allText) && !domain)

  // Email setup
  const needsEmail = bool(a.needs_email_setup) ?? (needsDomain && /email|hello@|professional email/.test(allText))

  // CTA type
  let ctaType: 'phone' | 'email_form' | null = null
  const structuredCta = str(a.cta_type)?.toLowerCase()
  if (structuredCta === 'phone' || structuredCta === 'email_form') {
    ctaType = structuredCta
  } else {
    if (/phone|call|ring|tap to call/.test(allText)) ctaType = 'phone'
    if (/form|email|fill in|contact form/.test(allText)) ctaType = 'email_form'
  }

  // CTA value - look for phone numbers or emails
  let ctaValue: string | null = str(a.cta_value)
  if (!ctaValue) {
    const phoneMatch = customerText.match(/\+?[\d\s]{10,}/)
    const emailMatch = customerText.match(/[\w.-]+@[\w.-]+\.\w{2,}/)
    if (ctaType === 'phone' && phoneMatch) ctaValue = phoneMatch[0].trim()
    if (ctaType === 'email_form' && emailMatch) ctaValue = emailMatch[0]
  }

  // Changes
  let changes: string | null = str(a.requested_changes)
  if (!changes) {
    const changeIndicators = /change|update|different|replace|swap|modify|add|remove/
    if (changeIndicators.test(allText)) {
      // Extract the sentences around change requests from summary
      const summaryLines = summary.split('.')
      const changeLines = summaryLines.filter(l => changeIndicators.test(l.toLowerCase()))
      if (changeLines.length) changes = changeLines.join('. ').trim()
    }
  }

  return { wantsToGoAhead, domain, needsDomain, needsEmail, ctaType, ctaValue, changes }
}

export function buildJobSpec(lead: any, details: ClosingDetails, totalPrice: number): string {
  const firstName = lead.contact_name || lead.name.split(' ')[0]
  const domainLine = details.domain
    ? `We'll get your site set up on ${details.domain}.`
    : details.needsDomain
    ? `We'll register a domain for you and get it all connected.`
    : ''

  const emailLine = details.needsEmail
    ? `We'll also set up a professional email address for you (e.g. hello@yourdomain).`
    : ''

  const ctaLine = details.ctaType === 'phone'
    ? `Your customers will be able to tap a button to call you directly on ${details.ctaValue || 'your number'}.`
    : details.ctaType === 'email_form'
    ? `Your contact form will send enquiries straight to ${details.ctaValue || 'your email'}.`
    : ''

  const changesLine = details.changes
    ? `We've noted your changes: ${details.changes}`
    : `No changes needed — the site is good to go as-is!`

  const lines = [
    `Hey ${firstName}! Thanks so much for chatting with us today — here's a quick summary of everything we discussed.`,
    ``,
    `Your website: ${lead.vercel_deployment_url}`,
    ``,
    domainLine,
    emailLine,
    ctaLine,
    changesLine,
    ``,
    `Here's the cost breakdown:`,
    `  Website setup: £${pricing.setup}`,
    details.needsDomain ? `  Domain + email: £${pricing.domain}` : '',
    `  Ongoing hosting + changes: £${pricing.monthly}/month`,
    ``,
    `Total to get started: £${totalPrice}`,
    ``,
    `Once payment is sorted, we'll have everything live within 24 hours!`,
    ``,
    `Here's your payment link:`,
    lead.stripe_payment_link || '[Payment link will be added here]',
    ``,
    `Any questions at all, just reply to this message. Cheers!`,
    `— ${agency.callerName}, ${agency.name}`,
  ].filter(Boolean)

  return lines.join('\n')
}
