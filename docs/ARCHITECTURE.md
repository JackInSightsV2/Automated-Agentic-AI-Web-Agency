# Architecture

## Overview

The system is a monorepo with three main components:

- **`packages/api/`** -- Bun/Hono API server with 15 AI agents
- **`apps/dashboard/`** -- Vite vanilla JS dashboard with live office view
- **`site/`** -- Vite marketing website

## Pipeline Flow

```
Scout -> Verify -> Copywrite -> Build -> Review -> Deploy -> Email -> Call -> Follow-up -> Close -> Deliver
```

Each step is handled by a specialized agent and connected via a queue system.

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

- **Queues:** `verify`, `build`, `deploy`, `call`, `followup`, `close`
- **States:** `active`, `paused`
- **Items:** each has `lead_id`, `queue_name`, `status`, `priority`

Queue processing is driven by cron jobs that poll for pending items.

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

Periodic tasks:

- Queue polling (process pending items)
- Stripe payment checking (poll for completed sessions)
- Pipeline monitoring (detect stalled leads)

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
