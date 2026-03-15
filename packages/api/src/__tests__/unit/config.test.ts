import { describe, test, expect, afterEach } from 'bun:test'

describe('lib/config', () => {
  const saved = {
    PRICE_SETUP: process.env.PRICE_SETUP,
    AGENCY_NAME: process.env.AGENCY_NAME,
    DEMO_PHONE: process.env.DEMO_PHONE,
  }

  afterEach(() => {
    // Restore all env vars to their original values
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) process.env[key] = ''
      else process.env[key] = val
    }
  })

  test('pricing.setup returns env var as number', async () => {
    process.env.PRICE_SETUP = '50'
    const { pricing } = await import('../../lib/config')
    expect(pricing.setup).toBe(50)
  })

  test('pricing.setup defaults to 35 when empty', async () => {
    process.env.PRICE_SETUP = ''
    const { pricing } = await import('../../lib/config')
    // parseInt('') returns NaN, so || '35' kicks in
    expect(pricing.setup).toBe(35)
  })

  test('agency.name returns env var', async () => {
    process.env.AGENCY_NAME = 'Cool Agency'
    const { agency } = await import('../../lib/config')
    expect(agency.name).toBe('Cool Agency')
  })

  test('agency.name defaults to Web Agency when empty', async () => {
    process.env.AGENCY_NAME = ''
    const { agency } = await import('../../lib/config')
    expect(agency.name).toBe('Web Agency')
  })

  test('getCallPhone returns DEMO_PHONE when set', async () => {
    process.env.DEMO_PHONE = '+440000000000'
    const { getCallPhone } = await import('../../lib/config')
    expect(getCallPhone('+447777777777')).toBe('+440000000000')
  })

  test('getCallPhone returns lead phone when DEMO_PHONE not set', async () => {
    process.env.DEMO_PHONE = ''
    const { getCallPhone } = await import('../../lib/config')
    expect(getCallPhone('+447777777777')).toBe('+447777777777')
  })
})
