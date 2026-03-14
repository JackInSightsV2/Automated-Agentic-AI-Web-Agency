import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'
import { createCheckoutLink } from '../lib/stripe'

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

  // HACKATHON: always call the demo number
  const phone = process.env.AGENCY_PHONE || lead.phone

  const contactName = lead.contact_name
  const greeting = contactName
    ? `"Hi there! Is that ${contactName}? ... Brilliant! It's ${process.env.AGENCY_CALLER_NAME || 'Alex'} here from ${process.env.AGENCY_NAME || 'Web Agency'} — thanks so much for booking a chat with us! How are you doing today?"`
    : `"Hi there! Am I speaking with someone from ${lead.name}? ... Lovely! And what's your name? ... [REMEMBER THEIR NAME AND USE IT FOR THE REST OF THE CALL] ... Nice to meet you! It's ${process.env.AGENCY_CALLER_NAME || 'Alex'} here from ${process.env.AGENCY_NAME || 'Web Agency'} — thanks so much for booking a chat with us! How are you doing today?"`

  await agentLog('closer', `Initiating closing call to: ${lead.name}${contactName ? ` (${contactName})` : ''} (${phone})`, { leadId })

  const task = `You are ${process.env.AGENCY_CALLER_NAME || 'Alex'} from ${process.env.AGENCY_NAME || 'Web Agency'}, a web design studio in London. You're making a follow-up call to ${lead.name}${contactName ? ` — you spoke to ${contactName} last time` : ''} who booked a call after seeing the website you built for them. Be warm, friendly, and professional — like chatting with a neighbour who's interested in your services.

IMPORTANT: This is a consultative conversation, not a sales pitch. Take your time. Listen. Let them talk. Ask follow-up questions naturally.${contactName ? ` You already know their name is ${contactName} — use it naturally throughout the call.` : ''}

Here's how the call should flow:

1. WARM OPENER:
${greeting}

2. REFERENCE THE WEBSITE:
"So, you had a chance to look at the website we put together for you — what did you think? ... [Listen and respond naturally. If they loved it, be enthusiastic. If they have concerns, acknowledge them.]"

3. EXPLAIN THE OFFER (naturally, not scripted):
"So here's how it works — it's really simple. To get the site live on your own domain, it's just £35 as a one-off setup fee, and then £5 a month which covers hosting and any small changes you need. So if you want to update your phone number, change some text, add a photo — that's all included."

4. DOMAIN NAME — ask this naturally:
"Now, do you already have a domain name for your business? Like a .co.uk or .com? ...
   - If YES: "Perfect, what is it?" [Repeat back to confirm] "Lovely, we'll get the site set up on that."
   - If NO: "No worries at all! We can sort that out for you. Something like ${lead.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.co.uk might work nicely — or we can come up with a few options. There's an extra £25 for domain registration and setting up a professional email address for you — so you'd get something like hello@yourdomain.co.uk. Would you like us to sort that?"

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
"Hi there, it's ${process.env.AGENCY_CALLER_NAME || 'Alex'} from ${process.env.AGENCY_NAME || 'Web Agency'}! We had a call booked to chat about the website we built for ${lead.name}. No worries — I'll drop you a message with all the details. If you'd like to rebook, there's a link in there too. Have a lovely day!"

INFORMATION YOU MUST COLLECT (ask naturally, don't interrogate):
- Do they want to go ahead? (yes/no/thinking about it)
- Domain name: do they have one, or need us to register one?
- CTA preference: phone number or email contact form?
- CTA value: the phone number or email address
- Any changes they want to the website
- Email setup: do they want a professional email? (only if they need a domain)

Business context:
- Business name: ${lead.name}
- Category: ${lead.category}
- Website we built: ${lead.vercel_deployment_url}
- Pricing: £35 setup + £5/month
- Domain + email setup: extra £25
- Booking link: ${process.env.CALENDLY_LINK}
${lead.google_rating ? `- Their Google rating: ${lead.google_rating}/5 (${lead.google_review_count} reviews)` : ''}

Style notes:
- Warm British conversational tone
- Use natural filler words: "lovely", "brilliant", "perfect", "no worries"
- Don't rush — pause between sections
- If they're unsure, don't push: "Take your time, no pressure at all"
- Repeat back important details (domain names, phone numbers, emails)
- Aim for 3-5 minutes`

  const res = await fetch('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: {
      Authorization: process.env.BLAND_AI_API_KEY!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      phone_number: phone,
      task,
      voice: 'nat',
      language: 'en-GB',
      max_duration: 8,
      wait_for_greeting: true,
      record: true,
      interruption_threshold: 500,
      metadata: { lead_id: leadId, call_type: 'closing' }
    })
  })

  const data = await res.json() as { call_id?: string }

  if (!data.call_id) throw new Error(`Bland closing call failed: ${JSON.stringify(data)}`)

  await supabase
    .from('leads')
    .update({
      closing_call_id: data.call_id,
      closing_call_at: new Date().toISOString(),
      status: 'closing_call',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('closer', `Closing call initiated: ${data.call_id}`, { leadId, level: 'success' })
}

export async function pollClosingCall(leadId: string): Promise<string | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('closing_call_id, name, vercel_deployment_url, phone, email')
    .eq('id', leadId)
    .single()

  if (!lead?.closing_call_id) return null

  const res = await fetch(`https://api.bland.ai/v1/calls/${lead.closing_call_id}`, {
    headers: { Authorization: process.env.BLAND_AI_API_KEY! }
  })
  const call = await res.json() as {
    status?: string
    summary?: string
    transcripts?: Array<{ user: string; text: string }>
  }

  if (call.status === 'completed') {
    const details = extractClosingDetails(call.transcripts || [], call.summary || '')

    const totalPrice = 35 + (details.needsDomain ? 25 : 0)

    const updateData: Record<string, unknown> = {
      closing_summary: call.summary,
      status_updated_at: new Date().toISOString(),
      total_price: totalPrice
    }

    if (details.domain) updateData.desired_domain = details.domain
    if (details.needsDomain) updateData.needs_domain = true
    if (details.needsEmail) updateData.needs_email_setup = true
    if (details.ctaType) updateData.cta_type = details.ctaType
    if (details.ctaValue) updateData.cta_value = details.ctaValue
    if (details.changes) updateData.requested_changes = details.changes

    if (details.wantsToGoAhead) {
      updateData.status = 'spec_sent'

      // Generate Stripe payment link
      try {
        const paymentUrl = await createCheckoutLink(leadId, lead.name, details.needsDomain)
        updateData.stripe_payment_link = paymentUrl
        lead.stripe_payment_link = paymentUrl
      } catch (err) {
        await agentLog('closer', `Stripe link failed: ${String(err)}`, { leadId, level: 'warn' })
      }

      // Send friendly summary + payment link via Telegram
      const spec = buildJobSpec(lead, details, totalPrice)
      await notify(spec)
    } else {
      updateData.status = 'hitl_ready'
    }

    await supabase.from('leads').update(updateData).eq('id', leadId)

    await agentLog('closer', `Closing call complete for ${lead.name}: ${details.wantsToGoAhead ? 'GOING AHEAD' : 'not yet decided'}`, {
      leadId,
      level: 'success',
      metadata: { summary: call.summary, details }
    })

    return details.wantsToGoAhead ? 'going_ahead' : 'undecided'
  }

  return null
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

function extractClosingDetails(transcripts: Array<{ user: string; text: string }>, summary: string): ClosingDetails {
  const fullText = transcripts
    .filter(t => t.user !== 'assistant')
    .map(t => t.text)
    .join(' ')
    .toLowerCase()

  const allText = (fullText + ' ' + summary).toLowerCase()

  // Check if going ahead
  const wantsToGoAhead = /yes|go ahead|let'?s do it|sounds good|sign me up|perfect|brilliant/.test(allText) &&
    !/not sure|maybe|think about|not yet|no thanks/.test(allText)

  // Domain detection
  const domainMatch = fullText.match(/([a-z0-9-]+\.(co\.uk|com|org|net|uk))/i)
  const domain = domainMatch ? domainMatch[0] : null
  const needsDomain = /don'?t have|no domain|need a domain|register|sort that out/.test(allText) && !domain

  // Email setup
  const needsEmail = needsDomain && /email|hello@|professional email/.test(allText)

  // CTA type
  let ctaType: 'phone' | 'email_form' | null = null
  if (/phone|call|ring|tap to call/.test(allText)) ctaType = 'phone'
  if (/form|email|fill in|contact form/.test(allText)) ctaType = 'email_form'

  // CTA value - look for phone numbers or emails
  let ctaValue: string | null = null
  const phoneMatch = fullText.match(/\+?[\d\s]{10,}/)
  const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w{2,}/)
  if (ctaType === 'phone' && phoneMatch) ctaValue = phoneMatch[0].trim()
  if (ctaType === 'email_form' && emailMatch) ctaValue = emailMatch[0]

  // Changes
  const changeIndicators = /change|update|different|replace|swap|modify|add|remove/
  let changes: string | null = null
  if (changeIndicators.test(allText)) {
    // Extract the sentences around change requests from summary
    const summaryLines = summary.split('.')
    const changeLines = summaryLines.filter(l => changeIndicators.test(l.toLowerCase()))
    if (changeLines.length) changes = changeLines.join('. ').trim()
  }

  return { wantsToGoAhead, domain, needsDomain, needsEmail, ctaType, ctaValue, changes }
}

function buildJobSpec(lead: any, details: ClosingDetails, totalPrice: number): string {
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
    `  Website setup: £35`,
    details.needsDomain ? `  Domain + email: £25` : '',
    `  Ongoing hosting + changes: £5/month`,
    ``,
    `Total to get started: £${totalPrice}`,
    ``,
    `Once payment is sorted, we'll have everything live within 24 hours!`,
    ``,
    `Here's your payment link:`,
    lead.stripe_payment_link || '[Payment link will be added here]',
    ``,
    `Any questions at all, just reply to this message. Cheers!`,
    `— ${process.env.AGENCY_CALLER_NAME || 'Alex'}, ${process.env.AGENCY_NAME || 'Web Agency'}`,
  ].filter(Boolean)

  return lines.join('\n')
}
