import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { startCall, getCall, isCallFinished, isCallFailed } from '../lib/bland'
import { agency, getCallPhone } from '../lib/config'

export type CallOutcome = 'interested' | 'not_interested' | 'voicemail' | 'no_answer'

const OUTCOMES: CallOutcome[] = ['interested', 'not_interested', 'voicemail', 'no_answer']

/** Structured fields we ask Bland to extract after the call (see lib/bland.ts). */
const CALL_ANALYSIS_SCHEMA = {
  outcome: 'One of: interested, not_interested, voicemail, no_answer. "interested" only if the person wanted the link or a follow-up.',
  contact_name: 'First name of the person spoken to, or null',
  email: 'Email address they gave, or null',
}

/** A call that has not completed after this long is treated as unanswered. */
export const CALL_TIMEOUT_MS = 30 * 60 * 1000

export async function runCallerAgent(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.phone) {
    await agentLog('caller', `No phone for ${lead?.name}, skipping`, { leadId })
    return
  }

  await agentLog('caller', `Initiating call to: ${lead.name} (${lead.phone})`, { leadId })

  const phone = getCallPhone(lead.phone)
  const hasEmail = !!lead.email
  const calendly = process.env.CALENDLY_LINK || 'a booking link we will text over'

  const task = `You are ${agency.callerName}, a friendly business development rep at ${agency.name}, a web design studio that helps local businesses get online. You're making a warm introductory call. Be natural, conversational, and human -- NOT robotic or salesy. Use a warm British tone.

IMPORTANT: Take your time. Don't rush. Pause between points. Let them respond. This should feel like a genuine conversation, not a sales pitch.

Here's how the call should flow:

1. WARM GREETING: "Hi there! Am I speaking with someone from ${lead.name}? ... Lovely! And what's your name? ... [REMEMBER THEIR NAME AND USE IT THROUGHOUT THE REST OF THE CALL] ... Nice to meet you [NAME]! My name's ${agency.callerName}, I'm calling from a company called ${agency.name} -- we're a small web design studio based in London."

2. CONTEXT & REASON FOR CALLING: "The reason I'm reaching out is -- we actually specialise in helping local ${lead.category} businesses get set up online. We came across ${lead.name} and noticed you don't seem to have a website at the moment, so we actually went ahead and put something together for you. Completely free, no strings attached."

3. EXPLAIN WHAT YOU DID: "It's a fully designed, professional website -- it's got your business details, your services, contact info, the works. We've already got it live on a temporary link so you can have a look."

4. OFFER TO SEND THE LINK:
${hasEmail
  ? `"We've actually already sent the link over by email -- it would have come from ${agency.email}. If you haven't seen it, do check your junk folder. But I'll also text it to you on this number so you've got it handy."`
  : `"What I'd love to do is send you the link so you can have a look for yourself. I'll pop it over as a text message to this number right after the call -- just a link to the site, nothing spammy, I promise."`
}

5. GAUGE INTEREST (listen and respond naturally):
   - If they're happy with a text: "Brilliant, I'll send that over to you right after this call. Have a look when you get a chance -- I think you'll really like it."
   - If they give a different number or email: "Perfect, let me take that down..." (repeat it back to confirm)
   - If interested in a follow-up: "That's great to hear! What we could do is jump on a quick 30-minute call where I walk you through everything and we can chat about getting it set up with your own domain name. I'll include a booking link in the text -- would that work for you?"
   - If unsure: "No pressure at all. I'll send the link over and you can have a look in your own time. If you like what you see, just text us back."
   - If not interested: "Completely understand, no worries at all. The website will stay live for a little while if you change your mind. Have a wonderful day!"

6. WRAP UP (if they're interested): "Lovely, so I'll text you the link to your new website and a booking link if you'd like to chat further. It was really nice speaking with you -- have a great day!"

7. IF VOICEMAIL: "Hi there, this is ${agency.callerName} calling from ${agency.name}, a web design studio in London. I'm reaching out to ${lead.name} because we've actually gone ahead and built you a professional website -- completely free, no strings attached. I'll send you a text with the link so you can have a look. If you'd like to chat, feel free to give us a ring back. Have a great day!"

Business context (use naturally in conversation, don't read out verbatim):
- Business name: ${lead.name}
- Business type: ${lead.category}
- Location: ${lead.address}
- The website we built: ${lead.vercel_deployment_url}
- Booking link: ${calendly}
${lead.google_rating ? `- Their Google rating: ${lead.google_rating}/5 (${lead.google_review_count} reviews) -- you can compliment them on this` : ''}

Style notes:
- Be genuinely warm and enthusiastic, not scripted
- Use natural filler words occasionally ("actually", "basically", "to be honest")
- If they ask questions, answer naturally -- you know about web design, domains, hosting
- Don't oversell. The website speaks for itself.
- If they give you an email address or a different phone number, repeat it back to confirm
- Aim for about 90 seconds if they're chatty, 30 seconds if they want it quick

CRITICAL RULES:
- NEVER end the call early. Do NOT say "goodbye" or "have a wonderful day" until you have completed the full conversation flow above.
- If you hear background noise, an answering machine, or something unexpected, WAIT and try your greeting again. Do NOT hang up.
- If someone says something confusing or off-topic, politely steer back: "Sorry, I didn't quite catch that -- I was just calling about a website we built for ${lead.name}."
- Only end the call after you've delivered your message and said goodbye properly.
- If it goes to voicemail, leave the full voicemail message from step 7 above.`

  const callId = await startCall({
    phone_number: phone,
    task,
    max_duration: 5,
    wait_for_greeting: false,
    interruption_threshold: 200,
    voicemail_action: 'leave_message',
    analysis_schema: CALL_ANALYSIS_SCHEMA,
    metadata: { lead_id: leadId },
  })

  await supabase
    .from('leads')
    .update({
      bland_call_id: callId,
      call_initiated_at: new Date().toISOString(),
      call_completed_at: null,
      call_outcome: null,
      status: 'called',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('caller', `Call initiated: ${callId}`, { leadId, level: 'success' })
}

/**
 * Check whether the lead's intro call has finished and, if so, record the
 * outcome and move the lead on. Called by the crons every 30s for every lead
 * with an in-flight call (there is no Bland webhook in a self-hosted setup).
 *
 * Returns the outcome when this call recorded it, otherwise null.
 */
export async function pollBlandCall(leadId: string): Promise<CallOutcome | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('bland_call_id, name, status, call_initiated_at, call_completed_at, pipeline_run_id')
    .eq('id', leadId)
    .single()

  if (!lead?.bland_call_id) return null
  if (lead.call_completed_at) return null // Already recorded
  if (!process.env.BLAND_AI_API_KEY) return null

  const call = await getCall(lead.bland_call_id)

  const startedAt = lead.call_initiated_at ? new Date(lead.call_initiated_at).getTime() : Date.now()
  const timedOut = Date.now() - startedAt > CALL_TIMEOUT_MS

  if (!isCallFinished(call) && !isCallFailed(call) && !timedOut) return null

  const outcome: CallOutcome = isCallFinished(call)
    ? inferOutcome(call.summary || '', call.analysis)
    : 'no_answer'

  // Try to extract any email or alternate number they gave during the call
  const contactInfo = extractContactInfo(call.transcripts || [], call.analysis)

  const updateData: Record<string, unknown> = {
    call_completed_at: new Date().toISOString(),
    call_outcome: outcome,
    status: outcome === 'interested' ? 'hitl_ready' : 'called',
    status_updated_at: new Date().toISOString()
  }
  if (contactInfo.email) updateData.email = contactInfo.email
  if (contactInfo.contactName) updateData.contact_name = contactInfo.contactName

  // Only the poller that observes call_completed_at unset gets to record it
  const { data: updated } = await supabase
    .from('leads')
    .update(updateData)
    .eq('id', leadId)
    .is('call_completed_at', null)
    .select('id')
    .single()

  if (!updated) return null

  await agentLog('caller', `Call outcome for ${lead.name}: ${outcome}${contactInfo.email ? ` (captured email: ${contactInfo.email})` : ''}${timedOut && !isCallFinished(call) ? ' (timed out waiting for Bland)' : ''}`, {
    leadId,
    level: outcome === 'interested' ? 'success' : 'info',
    metadata: { summary: call.summary, analysis: call.analysis, contactInfo, blandStatus: call.status }
  })

  const { notify } = await import('../lib/telegram')
  const calendly = process.env.CALENDLY_LINK || ''
  await notify(
    `Call complete: ${lead.name}\n` +
    `Outcome: ${outcome}\n\n` +
    `${call.summary ? `${call.summary.slice(0, 400)}\n\n` : ''}` +
    `${calendly}`
  ).catch(() => {})

  // Follow-up (text with site link + booking link, then a second call) makes
  // sense for anyone we did not clearly lose. Not-interested leads are left alone.
  if (outcome !== 'not_interested') {
    const { enqueue } = await import('../lib/queue')
    await enqueue({
      leadId,
      queueName: 'followup',
      pipelineRunId: lead.pipeline_run_id || undefined,
    })
    await agentLog('caller', `"${lead.name}" → queued for followup`, { leadId })
  }

  return outcome
}

const NOT_INTERESTED = /\b(not interested|no thank|no thanks|don'?t need|do not need|not (for|looking)|already (have|has|got) (a |an )?(website|site|web ?page)|declined|not right now|no,? (i'?m|we'?re) (fine|good|ok)|stop calling|remove (me|us))\b/
const VOICEMAIL = /\b(voicemail|voice mail|answering machine|answer ?phone|left (a |the )?message)\b/
const NO_ANSWER = /\b(no answer|didn'?t answer|did not answer|not answered|unanswered|no one (picked|answered)|nobody (picked|answered)|rang out|hung up (immediately|straight away|right away)|call (dropped|failed)|wrong number)\b/
const INTERESTED = /\b(interested|keen|love[sd]? it|loved|sounds (good|great)|happy (to|for)|book(ed|ing)?|send (me |it |that |the )|text (me|it|that)|whatsapp|go ahead|follow[- ]?up|call back|callback|yes)\b/

/**
 * Classify the intro call. Prefers Bland's structured `analysis.outcome`;
 * otherwise scans the summary, checking negative outcomes before positive ones
 * so "not interested" can never read as "interested".
 */
export function inferOutcome(summary: string, analysis?: Record<string, unknown> | null): CallOutcome {
  const structured = typeof analysis?.outcome === 'string' ? analysis.outcome.toLowerCase().trim() : null
  if (structured && (OUTCOMES as string[]).includes(structured)) return structured as CallOutcome

  const s = summary.toLowerCase()
  if (!s.trim()) return 'no_answer'
  if (NOT_INTERESTED.test(s)) return 'not_interested'
  if (VOICEMAIL.test(s)) return 'voicemail'
  if (NO_ANSWER.test(s)) return 'no_answer'
  if (INTERESTED.test(s)) return 'interested'
  return 'no_answer'
}

/** Extract contact name and email from Bland's analysis, falling back to the transcript */
export function extractContactInfo(
  transcripts: Array<{ user: string; text: string }>,
  analysis?: Record<string, unknown> | null,
): { email?: string; altPhone?: string; contactName?: string } {
  const result: { email?: string; altPhone?: string; contactName?: string } = {}

  if (typeof analysis?.email === 'string' && /[\w.-]+@[\w.-]+\.\w{2,}/.test(analysis.email)) {
    result.email = analysis.email.toLowerCase().trim()
  }
  if (typeof analysis?.contact_name === 'string' && /^[A-Za-z][A-Za-z'-]{1,30}$/.test(analysis.contact_name.trim())) {
    result.contactName = analysis.contact_name.trim()
  }

  const fullText = transcripts
    .filter(t => t.user !== 'assistant')
    .map(t => t.text)
    .join(' ')

  // Look for email pattern
  if (!result.email) {
    const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w{2,}/)
    if (emailMatch) result.email = emailMatch[0].toLowerCase()
  }

  if (!result.contactName) {
    // Extract contact name — look for the AI repeating back the name after asking
    const aiText = transcripts
      .filter(t => t.user === 'assistant')
      .map(t => t.text)
      .join(' ')

    // Pattern: "Nice to meet you [Name]" or "lovely to meet you [Name]"
    const nameMatch = aiText.match(/(?:nice|lovely|great|good) to (?:meet|speak with|chat with) you[,!]?\s+([A-Z][a-z]+)/i)
    if (nameMatch) result.contactName = nameMatch[1]

    // Fallback: "Thanks [Name]" or "Cheers [Name]" near end of call
    if (!result.contactName) {
      const thanksMatch = aiText.match(/(?:thanks|cheers|thank you)\s+(?:so much\s+)?([A-Z][a-z]+)[,!]/i)
      if (thanksMatch) result.contactName = thanksMatch[1]
    }
  }

  return result
}
