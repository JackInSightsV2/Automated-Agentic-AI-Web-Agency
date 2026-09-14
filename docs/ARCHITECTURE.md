# Architecture

## Overview

The system is a monorepo with three main components:

- **`packages/api/`** -- Bun/Hono API server with 15 AI agents
- **`apps/dashboard/`** -- Vite vanilla JS dashboard with live office view
- **`site/`** -- Vite marketing website

## Pipeline Flow

```
Scout -> Verify -> Copywrite -> Build -> SEO -> Review -> Deploy -> Email -> Call -> Follow-up -> Close -> Deliver
```

Each step is handled by a specialized agent and connected via a queue system.

Phone calls are asynchronous. The `call` and `close` handlers start a Bland.ai call and return; a cron polls Bland every 30s (`pollBlandCall` / `pollClosingCall`) and, when the call has ended, records the outcome, updates the lead, and queues the next stage (follow-up, or job spec + payment link). Bland is asked for structured `analysis` fields (outcome, contact name, domain, CTA, changes); transcript regexes are only the fallback.

### Lead Statuses

| Status | Description |
|--------|-------------|
| `discovered` | Found via Google Places API |
| `verified` | Contact info validated, no existing website |
| `copywritten` | Creative brief generated |
| `built` | Website source code generated |
| `reviewed` | Code quality check passed |
| `deployed` | Live on Vercel preview URL |
| `emailed` | Outreach email sent |
| `called` | Initial phone call made |
| `clicked` | Lead clicked the website link |
| `booked` | Demo/closing call booked via Calendly |
| `hitl_ready` | Awaiting human approval |
| `closed` | Deal closed, payment pending |
| `paid` | Payment received via Stripe |
| `delivering` | Applying requested changes |
| `delivered` | Changes applied, domain connected |
| `rejected` | Lead declined or disqualified |

## Queue System

The queue system provides reliable, ordered processing:

- **Queues:** `verify`, `copywrite`, `build`, `seo`, `review`, `deploy`, `call`, `followup`, `close` (the list lives in `packages/api/src/types.ts` as `QUEUE_NAMES`)
- **States:** `active`, `paused` (stored in `system_config`)
- **Items:** each has `lead_id`, `queue_name`, `status`, `priority`

Queue processing is driven by cron jobs that poll for pending items. Items left in `processing` by a crash or restart are marked `failed` (immediately on startup, or after `QUEUE_STALE_MINUTES`) so they can be retried from the dashboard instead of blocking the queue.

### Human-in-the-Loop (HITL) Gates

Certain actions require human approval via the Telegram bot:

- **Pre-call approval** -- before making outbound calls
- **Deployment review** -- before deploying to production
- **Payment verification** -- before marking as paid

The Telegram bot provides inline keyboard buttons for approve/reject/skip.

## Agent Orchestration

Agents that need Claude Code (builder, delivery, SEO) use the orchestrator, which:

1. Creates a temporary working directory
2. Spawns a Claude Code subprocess with the task prompt
3. Captures output and files
4. Cleans up after completion

## Server-Sent Events (SSE)

The dashboard connects to the API via SSE for real-time updates:

- Agent activity (which agent is working on which lead)
- Queue status changes
- Pipeline progress
- Log entries

## Cron Jobs

Periodic tasks (`packages/api/src/lib/crons.ts`):

- Queue polling every 15s (process pending items, fail stale ones)
- Call outcome polling every 30s (intro and closing calls)
- Stripe payment checking every 60s (poll for completed sessions; the webhook is a faster path to the same `markLeadPaid`)
- Warm-lead monitoring every 60s
- Auto-fetch every 3.5 min: once a lead has reached the call stage, scout more of the last query, but only while fewer than `AUTO_FETCH_MAX_INFLIGHT` items are in flight and the verify queue is active

## System Diagram

```
                    +-------------------------------------------+
                    |            Dashboard (Vite)                |
                    |  Live office view | Agent activity         |
                    |  CEO inbox | Queue controls | HITL         |
                    +---------------------+---------------------+
                                          | SSE
                    +---------------------+---------------------+
                    |              API Server (Bun)              |
                    |                                            |
                    |  +--------+ +--------+ +----------+        |
                    |  | Scout  | |Verifier| |Copywriter|        |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |      |          |           |              |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |  |Builder | |Deployer| | Emailer  |        |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |      |          |           |              |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |  | Caller | |FollowUp| | Closer   |        |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |      |          |           |              |
                    |  +---+----+ +---+----+ +----+-----+        |
                    |  |  SEO   | |Reviewer| |Delivery  |        |
                    |  +--------+ +--------+ +----------+        |
                    |                                            |
                    |  Queue System | Cron Jobs | Telegram HITL  |
                    +--------+----------+-----------+------------+
                             |          |           |
                      +------+---+ +----+------+ +--+------+
                      | Supabase | |  Vercel   | | Bland.ai|
                      |   (DB)   | | (Deploy)  | | (Calls) |
                      +----------+ +-----------+ +---------+
```
