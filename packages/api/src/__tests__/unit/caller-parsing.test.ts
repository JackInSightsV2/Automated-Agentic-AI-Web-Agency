import { describe, test, expect } from 'bun:test'
import { inferOutcome, extractContactInfo } from '../../agents/caller'

describe('inferOutcome', () => {
  test('"interested" → interested', () => {
    expect(inferOutcome('The client was interested in the website')).toBe('interested')
  })

  test('"yes" → interested', () => {
    expect(inferOutcome('They said yes to the demo')).toBe('interested')
  })

  test('"love it" → interested', () => {
    expect(inferOutcome('They love it and want to proceed')).toBe('interested')
  })

  test('"voicemail" → voicemail', () => {
    expect(inferOutcome('Left a voicemail for the business')).toBe('voicemail')
  })

  test('"left message" → voicemail', () => {
    expect(inferOutcome('Left message on answering machine')).toBe('voicemail')
  })

  test('"no thank you, already have a website" → not_interested', () => {
    expect(inferOutcome('They said no thank you, already have a website')).toBe('not_interested')
  })

  test('"declined the offer" → not_interested', () => {
    expect(inferOutcome('The client declined the offer politely')).toBe('not_interested')
  })

  test('ambiguous text → no_answer', () => {
    expect(inferOutcome('The phone rang but nobody picked up')).toBe('no_answer')
  })

  test('empty string → no_answer', () => {
    expect(inferOutcome('')).toBe('no_answer')
  })

  // Regression: "not interested" contains "interested" and used to classify as interested
  test('"not interested" → not_interested, never interested', () => {
    expect(inferOutcome('The owner said they were not interested in a website')).toBe('not_interested')
    expect(inferOutcome('Not interested. Asked us to send nothing.')).toBe('not_interested')
    expect(inferOutcome("They don't need a site, they already have a website")).toBe('not_interested')
  })

  test('voicemail beats a stray "send" in the summary', () => {
    expect(inferOutcome('Left a voicemail saying we would send the link by text')).toBe('voicemail')
  })

  test('"yes" only counts when nothing negative is present', () => {
    expect(inferOutcome('They said yes at first but then said no thanks, not right now')).toBe('not_interested')
  })

  test('Bland disposition_tag wins over the summary', () => {
    expect(inferOutcome('They love it', { disposition_tag: 'not_interested' })).toBe('not_interested')
    expect(inferOutcome('', { disposition_tag: 'INTERESTED ' })).toBe('interested')
  })

  test('answered_by / status decide voicemail and no-answer before the summary', () => {
    expect(inferOutcome('Great chat, very interested', { answered_by: 'voicemail' })).toBe('voicemail')
    expect(inferOutcome('', { answered_by: 'no-answer' })).toBe('no_answer')
    expect(inferOutcome('', { status: 'busy' })).toBe('no_answer')
  })

  test('unknown disposition_tag falls back to the summary', () => {
    expect(inferOutcome('Left message on answering machine', { disposition_tag: 'banana' })).toBe('voicemail')
  })
})

describe('extractContactInfo', () => {
  test('extracts email from transcript', () => {
    const transcripts = [
      { user: 'customer', text: 'My email is sarah@business.co.uk' },
    ]
    const result = extractContactInfo(transcripts)
    expect(result.email).toBe('sarah@business.co.uk')
  })

  test('extracts contact name from "Nice to meet you" pattern', () => {
    const transcripts = [
      { user: 'assistant', text: 'Nice to meet you Sarah! Let me tell you about the website.' },
    ]
    const result = extractContactInfo(transcripts)
    expect(result.contactName).toBe('Sarah')
  })

  test('extracts contact name from "Lovely to meet you" pattern', () => {
    const transcripts = [
      { user: 'assistant', text: 'Lovely to meet you James, I\'m calling about your website.' },
    ]
    const result = extractContactInfo(transcripts)
    expect(result.contactName).toBe('James')
  })

  test('returns empty object when no info found', () => {
    const transcripts = [
      { user: 'customer', text: 'Hello, who is this?' },
      { user: 'assistant', text: 'Hi there! I\'m calling about your business.' },
    ]
    const result = extractContactInfo(transcripts)
    expect(result.email).toBeUndefined()
    expect(result.contactName).toBeUndefined()
  })

  test('ignores assistant text for email extraction', () => {
    const transcripts = [
      { user: 'assistant', text: 'You can reach us at info@agency.com' },
    ]
    const result = extractContactInfo(transcripts)
    expect(result.email).toBeUndefined()
  })

  test('prefers Bland analysis fields when present and sane', () => {
    const result = extractContactInfo([], { contact_name: 'Priya', email: 'Priya@Shop.co.uk' })
    expect(result.contactName).toBe('Priya')
    expect(result.email).toBe('priya@shop.co.uk')
  })

  test('ignores junk analysis values', () => {
    const result = extractContactInfo(
      [{ user: 'assistant', text: 'Nice to meet you Tom!' }],
      { contact_name: 'the owner of the shop', email: 'not-an-email' },
    )
    expect(result.contactName).toBe('Tom')
    expect(result.email).toBeUndefined()
  })
})
