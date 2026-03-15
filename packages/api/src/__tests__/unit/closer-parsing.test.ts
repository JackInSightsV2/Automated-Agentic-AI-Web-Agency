import { describe, test, expect } from 'bun:test'
import { extractClosingDetails, buildJobSpec } from '../../agents/closer'

describe('extractClosingDetails', () => {
  test('"yes let\'s do it" → wantsToGoAhead = true', () => {
    const transcripts = [
      { user: 'customer', text: "Yes let's do it, sounds great!" },
    ]
    const result = extractClosingDetails(transcripts, 'Client agreed to proceed')
    expect(result.wantsToGoAhead).toBe(true)
  })

  test('"sounds good" → wantsToGoAhead = true', () => {
    const transcripts = [
      { user: 'customer', text: 'Sounds good, sign me up!' },
    ]
    const result = extractClosingDetails(transcripts, 'Client wants to go ahead')
    expect(result.wantsToGoAhead).toBe(true)
  })

  test('"not sure" negates positive → wantsToGoAhead = false', () => {
    const transcripts = [
      { user: 'customer', text: "It sounds good but I'm not sure yet, let me think about it" },
    ]
    const result = extractClosingDetails(transcripts, 'Client is not sure')
    expect(result.wantsToGoAhead).toBe(false)
  })

  test('extracts domain (e.g. mybusiness.co.uk)', () => {
    const transcripts = [
      { user: 'customer', text: 'Yes I have a domain, it\'s mybusiness.co.uk' },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.domain).toBe('mybusiness.co.uk')
  })

  test('"don\'t have a domain" → needsDomain = true', () => {
    const transcripts = [
      { user: 'customer', text: "No I don't have a domain name" },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.needsDomain).toBe(true)
  })

  test('detects ctaType phone', () => {
    const transcripts = [
      { user: 'customer', text: 'I\'d prefer a phone number so people can call me directly' },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.ctaType).toBe('phone')
  })

  test('detects ctaType email_form', () => {
    const transcripts = [
      { user: 'customer', text: 'A contact form would be great, they can fill in their details' },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.ctaType).toBe('email_form')
  })

  test('extracts phone number as ctaValue', () => {
    const transcripts = [
      { user: 'customer', text: 'Put my phone number on there: 07700 900123' },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.ctaType).toBe('phone')
    expect(result.ctaValue).toBeTruthy()
    expect(result.ctaValue).toContain('07700')
  })

  test('extracts email as ctaValue', () => {
    const transcripts = [
      { user: 'customer', text: 'Use a contact form, send submissions to hello@mybiz.com' },
    ]
    const result = extractClosingDetails(transcripts, '')
    expect(result.ctaType).toBe('email_form')
    expect(result.ctaValue).toBe('hello@mybiz.com')
  })
})

describe('buildJobSpec', () => {
  const baseLead = {
    name: 'Test Business',
    contact_name: 'Sarah',
    vercel_deployment_url: 'https://test.vercel.app',
    stripe_payment_link: 'https://checkout.stripe.com/pay/cs_test_123',
  }

  const baseDetails = {
    wantsToGoAhead: true,
    domain: 'testbiz.co.uk',
    needsDomain: false,
    needsEmail: false,
    ctaType: 'phone' as const,
    ctaValue: '07700900123',
    changes: null,
  }

  test('includes correct pricing from config', () => {
    const spec = buildJobSpec(baseLead, baseDetails, 35)
    expect(spec).toContain('£35')
    expect(spec).toContain('Website setup')
  })

  test('includes payment link when available', () => {
    const spec = buildJobSpec(baseLead, baseDetails, 35)
    expect(spec).toContain('https://checkout.stripe.com/pay/cs_test_123')
  })

  test('shows domain registration cost when needsDomain', () => {
    const details = { ...baseDetails, needsDomain: true, domain: null }
    const spec = buildJobSpec(baseLead, details, 60)
    expect(spec).toContain('Domain + email')
    expect(spec).toContain('register a domain')
  })

  test('uses contact_name for greeting', () => {
    const spec = buildJobSpec(baseLead, baseDetails, 35)
    expect(spec).toContain('Hey Sarah!')
  })

  test('falls back to business name when no contact_name', () => {
    const lead = { ...baseLead, contact_name: null }
    const spec = buildJobSpec(lead, baseDetails, 35)
    expect(spec).toContain('Hey Test!')
  })

  test('shows placeholder when no payment link', () => {
    const lead = { ...baseLead, stripe_payment_link: null }
    const spec = buildJobSpec(lead, baseDetails, 35)
    expect(spec).toContain('[Payment link will be added here]')
  })
})
