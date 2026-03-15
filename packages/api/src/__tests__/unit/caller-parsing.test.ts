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

  test('"declined the offer" → no_answer (unrecognized negative)', () => {
    expect(inferOutcome('The client declined the offer politely')).toBe('no_answer')
  })

  test('ambiguous text → no_answer', () => {
    expect(inferOutcome('The phone rang but nobody picked up')).toBe('no_answer')
  })

  test('empty string → no_answer', () => {
    expect(inferOutcome('')).toBe('no_answer')
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
})
