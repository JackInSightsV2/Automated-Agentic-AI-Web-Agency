# Setup Guide

Step-by-step guide to get the Automated Agentic AI Web Agency running.

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime)
- [Node.js](https://nodejs.org) v18+ (for some tools)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (the builder, SEO, delivery, and copywriter agents spawn Claude Code as a subprocess)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) (used by the Nano Banana skill for AI image generation)

## 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** and copy:
   - Project URL -> `SUPABASE_URL`
   - Service role key -> `SUPABASE_SERVICE_KEY`
3. Run the migration SQL from [DATABASE.md](DATABASE.md) in the SQL editor
4. Enable realtime on the `leads`, `queue`, and `agent_logs` tables

## 2. Vercel Setup

1. Create account at [vercel.com](https://vercel.com)
2. Go to **Settings > Tokens** and create a token -> `VERCEL_TOKEN`
3. (Optional) If using a team, copy the team ID -> `VERCEL_TEAM_ID`

## 3. Bland.ai Setup (Phone Calls)

1. Create account at [bland.ai](https://bland.ai)
2. Go to **API Keys** and create one -> `BLAND_AI_API_KEY`
3. Choose a voice in the Bland.ai dashboard (the agents will use it automatically)

## 4. Stripe Setup (Payments)

1. Create account at [stripe.com](https://stripe.com)
2. Get your secret key -> `STRIPE_SECRET_KEY`
3. Create two products:
   - **Website Setup** (one-time) -- copy the Price ID -> `STRIPE_PRICE_SETUP`
   - **Domain Registration** (one-time) -- copy the Price ID -> `STRIPE_PRICE_DOMAIN`
4. Set up a webhook endpoint pointing to `YOUR_API_URL/closing/stripe/webhook`
   - Events to listen for: `checkout.session.completed`
   - Copy the signing secret -> `STRIPE_WEBHOOK_SECRET`
5. Set `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL` to your site URLs

## 5. Telegram Bot Setup (Notifications + HITL)

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot with `/newbot`
3. Copy the token -> `TELEGRAM_BOT_TOKEN`
4. Message your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID -> `TELEGRAM_ADMIN_ID`

## 6. Email Setup (Resend)

1. Create account at [resend.com](https://resend.com)
2. Add and verify your domain
3. Get API key -> `RESEND_API_KEY`
4. Set `OUTREACH_FROM_NAME` (e.g. "Alex from Web Agency")
5. Set `OUTREACH_FROM_EMAIL` (must be from your verified domain)

## 7. Google Places API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Places API**
3. Create an API key -> `GOOGLE_PLACES_API_KEY`

## 8. Gemini CLI + Nano Banana (Image Generation)

The SEO agent uses the **Nano Banana** skill (via Gemini CLI) to generate hero images for websites.

### Install Gemini CLI
```bash
npm install -g @anthropic-ai/gemini-cli   # or see https://github.com/google-gemini/gemini-cli
```

### Get a Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com)
2. Create an API key -> `GEMINI_API_KEY`

### Nano Banana Skill
The skill is already included at `.gemini/skills/nanobanana-imaging/SKILL.md`. It provides MCP tools for image generation, editing, and restoration. The SEO agent calls `/nano-banana` within Claude Code to generate hero background images for each website.

No additional setup needed -- as long as `GEMINI_API_KEY` is set, the skill works automatically when Claude Code spawns subprocess jobs.

## 9. Claude Code Skills + Plugins

The system's agents spawn Claude Code as subprocesses (via the orchestrator). Some agents use Claude Code skills/slash commands inside those sessions:

| Skill | Used By | Purpose |
|-------|---------|---------|
| `/nano-banana` | SEO Agent | Generates hero background images via Gemini |
| `/content-marketing` | Copywriter Agent | Researches content strategy for the business |
| `/theme-factory` | Copywriter Agent | Selects appropriate visual theme |

### How it works
The orchestrator (`packages/api/src/lib/orchestrator.ts`) spawns `claude` CLI with:
- `--dangerously-skip-permissions` (required for autonomous operation)
- `--max-turns` (varies by agent profile)
- `--output-format json`

The spawned Claude Code session has access to any skills/plugins installed on the host machine. To use all features:

1. Make sure Claude Code CLI is installed and authenticated
2. Install any Claude Code plugins you want available (content-marketing, theme-factory, etc.)
3. The Nano Banana skill is included in this repo at `.gemini/skills/`

### Optional: Install additional Claude Code plugins
If you use Claude Code plugins for content-marketing or theme-factory, install them via:
```bash
claude plugins install <plugin-name>
```
These are optional -- the copywriter agent will still produce creative briefs without them, just with less research depth.

## 10. Calendly Setup

1. Create account at [calendly.com](https://calendly.com)
2. Create a 15-30 minute event type
3. Copy the booking link -> `CALENDLY_LINK`
4. (Optional) Set up webhook for auto-triggering closing calls:
   - Point webhook to `YOUR_API_URL/closing/calendly/webhook`
   - Subscribe to `invitee.created` events

## 11. Twilio Setup (Optional -- SMS/WhatsApp)

1. Create account at [twilio.com](https://twilio.com)
2. Get credentials -> `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
3. For WhatsApp, set up the sandbox -> `TWILIO_WHATSAPP_FROM`

## Running Locally

```bash
# Install dependencies
bun install

# Start the API server
cd packages/api
bun run src/index.ts

# In another terminal -- start the dashboard
cd apps/dashboard
bun run dev

# (Optional) Start the marketing site
cd site
bun run dev
```

## Deploying to Production

### API
Deploy the API to any server that supports Bun (Railway, Fly.io, VPS, etc.):
```bash
cd packages/api
bun run src/index.ts
```
Make sure to set `API_URL` to your public URL.

### Dashboard
Build and deploy to Vercel or any static host:
```bash
cd apps/dashboard
bun run build
# Deploy the dist/ folder
```

### Marketing Site
```bash
cd site
bun run build
# Deploy the dist/ folder
```

## Environment Variables Reference

See `.env.example` for the complete list with descriptions.
