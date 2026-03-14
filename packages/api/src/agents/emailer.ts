import { Resend } from 'resend'
import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function runEmailerAgent(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.vercel_deployment_url) throw new Error('No deployment URL for lead')
  if (!lead?.email) {
    await agentLog('emailer', `No email for ${lead.name}, skipping`, { leadId })
    return
  }

  await agentLog('emailer', `Sending email to: ${lead.email}`, { leadId })

  const siteUrl = lead.vercel_deployment_url
  const calendlyLink = process.env.CALENDLY_LINK
  const apiUrl = process.env.API_URL

  // Only use tracking URLs if API is publicly accessible (not localhost)
  const isPublicApi = apiUrl && !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1')
  const clickUrl = isPublicApi
    ? `${apiUrl}/pipeline/track/click/${leadId}?redirect=${encodeURIComponent(siteUrl)}`
    : siteUrl
  const trackingPixel = isPublicApi
    ? `<img src="${apiUrl}/pipeline/track/open/${leadId}" width="1" height="1" style="display:none;" />`
    : ''

  const { error } = await resend.emails.send({
    from: `${process.env.OUTREACH_FROM_NAME} <${process.env.OUTREACH_FROM_EMAIL}>`,
    to: lead.email,
    subject: `We built a free website for ${lead.name}`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
        <h2 style="color: #1a1a2e;">Hi ${lead.name} team</h2>

        <p>We noticed <strong>${lead.name}</strong> doesn't have a website yet -- so we built you one. For free.</p>

        <p>No strings attached. We just want to show you what's possible.</p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${clickUrl}"
             style="background: #6c63ff; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold;">
            See Your Free Website
          </a>
        </div>

        <p>The site includes:</p>
        <ul>
          <li>Professional design for a ${lead.category}</li>
          <li>Mobile-friendly</li>
          <li>Your phone number and address</li>
          <li>Ready to go live with your own domain</li>
        </ul>

        <p>If you love it and want to own it, we can set it up with your own domain (like <strong>www.${lead.name.toLowerCase().replace(/\s/g, '')}${process.env.DEFAULT_TLD || '.co.uk'}</strong>) for a small one-time fee.</p>

        ${calendlyLink && !calendlyLink.includes('your-link')
          ? `<p>Want to chat? Book a 15-minute call: <a href="${calendlyLink}">${calendlyLink}</a></p>`
          : `<p>Want to chat? Simply reply to this email and we'll arrange a quick call.</p>`
        }

        <p style="color: #888; font-size: 14px; margin-top: 40px;">
          You're receiving this because we discovered ${lead.name} on Google Maps.<br>
          We respect your time -- reply STOP to never hear from us again.
        </p>

        ${trackingPixel}
      </body>
      </html>
    `
  })

  if (error) throw new Error(`Email failed: ${JSON.stringify(error)}`)

  await supabase
    .from('leads')
    .update({ email_sent_at: new Date().toISOString(), status: 'emailed', status_updated_at: new Date().toISOString() })
    .eq('id', leadId)

  await agentLog('emailer', `Email sent to ${lead.email}`, { leadId, level: 'success' })
}
