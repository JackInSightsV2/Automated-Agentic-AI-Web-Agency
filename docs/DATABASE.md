# Database Schema

The system uses Supabase (PostgreSQL). The canonical schema lives in **[`supabase/schema.sql`](../supabase/schema.sql)** and mirrors the TypeScript types in `packages/api/src/types.ts`. Keep the two in sync when adding columns.

## Setup

**Fresh project:** open the Supabase SQL editor and run the whole of `supabase/schema.sql`. It is idempotent, so re-running it is safe.

**Project created from the old setup SQL** (you have tables called `queue` and `queue_state`): run `supabase/migrate-from-docs-v1.sql` instead. It renames the changed columns, adds the missing ones, moves any rows from `queue` into `queue_items`, and creates `system_config`.

Common errors that mean the schema is out of date:

| Error | Cause |
|-------|-------|
| `relation "queue_items" does not exist` | You ran the old SQL; the code uses `queue_items`, not `queue` |
| `there is no unique or exclusion constraint matching the ON CONFLICT specification` | `leads.google_place_id` is missing its `UNIQUE` constraint (scout upserts on it) |
| `column "google_place_id" of relation "leads" does not exist` (or `website_detected`, `bland_call_id`, ...) | `leads` is missing columns; run the migration |
| Queue pause / concurrency / HITL toggles do nothing | `system_config` rows are missing; the API updates them with `.update()` and never inserts |

## Tables

### `leads`

One row per business. Column set is the `Lead` interface in `types.ts`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Business name |
| `category` | text | Business type (from Google Places `types[0]`) |
| `address` | text | Formatted address |
| `city` | text | City (currently unused by scout, reserved) |
| `phone` | text | Business phone number |
| `email` | text | Business email |
| `google_place_id` | text **unique** | Google Places ID. Scout upserts `ON CONFLICT (google_place_id)` |
| `google_rating` | numeric | Google Maps rating |
| `google_review_count` | integer | Number of Google reviews |
| `website_detected` | text | Existing website URL, if scout found one |
| `status` | text | Current pipeline status (see `LeadStatus` in `types.ts`) |
| `status_updated_at` | timestamptz | When status last changed (set by code) |
| `site_html` | text | Built site HTML |
| `site_prompt` | text | Prompt used for the build |
| `vercel_project_id` | text | Vercel project identifier |
| `vercel_deployment_url` | text | Live preview URL |
| `final_domain` | text | Customer domain once connected |
| `email_sent_at` / `email_opened_at` / `email_clicked_at` | timestamptz | Outreach email tracking |
| `bland_call_id` | text | Bland.ai call ID for the first call |
| `call_initiated_at` / `call_completed_at` | timestamptz | First call timing |
| `call_outcome` | text | interested / not_interested / voicemail / no_answer |
| `demo_booked_at` | timestamptz | When Calendly booking happened |
| `calendly_event_url` | text | Calendly event URL |
| `pipeline_run_id` | uuid | FK to `pipeline_runs` |
| `error` | text | Last error message |
| `viability_score` | integer | Verifier score (0-100) |
| `viability_notes` | text | Verifier reasoning |
| `companies_house_status` / `companies_house_number` | text | Companies House lookup result |
| `contact_name` | text | Name of person spoken to |
| `closing_call_id` / `closing_call_at` / `closing_summary` | text / timestamptz / text | Closing call details |
| `desired_domain` | text | Domain the client asked for |
| `needs_domain` | boolean | Whether we register a domain for them |
| `needs_email_setup` | boolean | Whether they need professional email |
| `cta_type` / `cta_value` | text | Site call-to-action: phone or email_form, and its value |
| `requested_changes` | text | Changes requested during closing call |
| `stripe_payment_link` | text | Stripe payment link sent to client |
| `paid_at` | timestamptz | When payment was received |
| `total_price` | numeric | Amount charged |
| `creative_brief` | text | Copywriter output |
| `review_attempts` | integer | Failed code-review count (escalates to HITL at 3) |
| `review_result` | text | Last review output |
| `skip_to_deploy` | boolean | Set on post-payment change requests; build goes straight to deploy |
| `followup_call_id` | text | Bland.ai call ID for the follow-up call |
| `created_at` | timestamptz | When lead was discovered |
| `updated_at` | timestamptz | Maintained by trigger; dashboard orders by it |

### `queue_items`

Work items for the queue processor (`lib/queue.ts`, polled by `lib/crons.ts`).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `lead_id` | uuid | FK to `leads` (cascade delete) |
| `pipeline_run_id` | uuid | FK to `pipeline_runs` |
| `queue_name` | text | verify, copywrite, build, seo, review, deploy, call, followup, close |
| `priority` | integer | Higher = processed first |
| `scheduled_at` | timestamptz | Reserved for delayed items |
| `status` | text | pending, pending_approval, approved, processing, completed, failed |
| `attempts` | integer | Incremented on failure |
| `error` | text | Last failure message |
| `metadata` | jsonb | Extra context (review attempt, errors) |
| `created_at` / `updated_at` | timestamptz | Timestamps |

HITL queues insert as `pending_approval` and are moved to `approved` by the Telegram bot or `/admin/queue-items/:id/approve`.

### `agent_logs`

Activity log written by `agentLog()`; the dashboard SSE feed reads the latest rows.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `lead_id` | uuid | FK to `leads` (optional) |
| `pipeline_run_id` | uuid | FK to `pipeline_runs` (optional) |
| `agent` | text | Agent name (scout, builder, orchestrator, cron, ...) |
| `level` | text | info, success, warn, error |
| `message` | text | Log message |
| `metadata` | jsonb | Extra context |
| `created_at` | timestamptz | Timestamp |

### `pipeline_runs`

One row per scout batch.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `query` | text | Business type searched |
| `location` | text | Geographic target |
| `leads_found` | integer | Leads discovered by scout |
| `leads_processed` | integer | Leads processed |
| `started_at` | timestamptz | When started (code orders by this) |
| `completed_at` | timestamptz | When scouting finished |

### `system_config`

Runtime configuration as key/JSON pairs. Rows are seeded by the schema and **must exist**: the API updates them in place and does not insert.

| Key | Value shape |
|-----|-------------|
| `queue_states` | `{ [queueName]: "active" \| "paused" }` |
| `hitl_config` | `{ [queueName]: "auto" \| "hitl" }` (defaults: call and close are `hitl`) |
| `concurrency` | `{ [queueName]: number }` max parallel workers per queue |
| `business_hours` | `{ start, end, days: number[], timezone }` applied to call and close queues |
| `worker_names` | `{ [workerKey]: displayName }` dashboard labels |

Edit via the dashboard config panel, the Telegram bot, or `POST /admin/config`.
