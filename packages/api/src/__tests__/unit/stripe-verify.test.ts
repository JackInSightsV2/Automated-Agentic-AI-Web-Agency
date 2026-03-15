import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import crypto from 'node:crypto'

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret'
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
  const savedSecret = process.env.STRIPE_WEBHOOK_SECRET

  function makeSignature(body: string, timestamp: number, sigSecret: string): string {
    const signedPayload = `${timestamp}.${body}`
    const sig = crypto.createHmac('sha256', sigSecret).update(signedPayload).digest('hex')
    return `t=${timestamp},v1=${sig}`
  }

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = secret
  })

  afterEach(() => {
    // Always restore to original value
    process.env.STRIPE_WEBHOOK_SECRET = savedSecret || 'whsec_test_secret'
  })

  test('valid signature returns parsed event', async () => {
    const { verifyWebhookSignature } = await import('../../lib/stripe')
    const timestamp = Math.floor(Date.now() / 1000)
    const sig = makeSignature(payload, timestamp, secret)

    const result = verifyWebhookSignature(payload, sig)
    expect(result).toBeTruthy()
    expect(result.type).toBe('checkout.session.completed')
  })

  test('invalid signature returns null', async () => {
    const { verifyWebhookSignature } = await import('../../lib/stripe')
    const timestamp = Math.floor(Date.now() / 1000)
    const sig = makeSignature(payload, timestamp, 'wrong_secret')

    const result = verifyWebhookSignature(payload, sig)
    expect(result).toBeNull()
  })

  test('expired timestamp (>5min) returns null', async () => {
    const { verifyWebhookSignature } = await import('../../lib/stripe')
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400
    const sig = makeSignature(payload, oldTimestamp, secret)

    const result = verifyWebhookSignature(payload, sig)
    expect(result).toBeNull()
  })

  test('missing STRIPE_WEBHOOK_SECRET returns null', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = ''
    const { verifyWebhookSignature } = await import('../../lib/stripe')

    const timestamp = Math.floor(Date.now() / 1000)
    const sig = makeSignature(payload, timestamp, secret)

    const result = verifyWebhookSignature(payload, sig)
    expect(result).toBeNull()
  })
})
