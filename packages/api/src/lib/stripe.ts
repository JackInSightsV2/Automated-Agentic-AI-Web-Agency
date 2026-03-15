import { fetchWithRetry } from './fetch-retry'

const STRIPE_API = 'https://api.stripe.com/v1'

function getKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY must be set in .env')
  return key
}

function stripeHeaders() {
  return {
    Authorization: `Bearer ${getKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function encode(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

/** Create a Stripe Checkout Session and return the URL */
export async function createCheckoutLink(leadId: string, leadName: string, needsDomain: boolean): Promise<string> {
  const setupPrice = process.env.STRIPE_PRICE_SETUP
  if (!setupPrice) throw new Error('STRIPE_PRICE_SETUP must be set in .env')

  const params: Record<string, string> = {
    'mode': 'payment',
    'success_url': process.env.STRIPE_SUCCESS_URL || '/',
    'cancel_url': process.env.CALENDLY_LINK || process.env.STRIPE_CANCEL_URL || '/',
    'line_items[0][price]': setupPrice,
    'line_items[0][quantity]': '1',
    'metadata[lead_id]': leadId,
    'metadata[lead_name]': leadName,
    'payment_intent_data[metadata][lead_id]': leadId,
  }

  if (needsDomain) {
    const domainPrice = process.env.STRIPE_PRICE_DOMAIN
    if (!domainPrice) throw new Error('STRIPE_PRICE_DOMAIN must be set in .env')
    params['line_items[1][price]'] = domainPrice
    params['line_items[1][quantity]'] = '1'
  }

  const res = await fetchWithRetry(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: stripeHeaders(),
    body: encode(params),
  })

  const session = await res.json() as { url?: string; id?: string; error?: { message: string } }

  if (session.error) throw new Error(`Stripe error: ${session.error.message}`)

  return session.url!
}

/** List recent completed checkout sessions and return those with lead_id metadata */
export async function checkPaidSessions(): Promise<Array<{ leadId: string; sessionId: string; amountTotal: number }>> {
  const res = await fetchWithRetry(`${STRIPE_API}/checkout/sessions?status=complete&limit=20`, {
    headers: stripeHeaders(),
  })

  const data = await res.json() as { data?: Array<{ id: string; metadata?: Record<string, string>; amount_total?: number; payment_status?: string }> }

  if (!data.data) return []

  return data.data
    .filter(s => s.metadata?.lead_id && s.payment_status === 'paid')
    .map(s => ({
      leadId: s.metadata!.lead_id,
      sessionId: s.id,
      amountTotal: (s.amount_total || 0) / 100,
    }))
}

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 * Returns the parsed event if valid, null if invalid.
 */
export function verifyWebhookSignature(payload: string, signature: string): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return null

  const crypto = require('node:crypto') as typeof import('crypto')

  // Stripe signature format: t=timestamp,v1=signature
  const parts = signature.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2)
  const sig = parts.find(p => p.startsWith('v1='))?.slice(3)

  if (!timestamp || !sig) return null

  // Verify the signature
  const signedPayload = `${timestamp}.${payload}`
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')

  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
    return null
  }

  // Check timestamp is within 5 minutes
  const ageSeconds = Math.abs(Date.now() / 1000 - Number.parseInt(timestamp))
  if (ageSeconds > 300) return null

  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}
