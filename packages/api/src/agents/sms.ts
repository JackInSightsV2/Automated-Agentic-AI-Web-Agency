import twilio from 'twilio'
import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !auth) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set')
  return twilio(sid, auth)
}

export async function sendSMS(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.phone) {
    await agentLog('sms', `No phone for ${lead?.name}, skipping`, { leadId })
    return
  }

  if (!lead?.vercel_deployment_url) {
    await agentLog('sms', `No deployment URL for ${lead.name}, skipping`, { leadId })
    return
  }

  const from = process.env.TWILIO_SMS_FROM
  if (!from) throw new Error('TWILIO_SMS_FROM must be set in .env')

  // Format number for Twilio: needs +44 format
  let phone = lead.phone.replace(/\s/g, '')
  if (phone.startsWith('0')) phone = '+44' + phone.slice(1)
  if (!phone.startsWith('+')) phone = '+44' + phone

  await agentLog('sms', `Sending SMS to ${lead.name} (${phone})`, { leadId })

  const calendlyLink = process.env.CALENDLY_LINK
  const message = `Hi from ${process.env.AGENCY_NAME || 'Web Agency'}! As promised, here's the free website we built for ${lead.name}: ${lead.vercel_deployment_url}\n\nLove it? Book a quick call to get it on your own domain: ${calendlyLink}\n\nNo pressure — it's yours to look at!`

  const client = getClient()

  try {
    const result = await client.messages.create({
      from,
      to: phone,
      body: message
    })

    await agentLog('sms', `SMS sent to ${lead.name}: ${result.sid}`, {
      leadId,
      level: 'success',
      metadata: { messageSid: result.sid, status: result.status }
    })
  } catch (err: any) {
    await agentLog('sms', `SMS failed for ${lead.name}: ${err.message}`, {
      leadId,
      level: 'error',
      metadata: { error: err.message, code: err.code }
    })
    throw err
  }
}
