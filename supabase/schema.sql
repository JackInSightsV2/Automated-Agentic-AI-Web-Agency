-- ══════════════════════════════════════════════════════════════
-- Automated Agentic AI Web Agency — Supabase schema
-- ══════════════════════════════════════════════════════════════
-- Canonical schema. Matches packages/api/src/types.ts and every
-- .from('<table>') call in packages/api/src.
--
-- Fresh project: paste this whole file into the Supabase SQL editor.
-- Existing project created from the old docs SQL (tables `queue` and
-- `queue_state`): run supabase/migrate-from-docs-v1.sql instead.
--
-- Safe to re-run: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── pipeline_runs ─────────────────────────────────────────────
-- One row per scout batch. Code orders by started_at, not created_at.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query           TEXT,
  location        TEXT,
  leads_found     INTEGER DEFAULT 0,
  leads_processed INTEGER DEFAULT 0,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- ── leads ─────────────────────────────────────────────────────
-- Column set mirrors the Lead interface in packages/api/src/types.ts.
CREATE TABLE IF NOT EXISTS leads (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   TEXT NOT NULL,
  category               TEXT,
  address                TEXT,
  city                   TEXT,
  phone                  TEXT,
  email                  TEXT,
  google_place_id        TEXT UNIQUE,          -- scout upserts ON CONFLICT (google_place_id)
  google_rating          NUMERIC,
  google_review_count    INTEGER,
  website_detected       TEXT,
  status                 TEXT NOT NULL DEFAULT 'discovered',
  status_updated_at      TIMESTAMPTZ DEFAULT NOW(),
  site_html              TEXT,
  site_prompt            TEXT,
  vercel_project_id      TEXT,
  vercel_deployment_url  TEXT,
  final_domain           TEXT,
  email_sent_at          TIMESTAMPTZ,
  email_opened_at        TIMESTAMPTZ,
  email_clicked_at       TIMESTAMPTZ,
  bland_call_id          TEXT,
  call_initiated_at      TIMESTAMPTZ,
  call_completed_at      TIMESTAMPTZ,
  call_outcome           TEXT,
  demo_booked_at         TIMESTAMPTZ,
  calendly_event_url     TEXT,
  pipeline_run_id        UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  error                  TEXT,
  viability_score        INTEGER,
  viability_notes        TEXT,
  companies_house_status TEXT,
  companies_house_number TEXT,
  contact_name           TEXT,
  closing_call_id        TEXT,
  closing_call_at        TIMESTAMPTZ,
  closing_summary        TEXT,
  desired_domain         TEXT,
  needs_domain           BOOLEAN,
  needs_email_setup      BOOLEAN,
  cta_type               TEXT,
  cta_value              TEXT,
  requested_changes      TEXT,
  stripe_payment_link    TEXT,
  paid_at                TIMESTAMPTZ,
  total_price            NUMERIC,
  creative_brief         TEXT,
  review_attempts        INTEGER DEFAULT 0,
  review_result          TEXT,
  skip_to_deploy         BOOLEAN DEFAULT FALSE,
  followup_call_id       TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ── queue_items ───────────────────────────────────────────────
-- status: pending | pending_approval | approved | processing | completed | failed
-- queue_name: verify | copywrite | build | seo | review | deploy | call | followup | close
CREATE TABLE IF NOT EXISTS queue_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  queue_name      TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 0,
  scheduled_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── agent_logs ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE,
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  agent           TEXT NOT NULL,
  level           TEXT NOT NULL DEFAULT 'info',
  message         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── system_config ─────────────────────────────────────────────
-- Runtime config read by lib/queue.ts, lib/telegram.ts, routes/admin.ts.
-- The API updates these rows with .update(), so they must exist.
CREATE TABLE IF NOT EXISTS system_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_config (key, value) VALUES
  ('queue_states',   '{"verify":"active","copywrite":"active","build":"active","seo":"active","review":"active","deploy":"active","call":"active","followup":"active","close":"active"}'),
  ('hitl_config',    '{"verify":"auto","copywrite":"auto","build":"auto","seo":"auto","review":"auto","deploy":"auto","call":"hitl","followup":"auto","close":"hitl"}'),
  ('concurrency',    '{"verify":1,"copywrite":1,"build":1,"seo":1,"review":1,"deploy":1,"call":1,"followup":1,"close":1}'),
  ('business_hours', '{"start":"09:00","end":"17:00","days":[1,2,3,4,5],"timezone":"Europe/London"}'),
  ('worker_names',   '{}')
ON CONFLICT (key) DO NOTHING;

-- ── updated_at trigger ────────────────────────────────────────
-- leads.updated_at is read by the dashboard SSE feed but never written by code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_set_updated_at ON leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS queue_items_set_updated_at ON queue_items;
CREATE TRIGGER queue_items_set_updated_at
  BEFORE UPDATE ON queue_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_status            ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_run      ON leads(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at        ON leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_items_name_status ON queue_items(queue_name, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_items_lead        ON queue_items(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_agent        ON agent_logs(agent);
CREATE INDEX IF NOT EXISTS idx_agent_logs_lead         ON agent_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created      ON agent_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started   ON pipeline_runs(started_at DESC);

-- ── realtime (optional; API uses polling + SSE, not Supabase realtime) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE leads;       EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE queue_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE agent_logs;  EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
