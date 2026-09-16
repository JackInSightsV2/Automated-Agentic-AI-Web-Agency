# AI Agents

The system uses 15 specialized AI agents, each handling one step of the pipeline.

## Scout Agent
- **File:** `packages/api/src/agents/scout.ts`
- **Purpose:** Discovers local businesses without websites using Google Places API
- **Input:** Search query + location
- **Output:** New leads in `discovered` status
- **Config:** `GOOGLE_PLACES_API_KEY`

## Verifier Agent
- **File:** `packages/api/src/agents/verifier.ts`
- **Purpose:** Scores lead viability: Companies House status and recent filings, Google rating and review count, phone present. Threshold is `VIABILITY_THRESHOLD` (default 40).
- **Input:** Lead in `discovered` status
- **Output:** Lead updated to `verified` or `rejected`, with `viability_score` and `viability_notes`
- **Config:** `COMPANIES_HOUSE_API_KEY` (optional), `VIABILITY_THRESHOLD`

## Copywriter Agent
- **File:** `packages/api/src/agents/copywriter.ts`
- **Purpose:** Creates a creative brief (brand voice, colors, typography, content) for the website. Delegates messaging angles, local keywords, and USPs to the `content-marketer` subagent, then chooses the palette and type pairing itself.
- **Input:** Lead in `verified` status
- **Output:** JSON creative brief stored on the lead
- **Config:** `AGENCY_NAME`
- **Staged assets:** `content-marketer` agent

## Builder Agent
- **File:** `packages/api/src/agents/builder.ts`
- **Purpose:** Generates a complete Vite website using Claude Code as a subprocess, loading the `frontend-design` skill first for aesthetic direction
- **Input:** Lead with creative brief
- **Output:** Website source files in `preview/` directory
- **Staged assets:** `frontend-design` skill

## Code Reviewer Agent
- **File:** `packages/api/src/agents/code-reviewer.ts`
- **Purpose:** Reviews generated website code for quality, accessibility, and correctness. Runs the `code-reviewer` and `performance-engineer` subagents in parallel and combines their findings into `review.json`.
- **Input:** Built website files
- **Output:** Pass/fail with feedback (failed sites get re-queued for rebuild, max 3 attempts)
- **Staged assets:** `code-reviewer`, `performance-engineer` agents

## SEO Agent
- **File:** `packages/api/src/agents/seo.ts` (hero image: `packages/api/src/lib/images.ts`)
- **Purpose:** Generates a hero background image via the OpenAI Images API (in Bun, before the Claude Code job), then has Claude Code wire it into the CSS and add meta tags, Open Graph, LocalBusiness JSON-LD, sitemap and robots.txt. Site URLs are written as `__SITE_URL__` and stamped by the deployer.
- **Input:** Built website
- **Output:** SEO-optimized website with `public/hero.webp` (or the gradient hero if no `OPENAI_API_KEY`)
- **Config:** `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_SIZE`, `HERO_IMAGES`
- **Staged assets:** `seo-meta-optimizer`, `seo-structure-architect` agents

## Deployer Agent
- **File:** `packages/api/src/agents/deployer.ts`
- **Purpose:** Deploys the website to Vercel and captures the preview URL
- **Input:** Reviewed website files
- **Output:** Live Vercel URL stored on the lead
- **Config:** `VERCEL_TOKEN`, `VERCEL_TEAM_ID`

## Emailer Agent
- **File:** `packages/api/src/agents/emailer.ts`
- **Purpose:** Sends outreach email with the website preview link
- **Input:** Lead with deployment URL and email address
- **Output:** Email sent via Resend
- **Config:** `RESEND_API_KEY`, `OUTREACH_FROM_NAME`, `OUTREACH_FROM_EMAIL`

## Caller Agent
- **File:** `packages/api/src/agents/caller.ts`
- **Purpose:** Makes initial outbound call via Bland.ai to introduce the website
- **Input:** Lead with phone number and deployment URL
- **Output:** Call outcome (interested / not interested / voicemail)
- **Config:** `BLAND_AI_API_KEY`, `AGENCY_CALLER_NAME`, `AGENCY_NAME`, `AGENCY_PHONE`

## Follow-up Caller Agent
- **File:** `packages/api/src/agents/followup-caller.ts`
- **Purpose:** Makes a follow-up call to check if they viewed the website
- **Input:** Lead that was called but hasn't booked
- **Output:** Updated interest status
- **Config:** Same as Caller Agent + `AGENCY_OWNER_NAME`

## Closer Agent
- **File:** `packages/api/src/agents/closer.ts`
- **Purpose:** Conducts closing call -- discusses pricing, domain, email setup, CTA preferences
- **Input:** Lead that booked a call
- **Output:** Deal details (domain, email setup, CTA type, changes requested)
- **Config:** Same as Caller Agent

## SMS Agent
- **File:** `packages/api/src/agents/sms.ts`
- **Purpose:** Sends SMS messages with website link and booking info
- **Input:** Lead with phone number
- **Output:** SMS sent
- **Config:** `AGENCY_NAME`, `AGENCY_CALLER_NAME`

## WhatsApp Agent
- **File:** `packages/api/src/agents/whatsapp.ts`
- **Purpose:** Sends WhatsApp messages via Twilio
- **Input:** Lead with phone number
- **Output:** WhatsApp message sent
- **Config:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `AGENCY_NAME`, `AGENCY_CALLER_NAME`

## Monitor Agent
- **File:** `packages/api/src/agents/monitor.ts`
- **Purpose:** Monitors pipeline health, detects stalled leads, alerts on issues

## Delivery Agent
- **File:** `packages/api/src/agents/delivery.ts`
- **Purpose:** Applies client-requested changes, rebuilds, and redeploys
- **Input:** Lead with requested changes
- **Output:** Updated website deployed
- **Config:** `AGENCY_NAME`, `AGENCY_CALLER_NAME`
