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

  // Regression: a bare "yes" (to "is that Sarah?") or the AI's own "brilliant" used to trigger
  // spec_sent, a Stripe session, and an SMS.
  test('"yes" answering an unrelated question is not a commitment', () => {
    const transcripts = [
      { user: 'assistant', text: 'Hi there! Is that Sarah?' },
      { user: 'customer', text: 'Yes' },
      { user: 'assistant', text: 'Brilliant! Do you have a domain?' },
      { user: 'customer', text: 'Yes I have one, it\'s sarahs.co.uk' },
    ]
    const result = extractClosingDetails(transcripts, 'The customer confirmed her name and that she owns sarahs.co.uk. She will get back to us.')
    expect(result.wantsToGoAhead).toBe(false)
    expect(result.domain).toBe('sarahs.co.uk')
  })

  test('assistant saying "perfect" / "brilliant" never counts', () => {
    const transcripts = [
      { user: 'assistant', text: 'Perfect, brilliant, let\'s do it then!' },
      { user: 'customer', text: 'Hmm, I need to think about it.' },
    ]
    const result = extractClosingDetails(transcripts, 'Customer is thinking about it.')
    expect(result.wantsToGoAhead).toBe(false)
  })

  test('summary saying they agreed to proceed counts', () => {
    const result = extractClosingDetails(
      [{ user: 'customer', text: 'Alright.' }],
      'The customer agreed to proceed with the website and gave her phone number for the CTA.',
    )
    expect(result.wantsToGoAhead).toBe(true)
  })

  test('Bland analysis.wants_to_go_ahead overrides the regexes', () => {
    const transcripts = [{ user: 'customer', text: "Yes let's do it!" }]
    expect(extractClosingDetails(transcripts, 'Agreed to proceed', { wants_to_go_ahead: false }).wantsToGoAhead).toBe(false)
    expect(extractClosingDetails([{ user: 'customer', text: 'Hmm.' }], '', { wants_to_go_ahead: true }).wantsToGoAhead).toBe(true)
    expect(extractClosingDetails([{ user: 'customer', text: 'Hmm.' }], '', { wants_to_go_ahead: 'true' }).wantsToGoAhead).toBe(true)
  })

  test('Bland disposition_tag decides going ahead', () => {
    expect(extractClosingDetails([{ user: 'customer', text: 'Hmm.' }], '', { disposition_tag: 'going_ahead' }).wantsToGoAhead).toBe(true)
    expect(extractClosingDetails([{ user: 'customer', text: "Yes let's do it!" }], 'agreed to proceed', { disposition_tag: 'undecided' }).wantsToGoAhead).toBe(false)
    expect(extractClosingDetails([], '', { disposition_tag: 'declined' }).wantsToGoAhead).toBe(false)
  })

  test('labelled summary lines (summary_prompt) are read before the regexes', () => {
    const summary = 'DECISION: going ahead\nDOMAIN: bobsplumbing.co.uk\nEMAIL SETUP: no\nCTA: phone 07700 900123\nCHANGES: swap the hero photo for the van\nBob was keen and confirmed everything.'
    const r = extractClosingDetails([{ user: 'customer', text: 'Alright.' }], summary)
    expect(r.wantsToGoAhead).toBe(true)
    expect(r.domain).toBe('bobsplumbing.co.uk')
    expect(r.needsDomain).toBe(false)
    expect(r.needsEmail).toBe(false)
    expect(r.changes).toBe('swap the hero photo for the van')
  })

  test('labelled summary: needs registration + undecided', () => {
    const summary = 'DECISION: undecided\nDOMAIN: needs registration\nEMAIL SETUP: yes\nCTA: none\nCHANGES: none\nWants to think about it.'
    const r = extractClosingDetails([], summary)
    expect(r.wantsToGoAhead).toBe(false)
    expect(r.needsDomain).toBe(true)
    expect(r.needsEmail).toBe(true)
    expect(r.changes).toBeNull()
  })

  test('Bland analysis fills domain, CTA, and changes', () => {
    const result = extractClosingDetails([], '', {
      wants_to_go_ahead: true,
      domain_name: 'Example.co.uk',
      needs_domain_registration: false,
      needs_email_setup: false,
      cta_type: 'email_form',
      cta_value: 'hello@example.co.uk',
      requested_changes: 'Swap the hero photo for one of the shopfront',
    })
    expect(result.domain).toBe('example.co.uk')
    expect(result.needsDomain).toBe(false)
    expect(result.ctaType).toBe('email_form')
    expect(result.ctaValue).toBe('hello@example.co.uk')
    expect(result.changes).toContain('hero photo')
  })

  test('analysis "null" strings are treated as missing', () => {
    const result = extractClosingDetails(
      [{ user: 'customer', text: "No I don't have a domain name" }],
      '',
      { domain_name: 'null', cta_value: 'null', requested_changes: 'null' },
    )
    expect(result.domain).toBeNull()
    expect(result.needsDomain).toBe(true)
    expect(result.changes).toBeNull()
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
