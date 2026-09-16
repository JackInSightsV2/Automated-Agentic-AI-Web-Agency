# Automated Agentic AI Web Agency

An autonomous AI-powered web agency that discovers local businesses, builds them professional websites, and handles the entire sales pipeline -- from first contact to payment -- using a team of specialized AI agents.

![Screenshot](public/screenshot.jpeg)

## What It Does

This system runs an entire web agency autonomously:

1. **Discovers** local businesses without websites via Google Places API
2. **Verifies** they're good candidates (no existing site, valid contact info)
3. **Writes** custom copy using an AI copywriter agent
4. **Builds** a professional Vite website tailored to the business
5. **Reviews** the code for quality and accessibility
6. **Deploys** to Vercel with a preview URL
7. **Emails** the business owner with their free website
8. **Calls** them using an AI voice agent (Bland.ai) to walk through the site
9. **Follows up** with texts/WhatsApp and a second call
10. **Closes** the deal on a booked call, collecting payment via Stripe
11. **Delivers** any requested changes and connects their domain

## Architecture

```
+-----------------------------------------------------+
|                   Dashboard (Vite)                    |
|  Live office view - Agent activity - CEO inbox       |
|  Pipeline stats - Queue controls - HITL approvals    |
+------------------------+----------------------------+
                         | SSE
+------------------------+----------------------------+
|                    API Server (Bun)                   |
|                                                      |
|  +---------+ +---------+ +----------+ +----------+  |
|  |  Scout  | |Verifier | |Copywriter| | Builder  |  |
|  +----+----+ +----+----+ +----+-----+ +----+-----+  |
|       |           |           |             |        |
|  +----+----+ +----+----+ +---+------+ +----+-----+  |
|  | Deployer| | Emailer | |  Caller  | |  Closer  |  |
|  +----+----+ +----+----+ +----+-----+ +----+-----+  |
|       |           |           |             |        |
|  +----+----+ +----+----+ +---+------+ +----+-----+  |
|  |   SEO   | |Reviewer | | FollowUp | | Delivery |  |
|  +---------+ +---------+ +----------+ +----------+  |
|                                                      |
|  Queue System - Cron Jobs - Telegram HITL Bot        |
+------------------------+----------------------------+
                         |
          +--------------+--------------+
          |              |              |
    +-----+-----+ +-----+------+ +-----+-----+
    | Supabase  | |   Vercel   | |  Bland.ai |
    |   (DB)    | |  (Deploy)  | |  (Calls)  |
    +-----------+ +------------+ +-----------+
```

## Key Features

- **15 Specialized AI Agents** -- each handles one step of the pipeline
- **Human-in-the-Loop (HITL) Gates** -- Telegram bot for approving calls, deployments, and payments
- **Queue-Based Architecture** -- reliable, ordered processing with pause/resume controls
- **Live Dashboard** -- animated office view showing agent activity in real-time
- **CEO Inbox** -- simulated executive updates based on pipeline activity
- **Fully Whitelabelable** -- configure agency name, caller persona, owner name, and contact details via environment variables

## Tech Stack

- **Runtime:** Bun
- **API Framework:** Hono
- **Database:** Supabase (PostgreSQL)
- **Deployment:** Vercel
- **Phone Calls:** Bland.ai
- **Email:** Resend
- **Payments:** Stripe
- **Notifications:** Telegram Bot
- **SMS/WhatsApp:** Twilio
- **Lead Discovery:** Google Places API
- **Hero Images:** OpenAI Images API (optional)
- **Site Builder:** Claude Code (as subprocess)

### MCP Servers

`.mcp.json` configures three MCP servers for **interactive** Claude Code sessions in this repo, which is useful while setting up. The subprocess jobs the agency runs do not use them.

| Server | URL | Purpose |
|--------|-----|---------|
| `stripe` | `https://mcp.stripe.com` | Products, prices, webhooks, payment links |
| `supabase` | `https://mcp.supabase.com/mcp` | Tables, migrations, RLS policies |
| `vercel` | `https://mcp.vercel.com/mcp` | Deployments, domains, env vars |

## Quick Start

```bash
git clone https://github.com/JackInSightsV2/Automated-Agentic-AI-Web-Agency.git
cd Automated-Agentic-AI-Web-Agency
chmod +x setup.sh && ./setup.sh
```

The setup script installs Bun and all dependencies and creates your `.env` file. After that, fill in your API keys and run `bun run dev`.

See [docs/SETUP.md](docs/SETUP.md) for detailed setup instructions.

### Claude Code Skills and Subagents

The subprocess jobs use one skill and five subagents, vendored in [`packages/api/claude/`](packages/api/claude/) and staged into each job directory by the orchestrator, so every job is deterministic and nothing has to be installed on the host:

| Asset | Used by | Source |
|-------|---------|--------|
| `frontend-design` skill | builder | `anthropics/claude-plugins-official` (Apache-2.0) |
| `content-marketer` agent | copywriter | `wshobson/agents` (MIT) |
| `seo-meta-optimizer`, `seo-structure-architect` agents | seo | `wshobson/agents` (MIT) |
| `code-reviewer`, `performance-engineer` agents | reviewer | `wshobson/agents` (MIT) |

See `packages/api/claude/README.md` for provenance and the reasons other plugins were not adopted.

Hero images are generated by the API server itself via the OpenAI Images API (`packages/api/src/lib/images.ts`), not by a Claude Code skill. Set `OPENAI_API_KEY` to enable them.

## Documentation

- [Setup Guide](docs/SETUP.md) -- step-by-step installation and configuration
- [Architecture](docs/ARCHITECTURE.md) -- system design, pipeline flow, queue system
- [Agents](docs/AGENTS.md) -- detailed description of each AI agent
- [Database](docs/DATABASE.md) -- Supabase schema and migrations

## Whitelabeling

All branding is configurable via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENCY_NAME` | Your agency's display name | "Web Agency" |
| `AGENCY_CALLER_NAME` | AI caller persona name | "Alex" |
| `AGENCY_OWNER_NAME` | Owner/CEO name | "The Owner" |
| `AGENCY_EMAIL` | Contact email | -- |
| `AGENCY_PHONE` | Outbound phone number | Lead's phone |
| `AGENCY_SLUG` | URL-safe identifier | "web-agency" |

For the dashboard and site (Vite), use `VITE_` prefixed versions.

## Credits

Dashboard pixel art assets and the visual agent-at-desk concept are from [Pixel Agent Desk](https://github.com/mgpixelart/pixel-agent-desk) by mgpixelart, licensed under MIT.

## License

MIT -- see [LICENSE](LICENSE) for details.
