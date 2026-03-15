/**
 * Global test preload — sets dummy env vars and mocks external modules
 * so that no test ever hits a real service.
 */

// ── Dummy env vars ──────────────────────────────────────────────────
process.env.SUPABASE_URL = 'https://test.supabase.co'
process.env.SUPABASE_SERVICE_KEY = 'test-service-key'
process.env.TELEGRAM_BOT_TOKEN = 'test-telegram-token'
process.env.TELEGRAM_ADMIN_CHAT_ID = '123456789'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_PRICE_SETUP = 'price_setup_123'
process.env.STRIPE_PRICE_DOMAIN = 'price_domain_456'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret'
process.env.BLAND_AI_API_KEY = 'bland-test-key'
process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid'
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token'
process.env.TWILIO_SMS_FROM = '+15551234567'
process.env.RESEND_API_KEY = 're_test_key'
process.env.COMPANIES_HOUSE_API_KEY = 'ch-test-key'
process.env.AGENCY_NAME = 'Test Agency'
process.env.AGENCY_CALLER_NAME = 'TestBot'
process.env.AGENCY_OWNER_NAME = 'Test Owner'
process.env.AGENCY_EMAIL = 'test@agency.com'
process.env.AGENCY_PHONE = '+441234567890'
process.env.DEFAULT_TLD = '.co.uk'
process.env.VIABILITY_THRESHOLD = '40'

// ── Mock external modules ───────────────────────────────────────────
import { mock } from 'bun:test'

// Prevent Telegram bot from polling
mock.module('node-telegram-bot-api', () => {
  class MockBot {
    sendMessage() { return Promise.resolve() }
    answerCallbackQuery() { return Promise.resolve() }
    onText() {}
    on() {}
  }
  return { default: MockBot }
})

// Prevent Twilio SDK init
mock.module('twilio', () => {
  const mockClient = {
    messages: { create: () => Promise.resolve({ sid: 'SM_test' }) },
  }
  return { default: () => mockClient }
})

// Prevent Resend SDK init
mock.module('resend', () => {
  class Resend {
    emails = { send: () => Promise.resolve({ id: 'email_test' }) }
  }
  return { Resend }
})
