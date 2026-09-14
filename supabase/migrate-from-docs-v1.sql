-- ══════════════════════════════════════════════════════════════
-- Migration: old docs/DATABASE.md schema  ->  supabase/schema.sql
-- ══════════════════════════════════════════════════════════════
-- Only for projects that ran the ORIGINAL setup SQL (which created
-- `queue` and `queue_state` tables and a smaller `leads` table).
-- Fresh projects should run supabase/schema.sql instead.
--
-- Safe to re-run. Existing lead rows are preserved; old column names
-- are renamed where the code changed them.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── pipeline_runs ─────────────────────────────────────────────
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS leads_processed INTEGER DEFAULT 0;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ DEFAULT NOW();
UPDATE pipeline_runs SET started_at = created_at WHERE started_at IS NULL AND created_at IS NOT NULL;

-- ── leads: rename columns the code now calls something else ───
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='call_id') THEN
    ALTER TABLE leads RENAME COLUMN call_id TO bland_call_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='needs_email') THEN
    ALTER TABLE leads RENAME COLUMN needs_email TO needs_email_setup;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='domain') THEN
    ALTER TABLE leads RENAME COLUMN domain TO desired_domain;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='amount_paid') THEN
    ALTER TABLE leads RENAME COLUMN amount_paid TO total_price;
  END IF;
END $$;

-- ── leads: add every column the code reads or writes ──────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city                   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_place_id        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website_detected       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS site_html              TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS site_prompt            TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS final_domain           TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_opened_at        TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_clicked_at       TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bland_call_id          TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_initiated_at      TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS viability_notes        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS companies_house_status TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS companies_house_number TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closing_call_id        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closing_call_at        TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closing_summary        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS desired_domain         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS needs_email_setup      BOOLEAN;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stripe_payment_link    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_price            NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_attempts        INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_result          TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS skip_to_deploy         BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_call_id       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT NOW();

-- creative_brief was JSONB in the old schema; code stores a string.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='leads' AND column_name='creative_brief' AND data_type='jsonb') THEN
    ALTER TABLE leads ALTER COLUMN creative_brief TYPE TEXT USING creative_brief::text;
  END IF;
END $$;

-- Unique constraint required by scout's upsert ON CONFLICT (google_place_id)
CREATE UNIQUE INDEX IF NOT EXISTS leads_google_place_id_key ON leads(google_place_id);

-- ── queue_items (replaces `queue`) ────────────────────────────
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

-- Copy any rows from the old `queue` table, then drop it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='queue') THEN
    INSERT INTO queue_items (id, lead_id, pipeline_run_id, queue_name, priority, status, metadata, created_at)
    SELECT id, lead_id, pipeline_run_id, queue_name, priority, status, metadata, created_at
    FROM queue
    WHERE lead_id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;
    DROP TABLE queue;
  END IF;
END $$;

-- ── system_config (replaces `queue_state`) ────────────────────
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

DROP TABLE IF EXISTS queue_state;

-- ── triggers + indexes (same as schema.sql) ───────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_set_updated_at ON leads;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS queue_items_set_updated_at ON queue_items;
CREATE TRIGGER queue_items_set_updated_at BEFORE UPDATE ON queue_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_leads_updated_at        ON leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_items_name_status ON queue_items(queue_name, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_items_lead        ON queue_items(lead_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started   ON pipeline_runs(started_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE queue_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
