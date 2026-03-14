/** Centralised config derived from env vars — no hardcoded values in agent prompts. */

export const pricing = {
  get setup(): number { return parseInt(process.env.PRICE_SETUP || '35') },
  get monthly(): number { return parseInt(process.env.PRICE_MONTHLY || '5') },
  get domain(): number { return parseInt(process.env.PRICE_DOMAIN || '25') },
}

export const agency = {
  get name(): string { return process.env.AGENCY_NAME || 'Web Agency' },
  get callerName(): string { return process.env.AGENCY_CALLER_NAME || 'Alex' },
  get ownerName(): string { return process.env.AGENCY_OWNER_NAME || 'The Owner' },
  get email(): string { return process.env.AGENCY_EMAIL || '' },
  get phone(): string { return process.env.AGENCY_PHONE || '' },
  get defaultTld(): string { return process.env.DEFAULT_TLD || '.co.uk' },
}

/**
 * If DEMO_PHONE is set, all outbound calls go to that number instead of the lead's.
 * Used for testing/demo — remove in production.
 */
export function getCallPhone(leadPhone: string): string {
  return process.env.DEMO_PHONE || leadPhone
}
