import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { pipelineRouter } from './routes/pipeline'
import { closingRouter } from './routes/closing'
import { adminRouter } from './routes/admin'
import { eventsRouter } from './routes/events'
import { startCrons } from './lib/crons'

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
  port: parseInt(process.env.PORT || '3001'),
  fetch: app.fetch
}
