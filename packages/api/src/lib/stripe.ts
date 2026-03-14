const STRIPE_API = 'https://api.stripe.com/v1'

function getKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY must be set in .env')
  return key
}

function headers() {
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
  const setupPrice = process.env.STRIPE_PRICE_SETUP!
  const domainPrice = process.env.STRIPE_PRICE_DOMAIN!

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
    params['line_items[1][price]'] = domainPrice
    params['line_items[1][quantity]'] = '1'
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: headers(),
    body: encode(params),
  })

  const session = await res.json() as { url?: string; id?: string; error?: { message: string } }

  if (session.error) throw new Error(`Stripe error: ${session.error.message}`)

  return session.url!
}

/** List recent completed checkout sessions and return those with lead_id metadata */
export async function checkPaidSessions(): Promise<Array<{ leadId: string; sessionId: string; amountTotal: number }>> {
  const res = await fetch(`${STRIPE_API}/checkout/sessions?status=complete&limit=20`, {
    headers: headers(),
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
