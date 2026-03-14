import twilio from 'twilio'
import { agentLog } from './logger'

function getClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const auth = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !auth) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set')
  return twilio(sid, auth)
}

function formatPhone(phone: string): string {
  let formatted = phone.replace(/\s/g, '')
  if (formatted.startsWith('0')) formatted = '+44' + formatted.slice(1)
  if (!formatted.startsWith('+')) formatted = '+44' + formatted
  return formatted
}

/**
 * Send a message to a prospective client via Twilio.
 * Tries WhatsApp first, falls back to SMS in 'auto' mode.
 */
export async function sendClientMessage(opts: {
  phone: string
  message: string
  leadId?: string
  channel?: 'whatsapp' | 'sms' | 'auto'
}): Promise<{ channel: 'whatsapp' | 'sms'; sid: string }> {
  const client = getClient()
  const phone = formatPhone(opts.phone)
  const channel = opts.channel || 'auto'

  // Try WhatsApp first if auto or whatsapp
  if (channel !== 'sms') {
    const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM
    if (whatsappFrom) {
      try {
        const result = await client.messages.create({
          from: `whatsapp:${whatsappFrom}`,
          to: `whatsapp:${phone}`,
          body: opts.message,
        })
        await agentLog('twilio', `WhatsApp sent to ${phone}: ${result.sid}`, {
          leadId: opts.leadId,
          level: 'success',
          metadata: { messageSid: result.sid, channel: 'whatsapp' },
        })
        return { channel: 'whatsapp', sid: result.sid }
      } catch (err: any) {
        if (channel === 'whatsapp') throw err
        // Auto mode: fall through to SMS
        await agentLog('twilio', `WhatsApp failed, falling back to SMS: ${err.message}`, {
          leadId: opts.leadId,
          level: 'warn',
        })
      }
    }
  }

  // SMS fallback
  const smsFrom = process.env.TWILIO_SMS_FROM
  if (!smsFrom) throw new Error('TWILIO_SMS_FROM must be set for SMS delivery')

  const result = await client.messages.create({
    from: smsFrom,
    to: phone,
    body: opts.message,
  })

  await agentLog('twilio', `SMS sent to ${phone}: ${result.sid}`, {
    leadId: opts.leadId,
    level: 'success',
    metadata: { messageSid: result.sid, channel: 'sms' },
  })

  return { channel: 'sms', sid: result.sid }
}
