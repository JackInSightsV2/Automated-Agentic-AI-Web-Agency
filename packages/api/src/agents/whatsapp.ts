import twilio from 'twilio'
import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !auth) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set')
  return twilio(sid, auth)
}

export async function sendWhatsApp(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.phone) {
    await agentLog('whatsapp', `No phone for ${lead?.name}, skipping`, { leadId })
    return
  }

  if (!lead?.vercel_deployment_url) {
    await agentLog('whatsapp', `No deployment URL for ${lead.name}, skipping`, { leadId })
    return
  }

  // Format number for Twilio WhatsApp: needs +44 format
  let phone = lead.phone.replace(/\s/g, '')
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1)
  if (!phone.startsWith('+')) phone = '+44' + phone

  const from = process.env.TWILIO_WHATSAPP_FROM
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM must be set (e.g. +14155238886 for sandbox)')

  await agentLog('whatsapp', `Sending WhatsApp to ${lead.name} (${phone})`, { leadId })

  const client = getClient()

  const calendlyLink = process.env.CALENDLY_LINK

  const message = `Hi there! 👋 This is ${process.env.AGENCY_CALLER_NAME || 'Alex'} from ${process.env.AGENCY_NAME || 'Web Agency'}.

As promised on the call, here's the website we built for *${lead.name}*:

🌐 ${lead.vercel_deployment_url}

Have a look and let us know what you think! If you'd like to get it set up with your own domain, we can jump on a quick call:

📅 ${calendlyLink}

No pressure at all — the site is yours to look at. Have a great day!`

  try {
    const result = await client.messages.create({
      from: `whatsapp:${from}`,
      to: `whatsapp:${phone}`,
      body: message
    })

    await agentLog('whatsapp', `WhatsApp sent to ${lead.name}: ${result.sid}`, {
      leadId,
      level: 'success',
      metadata: { messageSid: result.sid, status: result.status }
    })
  } catch (err: any) {
    await agentLog('whatsapp', `WhatsApp failed for ${lead.name}: ${err.message}`, {
      leadId,
      level: 'error',
      metadata: { error: err.message, code: err.code }
    })
    throw err
  }
}
