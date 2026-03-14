import { supabase } from '../lib/supabase'

const LEAD_ID = '66e6c44b-4c28-4335-8e39-3d8b9e7ff3a9'

const { data: lead } = await supabase.from('leads').select('*').eq('id', LEAD_ID).single()

const spec = [
  `Hey! Thanks so much for chatting with us today — here's a quick summary of everything we discussed.`,
  ``,
  `Your website: ${lead.vercel_deployment_url}`,
  ``,
  `We'll register a domain for you and get it all connected.`,
  `We'll also set up a professional email address for you.`,
  `Your contact form will send enquiries straight to [CLIENT_EMAIL].`,
  `We've noted your changes: [CLIENT_CHANGES].`,
  ``,
  `Here's the cost breakdown:`,
  `  Website setup: £35`,
  `  Domain + email: £25`,
  `  Ongoing hosting + changes: £5/month`,
  ``,
  `Total to get started: £60`,
  ``,
  `Once payment is sorted, we'll have everything live within 24 hours!`,
  ``,
  `Any questions at all, just reply to this message. Cheers!`,
  `— ${process.env.AGENCY_CALLER_NAME || 'Alex'}, ${process.env.AGENCY_NAME || 'Web Agency'}`,
].join('\n')

const tgRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID!),
    text: spec,
  })
})
const tgData = await tgRes.json() as any
console.log('Telegram sent:', tgData.ok)

process.exit(0)
