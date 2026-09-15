import { describe, test, expect } from 'bun:test'
import { leadSlug } from '../../lib/slug'

describe('leadSlug', () => {
  test('lowercases and hyphenates', () => {
    expect(leadSlug("Bob's Plumbing & Heating")).toBe('bob-s-plumbing-heating')
  })

  test('caps at 40 chars without a trailing hyphen', () => {
    const slug = leadSlug('The Very Long Business Name That Goes On And On Forever Ltd')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('strips leading punctuation', () => {
    expect(leadSlug('  --Café Nero--')).toBe('caf-nero')
  })

  test('never returns empty', () => {
    expect(leadSlug('!!!')).toBe('site')
  })
})
