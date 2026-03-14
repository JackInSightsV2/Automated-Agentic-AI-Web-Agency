# Database Schema

The system uses Supabase (PostgreSQL) with the following tables.

## Tables

### `leads`

The main table tracking every business through the pipeline.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Business name |
| `category` | text | Business type (e.g. "plumber", "bakery") |
| `address` | text | Business address |
| `phone` | text | Business phone number |
| `email` | text | Business email |
| `contact_name` | text | Name of person spoken to |
| `status` | text | Current pipeline status |
| `status_updated_at` | timestamptz | When status last changed |
| `google_rating` | numeric | Google Maps rating |
| `google_review_count` | integer | Number of Google reviews |
| `viability_score` | integer | Lead quality score |
| `creative_brief` | jsonb | Copywriter output (brand voice, colors, content) |
| `vercel_deployment_url` | text | Live preview URL |
| `vercel_project_id` | text | Vercel project identifier |
| `email_sent_at` | timestamptz | When outreach email was sent |
| `call_id` | text | Bland.ai call ID |
| `call_completed_at` | timestamptz | When call finished |
| `call_outcome` | text | interested / not_interested / voicemail / no_answer |
| `demo_booked_at` | timestamptz | When Calendly booking happened |
| `calendly_event_url` | text | Calendly event URL |
| `stripe_session_id` | text | Stripe checkout session ID |
| `paid_at` | timestamptz | When payment was received |
| `amount_paid` | numeric | Amount paid |
| `domain` | text | Customer domain name |
| `needs_domain` | boolean | Whether they need domain registration |
| `needs_email` | boolean | Whether they need email setup |
| `cta_type` | text | phone or email_form |
| `cta_value` | text | Phone number or email for CTA |
| `requested_changes` | text | Changes requested during closing call |
| `error` | text | Last error message |
| `pipeline_run_id` | uuid | FK to pipeline_runs |
| `created_at` | timestamptz | When lead was discovered |

### `queue`

Queue items for ordered processing.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `lead_id` | uuid | FK to leads |
| `queue_name` | text | verify, build, deploy, call, followup, close |
| `status` | text | pending, processing, completed, failed |
| `priority` | integer | Lower = higher priority |
| `metadata` | jsonb | Extra context (retry counts, errors) |
| `pipeline_run_id` | uuid | FK to pipeline_runs |
| `created_at` | timestamptz | When queued |
| `started_at` | timestamptz | When processing began |
| `completed_at` | timestamptz | When finished |

### `agent_logs`

Activity log for all agent actions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `agent` | text | Agent name (scout, builder, caller, etc.) |
| `message` | text | Log message |
| `level` | text | info, success, warn, error |
| `lead_id` | uuid | FK to leads (optional) |
| `metadata` | jsonb | Extra context |
| `pipeline_run_id` | uuid | FK to pipeline_runs |
| `created_at` | timestamptz | Timestamp |

### `pipeline_runs`

Tracks batch pipeline executions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `query` | text | Search query used |
| `location` | text | Geographic target |
| `status` | text | running, completed, failed |
| `leads_found` | integer | Number of leads discovered |
| `created_at` | timestamptz | When started |
| `completed_at` | timestamptz | When finished |

### `queue_state`

Tracks whether each queue is active or paused.

| Column | Type | Description |
|--------|------|-------------|
| `queue_name` | text | Primary key |
| `state` | text | active or paused |
| `updated_at` | timestamptz | Last state change |

## Setup SQL

Run this in your Supabase SQL editor to create the schema:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Pipeline runs
CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query TEXT,
  location TEXT,
  status TEXT DEFAULT 'running',
  leads_found INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  category TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  contact_name TEXT,
  status TEXT DEFAULT 'discovered',
  status_updated_at TIMESTAMPTZ DEFAULT NOW(),
  google_rating NUMERIC,
  google_review_count INTEGER,
  viability_score INTEGER,
  creative_brief JSONB,
  vercel_deployment_url TEXT,
  vercel_project_id TEXT,
  email_sent_at TIMESTAMPTZ,
  call_id TEXT,
  call_completed_at TIMESTAMPTZ,
  call_outcome TEXT,
  demo_booked_at TIMESTAMPTZ,
  calendly_event_url TEXT,
  stripe_session_id TEXT,
  paid_at TIMESTAMPTZ,
  amount_paid NUMERIC,
  domain TEXT,
  needs_domain BOOLEAN DEFAULT FALSE,
  needs_email BOOLEAN DEFAULT FALSE,
  cta_type TEXT,
  cta_value TEXT,
  requested_changes TEXT,
  error TEXT,
  pipeline_run_id UUID REFERENCES pipeline_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Queue
CREATE TABLE queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id),
  queue_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  pipeline_run_id UUID REFERENCES pipeline_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Agent logs
CREATE TABLE agent_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent TEXT NOT NULL,
  message TEXT NOT NULL,
  level TEXT DEFAULT 'info',
  lead_id UUID REFERENCES leads(id),
  metadata JSONB DEFAULT '{}',
  pipeline_run_id UUID REFERENCES pipeline_runs(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Queue state
CREATE TABLE queue_state (
  queue_name TEXT PRIMARY KEY,
  state TEXT DEFAULT 'active',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize queue states
INSERT INTO queue_state (queue_name, state) VALUES
  ('verify', 'active'),
  ('build', 'active'),
  ('deploy', 'active'),
  ('call', 'active'),
  ('followup', 'active'),
  ('close', 'active');

-- Indexes
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_pipeline_run ON leads(pipeline_run_id);
CREATE INDEX idx_queue_name_status ON queue(queue_name, status);
CREATE INDEX idx_queue_lead ON queue(lead_id);
CREATE INDEX idx_logs_agent ON agent_logs(agent);
CREATE INDEX idx_logs_lead ON agent_logs(lead_id);
CREATE INDEX idx_logs_created ON agent_logs(created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE queue;
ALTER PUBLICATION supabase_realtime ADD TABLE agent_logs;
```
