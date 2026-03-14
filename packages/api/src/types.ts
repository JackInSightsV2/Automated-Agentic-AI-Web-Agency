export type LeadStatus =
  | 'discovered'
  | 'verified'
  | 'copywriting'
  | 'briefed'
  | 'building'
  | 'queued_build'
  | 'built'
  | 'seo_optimizing'
  | 'seo_optimized'
  | 'reviewing'
  | 'reviewed'
  | 'queued_deploy'
  | 'deployed'
  | 'queued_call'
  | 'emailed'
  | 'called'
  | 'opened'
  | 'clicked'
  | 'booked'
  | 'closing_call'
  | 'spec_sent'
  | 'paid'
  | 'delivering'
  | 'delivered'
  | 'hitl_ready'
  | 'closed'
  | 'rejected'

export interface Lead {
  id: string
  name: string
  category: string | null
  address: string | null
  city: string
  phone: string | null
  email: string | null
  google_place_id: string | null
  google_rating: number | null
  google_review_count: number | null
  website_detected: string | null
  status: LeadStatus
  status_updated_at: string
  site_html: string | null
  site_prompt: string | null
  vercel_project_id: string | null
  vercel_deployment_url: string | null
  final_domain: string | null
  email_sent_at: string | null
  email_opened_at: string | null
  email_clicked_at: string | null
  bland_call_id: string | null
  call_initiated_at: string | null
  call_completed_at: string | null
  call_outcome: string | null
  demo_booked_at: string | null
  calendly_event_url: string | null
  pipeline_run_id: string | null
  error: string | null
  created_at: string
  updated_at: string
  viability_score: number | null
  viability_notes: string | null
  companies_house_status: string | null
  companies_house_number: string | null
  contact_name: string | null
  closing_call_id: string | null
  closing_call_at: string | null
  closing_summary: string | null
  desired_domain: string | null
  needs_domain: boolean | null
  needs_email_setup: boolean | null
  cta_type: string | null
  cta_value: string | null
  requested_changes: string | null
  stripe_payment_link: string | null
  paid_at: string | null
  total_price: number | null
  creative_brief: string | null
  review_attempts: number | null
  review_result: string | null
}

export interface PipelineRun {
  id: string
  query: string
  location: string
  leads_found: number
  leads_processed: number
  started_at: string
  completed_at: string | null
}

export interface AgentLog {
  id: string
  lead_id: string | null
  pipeline_run_id: string | null
  agent: string
  level: string
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type QueueName = 'verify' | 'copywrite' | 'build' | 'seo' | 'review' | 'deploy' | 'call' | 'followup' | 'close'

export type QueueItemStatus = 'pending' | 'pending_approval' | 'approved' | 'processing' | 'completed' | 'failed'

export interface QueueItem {
  id: string
  lead_id: string
  pipeline_run_id: string | null
  queue_name: QueueName
  priority: number
  scheduled_at: string | null
  status: QueueItemStatus
  attempts: number
  error: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface SystemConfig {
  key: string
  value: Record<string, unknown>
  updated_at: string
}

export interface BusinessHoursConfig {
  start: string
  end: string
  days: number[]
  timezone: string
}

export interface QueueStates {
  verify: 'active' | 'paused'
  copywrite: 'active' | 'paused'
  build: 'active' | 'paused'
  seo: 'active' | 'paused'
  review: 'active' | 'paused'
  deploy: 'active' | 'paused'
  call: 'active' | 'paused'
  followup: 'active' | 'paused'
  close: 'active' | 'paused'
}

export interface HITLConfig {
  verify: 'auto' | 'hitl'
  copywrite: 'auto' | 'hitl'
  build: 'auto' | 'hitl'
  seo: 'auto' | 'hitl'
  review: 'auto' | 'hitl'
  deploy: 'auto' | 'hitl'
  call: 'auto' | 'hitl'
  followup: 'auto' | 'hitl'
  close: 'auto' | 'hitl'
}

export interface ConcurrencyConfig {
  verify: number
  copywrite: number
  build: number
  seo: number
  review: number
  deploy: number
  call: number
  followup: number
  close: number
}
