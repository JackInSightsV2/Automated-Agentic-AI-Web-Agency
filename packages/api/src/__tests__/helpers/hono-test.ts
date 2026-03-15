/**
 * Creates a Hono app from individual routers WITHOUT importing index.ts
 * (which calls startCrons() and validates env vars with process.exit).
 */
import { Hono } from 'hono'

export function createTestApp() {
  // Lazy-import routers to ensure mocks are installed first
  const { pipelineRouter } = require('../../routes/pipeline')
  const { closingRouter } = require('../../routes/closing')
  const { adminRouter } = require('../../routes/admin')

  const app = new Hono()

  app.get('/health', (c: any) => c.json({
    status: 'ok',
    service: 'webagency-os',
    time: new Date().toISOString(),
  }))

  app.route('/pipeline', pipelineRouter)
  app.route('/closing', closingRouter)
  app.route('/admin', adminRouter)

  return app
}
