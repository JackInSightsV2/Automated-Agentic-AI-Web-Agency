# Setup Guide

Step-by-step guide to get the Automated Agentic AI Web Agency running.

## Prerequisites

- [Bun](https://bun.sh) v1.0+ (runtime)
- [Node.js](https://nodejs.org) v18+ (for some tools)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (the builder, SEO, delivery, and copywriter agents spawn Claude Code as a subprocess)

## 1. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** and copy:
   - Project URL -> `SUPABASE_URL`
   - Service role key -> `SUPABASE_SERVICE_KEY`
3. Open the SQL editor and run the whole of [`supabase/schema.sql`](../supabase/schema.sql). See [DATABASE.md](DATABASE.md) for the table reference and for migrating a database created from the older setup SQL.

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
4. Message your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID -> `TELEGRAM_ADMIN_CHAT_ID`

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
4. (Optional) Set `MOCK_SCOUT=true` to run the pipeline against bundled sample businesses without a Google key

## 8. OpenAI (Hero Image Generation, optional)

Before the SEO step, the API server generates a photographic hero background for each site with the [OpenAI Images API](https://developers.openai.com/api/docs/guides/image-generation) and saves it as `public/hero.webp`. The SEO agent then wires it into the CSS. If no key is set, or generation fails, the site keeps the builder's CSS gradient hero.

1. Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) -> `OPENAI_API_KEY`
2. GPT Image models may require [organisation verification](https://platform.openai.com/settings/organization/general) in the OpenAI console before they return images. If generation fails with a verification error, complete that once.
3. Optional tuning in `.env`:

| Variable | Default | Notes |
|----------|---------|-------|
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-flare` | `gpt-image-2.5-sunburst` for more detail, `gpt-image-1-mini` for a quarter of the cost |
| `OPENAI_IMAGE_QUALITY` | `medium` | `low` / `medium` / `high` / `xhigh` / `max`. Roughly $0.01 to $0.20 per image |
| `OPENAI_IMAGE_SIZE` | `1536x1024` | Any `WIDTHxHEIGHT` in multiples of 16, up to 3:1 |
| `HERO_IMAGES` | `true` | `false` disables generation even with a key set |

Cost is token-metered; a `medium` landscape hero is typically 5 to 8 cents. Every generation is logged to `agent_logs` with the model, quality, size, and usage.

## 9. MCP Servers

The project configures three MCP (Model Context Protocol) servers that give Claude Code direct access to manage your services. These are configured in `.claude/mcp.json` and the setup script creates this automatically.

| Server | URL | Purpose |
|--------|-----|---------|
| `stripe` | `https://mcp.stripe.com` | Manage Stripe products, prices, webhooks, and payment links |
| `supabase` | `https://mcp.supabase.com/mcp` | Manage Supabase projects, tables, migrations, and RLS policies |
| `vercel` | `https://mcp.vercel.com/mcp` | Manage Vercel deployments, domains, and environment variables |

These are especially useful during initial setup — Claude Code can help you create your Stripe products, set up your Supabase schema, and configure Vercel deployments directly through conversation.

Each server will prompt you to authenticate on first use via your browser.

## 10. Claude Code Skills + Plugins

The system's agents spawn Claude Code as subprocesses (via the orchestrator). The spawned sessions have access to any skills/plugins installed on the host machine. The `setup.sh` script handles all of this automatically, but here's the full breakdown.

### How it works
The orchestrator (`packages/api/src/lib/orchestrator.ts`) spawns `claude` CLI with:
- `--dangerously-skip-permissions` (required for autonomous operation)
- `--max-turns` (varies by agent profile)
- `--output-format json`

### Plugin Marketplaces

The following marketplaces must be registered before installing plugins:

```bash
claude plugin marketplace add mksglu/context-mode
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add wshobson/agents
claude plugin marketplace add composiohq/awesome-claude-plugins
claude plugin marketplace add paddo/claude-tools
```

### Plugins

| Plugin | Marketplace | Purpose |
|--------|-------------|---------|
| `context-mode` | `mksglu/context-mode` | Context-aware mode switching |
| `frontend-design` | `anthropics/claude-plugins-official` | Production-grade frontend interface generation |
| `theme-factory` | `composiohq/awesome-claude-plugins` | Visual theme selection based on business type |
| `canvas-design` | `composiohq/awesome-claude-plugins` | Canvas-based design generation |
| `artifacts-builder` | `composiohq/awesome-claude-plugins` | Structured artifact creation |
| `comprehensive-review` | `wshobson/agents` | In-depth code review workflows |
| `security-scanning` | `wshobson/agents` | Security vulnerability scanning |
| `application-performance` | `wshobson/agents` | Performance analysis and optimisation |
| `content-marketing` | `wshobson/agents` | Content strategy research for businesses |
| `business-analytics` | `wshobson/agents` | Business data analysis |
| `seo-technical-optimization` | `wshobson/agents` | Technical SEO auditing and optimisation |

Install all plugins:
```bash
claude plugin install context-mode
claude plugin install frontend-design
claude plugin install theme-factory
claude plugin install canvas-design
claude plugin install artifacts-builder
claude plugin install comprehensive-review
claude plugin install security-scanning
claude plugin install application-performance
claude plugin install content-marketing
claude plugin install business-analytics
claude plugin install seo-technical-optimization
```

## 11. Calendly Setup

1. Create account at [calendly.com](https://calendly.com)
2. Create a 15-30 minute event type
3. Copy the booking link -> `CALENDLY_LINK`
4. (Optional) Set up webhook for auto-triggering closing calls:
   - Point webhook to `YOUR_API_URL/closing/calendly/webhook`
   - Subscribe to `invitee.created` events

## 12. Twilio Setup (Optional -- SMS/WhatsApp)

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
