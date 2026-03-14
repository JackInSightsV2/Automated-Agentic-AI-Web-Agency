import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

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

  // HACKATHON: always call the demo number
  const phone = process.env.AGENCY_PHONE || lead.phone

  const hasEmail = !!lead.email

  const task = `You are ${process.env.AGENCY_CALLER_NAME || 'Alex'}, a friendly business development rep at ${process.env.AGENCY_NAME || 'Web Agency'}, a web design studio that helps local businesses get online. You're making a warm introductory call. Be natural, conversational, and human -- NOT robotic or salesy. Use a warm British tone.

IMPORTANT: Take your time. Don't rush. Pause between points. Let them respond. This should feel like a genuine conversation, not a sales pitch.

Here's how the call should flow:

1. WARM GREETING: "Hi there! Am I speaking with someone from ${lead.name}? ... Lovely! And what's your name? ... [REMEMBER THEIR NAME AND USE IT THROUGHOUT THE REST OF THE CALL] ... Nice to meet you [NAME]! My name's ${process.env.AGENCY_CALLER_NAME || 'Alex'}, I'm calling from a company called ${process.env.AGENCY_NAME || 'Web Agency'} -- we're a small web design studio based in London."

2. CONTEXT & REASON FOR CALLING: "The reason I'm reaching out is -- we actually specialise in helping local ${lead.category} businesses get set up online. We came across ${lead.name} and noticed you don't seem to have a website at the moment, so we actually went ahead and put something together for you. Completely free, no strings attached."

3. EXPLAIN WHAT YOU DID: "It's a fully designed, professional website -- it's got your business details, your services, contact info, the works. We've already got it live on a temporary link so you can have a look."

4. OFFER TO SEND THE LINK:
${hasEmail
  ? `"We've actually already sent the link over by email -- it would have come from ${process.env.AGENCY_EMAIL || 'hello@example.com'}. If you haven't seen it, do check your junk folder. But I'll also text it to you on this number so you've got it handy."`
  : `"What I'd love to do is send you the link so you can have a look for yourself. I'll pop it over as a text message to this number right after the call -- just a link to the site, nothing spammy, I promise."`
}

5. GAUGE INTEREST (listen and respond naturally):
   - If they're happy with a text: "Brilliant, I'll send that over to you right after this call. Have a look when you get a chance -- I think you'll really like it."
   - If they give a different number or email: "Perfect, let me take that down..." (repeat it back to confirm)
   - If interested in a follow-up: "That's great to hear! What we could do is jump on a quick 30-minute call where I walk you through everything and we can chat about getting it set up with your own domain name. I'll include a booking link in the text -- would that work for you?"
   - If unsure: "No pressure at all. I'll send the link over and you can have a look in your own time. If you like what you see, just text us back."
   - If not interested: "Completely understand, no worries at all. The website will stay live for a little while if you change your mind. Have a wonderful day!"

6. WRAP UP (if they're interested): "Lovely, so I'll text you the link to your new website and a booking link if you'd like to chat further. It was really nice speaking with you -- have a great day!"

7. IF VOICEMAIL: "Hi there, this is ${process.env.AGENCY_CALLER_NAME || 'Alex'} calling from ${process.env.AGENCY_NAME || 'Web Agency'}, a web design studio in London. I'm reaching out to ${lead.name} because we've actually gone ahead and built you a professional website -- completely free, no strings attached. I'll send you a text with the link so you can have a look. If you'd like to chat, feel free to give us a ring back. Have a great day!"

Business context (use naturally in conversation, don't read out verbatim):
- Business name: ${lead.name}
- Business type: ${lead.category}
- Location: ${lead.address}
- The website we built: ${lead.vercel_deployment_url}
- Booking link: ${process.env.CALENDLY_LINK}
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
      max_duration: 5,
      wait_for_greeting: false,
      record: true,
      interruption_threshold: 200,
      voicemail_action: 'leave_message',
      noise_cancellation: true,
      metadata: { lead_id: leadId }
    })
  })

  const data = await res.json() as { call_id?: string }

  if (!data.call_id) throw new Error(`Bland call failed: ${JSON.stringify(data)}`)

  await supabase
    .from('leads')
    .update({
      bland_call_id: data.call_id,
      call_initiated_at: new Date().toISOString(),
      status: 'called',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('caller', `Call initiated: ${data.call_id}`, { leadId, level: 'success' })
}

export async function pollBlandCall(leadId: string): Promise<string | null> {
  const { data: lead } = await supabase
    .from('leads')
    .select('bland_call_id, name')
    .eq('id', leadId)
    .single()

  if (!lead?.bland_call_id) return null

  const res = await fetch(`https://api.bland.ai/v1/calls/${lead.bland_call_id}`, {
    headers: { Authorization: process.env.BLAND_AI_API_KEY! }
  })
  const call = await res.json() as { status?: string; summary?: string; transcripts?: Array<{ user: string; text: string }> }

  if (call.status === 'completed') {
    const outcome = inferOutcome(call.summary || '')

    // Try to extract any email or alternate number they gave during the call
    const contactInfo = extractContactInfo(call.transcripts || [])

    const updateData: Record<string, unknown> = {
      call_completed_at: new Date().toISOString(),
      call_outcome: outcome,
      status: outcome === 'interested' ? 'hitl_ready' : 'called',
      status_updated_at: new Date().toISOString()
    }

    // Save any contact info captured during the call
    if (contactInfo.email) updateData.email = contactInfo.email
    if (contactInfo.contactName) updateData.contact_name = contactInfo.contactName

    await supabase.from('leads').update(updateData).eq('id', leadId)

    await agentLog('caller', `Call outcome for ${lead.name}: ${outcome}${contactInfo.email ? ` (captured email: ${contactInfo.email})` : ''}`, {
      leadId,
      level: 'success',
      metadata: { summary: call.summary, contactInfo }
    })

    return outcome
  }

  return null
}

function inferOutcome(summary: string): string {
  const s = summary.toLowerCase()
  if (s.includes('interested') || s.includes('yes') || s.includes('love') || s.includes('book') || s.includes('whatsapp') || s.includes('send')) return 'interested'
  if (s.includes('voicemail') || s.includes('left message')) return 'voicemail'
  if (s.includes('not interested') || s.includes('no thank')) return 'not_interested'
  return 'no_answer'
}

/** Extract contact name, email, or phone from the call transcript */
function extractContactInfo(transcripts: Array<{ user: string; text: string }>): { email?: string; altPhone?: string; contactName?: string } {
  const result: { email?: string; altPhone?: string; contactName?: string } = {}

  const fullText = transcripts
    .filter(t => t.user !== 'assistant')
    .map(t => t.text)
    .join(' ')

  // Look for email pattern
  const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w{2,}/)
  if (emailMatch) result.email = emailMatch[0].toLowerCase()

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

  return result
}
