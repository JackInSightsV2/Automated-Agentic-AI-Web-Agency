import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { pipelineRouter } from './routes/pipeline'
import { closingRouter } from './routes/closing'
import { adminRouter } from './routes/admin'
import { eventsRouter } from './routes/events'
import { startCrons } from './lib/crons'

// Validate required env vars at startup
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID']
const WARN_ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_SMS_FROM', 'BLAND_AI_API_KEY', 'STRIPE_SECRET_KEY', 'VERCEL_TOKEN']

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required env var: ${key}`)
    process.exit(1)
  }
}
for (const key of WARN_ENV) {
  if (!process.env[key]) {
    console.warn(`[WARN] Missing env var: ${key} — some features will be unavailable`)
  }
}

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.get('/health', (c) => c.json({
  status: 'ok',
  service: 'webagency-os',
  time: new Date().toISOString()
}))

app.route('/pipeline', pipelineRouter)
app.route('/closing', closingRouter)
app.route('/admin', adminRouter)
app.route('/events', eventsRouter)

// Start payment check + queue processor crons
startCrons()

export default {
  port: Number.parseInt(process.env.PORT || '3001'),
  fetch: app.fetch
}
