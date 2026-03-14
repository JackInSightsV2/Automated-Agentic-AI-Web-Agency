import { supabase } from './supabase'

export async function agentLog(
  agent: string,
  message: string,
  opts: { leadId?: string; runId?: string; level?: string; metadata?: unknown } = {}
) {
  await supabase.from('agent_logs').insert({
    agent,
    message,
    lead_id: opts.leadId || null,
    pipeline_run_id: opts.runId || null,
    level: opts.level || 'info',
    metadata: opts.metadata || null
  })
  console.log(`[${agent.toUpperCase()}] ${message}`)
}
