import { supabase } from './supabase'
import type { QueueItem, QueueName, BusinessHoursConfig, HITLConfig, QueueStates, ConcurrencyConfig } from '../types'

export async function enqueue(opts: {
  leadId: string
  queueName: QueueName
  pipelineRunId?: string
  priority?: number
  metadata?: Record<string, unknown>
}): Promise<string> {
  const hitlConfig = await getHITLConfig()
  const isHITL = hitlConfig[opts.queueName] === 'hitl'

  const { data, error } = await supabase
    .from('queue_items')
    .insert({
      lead_id: opts.leadId,
      queue_name: opts.queueName,
      pipeline_run_id: opts.pipelineRunId || null,
      priority: opts.priority || 0,
      status: isHITL ? 'pending_approval' : 'pending',
      metadata: opts.metadata || null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to enqueue: ${error.message}`)

  // If HITL, fire notification (imported lazily to avoid circular deps)
  if (isHITL) {
    const { notifyQueueApproval } = await import('./telegram')
    const { data: lead } = await supabase.from('leads').select('*').eq('id', opts.leadId).single()
    if (lead) {
      await notifyQueueApproval({ id: data.id, queue_name: opts.queueName } as QueueItem, lead)
    }
  }

  return data.id
}

export async function dequeue(queueName: QueueName): Promise<QueueItem | null> {
  // Check concurrency limit
  const maxWorkers = await getConcurrency(queueName)
  const currentWorkers = await getProcessingCount(queueName)
  if (currentWorkers >= maxWorkers) return null

  // HITL queues only pick up 'approved', auto queues pick up 'pending'
  const hitlConfig = await getHITLConfig()
  const statusFilter = hitlConfig[queueName] === 'hitl' ? 'approved' : 'pending'

  const { data, error } = await supabase
    .from('queue_items')
    .select('*')
    .eq('queue_name', queueName)
    .eq('status', statusFilter)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (error || !data) return null

  // Mark as processing
  await supabase
    .from('queue_items')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', data.id)

  return data as QueueItem
}

export async function completeItem(itemId: string): Promise<void> {
  await supabase
    .from('queue_items')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', itemId)
}

export async function failItem(itemId: string, error: string): Promise<void> {
  const { data } = await supabase
    .from('queue_items')
    .select('attempts')
    .eq('id', itemId)
    .single()

  await supabase
    .from('queue_items')
    .update({
      status: 'failed',
      error,
      attempts: (data?.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
}

export async function isWithinBusinessHours(): Promise<boolean> {
  const config = await getBusinessHours()
  const now = new Date()

  // Get current time in configured timezone
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const dayFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    weekday: 'short',
  })

  const timeStr = formatter.format(now) // "09:30"
  const dayStr = dayFormatter.format(now)
  const dayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }
  const dayNum = dayMap[dayStr] ?? now.getDay()

  if (!config.days.includes(dayNum)) return false

  const [startH, startM] = config.start.split(':').map(Number)
  const [endH, endM] = config.end.split(':').map(Number)
  const [nowH, nowM] = timeStr.split(':').map(Number)

  const nowMins = nowH * 60 + nowM
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM

  return nowMins >= startMins && nowMins < endMins
}

export async function isQueueActive(queueName: QueueName): Promise<boolean> {
  const states = await getQueueStates()
  return states[queueName] === 'active'
}

export async function setQueueState(queueName: QueueName, state: 'active' | 'paused'): Promise<void> {
  const states = await getQueueStates()
  states[queueName] = state
  await supabase
    .from('system_config')
    .update({ value: states, updated_at: new Date().toISOString() })
    .eq('key', 'queue_states')
}

export async function getQueueStats(): Promise<Record<QueueName, { pending: number; processing: number; failed: number; pending_approval: number }>> {
  const queues: QueueName[] = ['verify', 'copywrite', 'build', 'seo', 'review', 'deploy', 'call', 'followup', 'close']
  const result = {} as Record<QueueName, { pending: number; processing: number; failed: number; pending_approval: number }>

  for (const q of queues) {
    const { count: pending } = await supabase
      .from('queue_items').select('*', { count: 'exact', head: true })
      .eq('queue_name', q).eq('status', 'pending')
    const { count: processing } = await supabase
      .from('queue_items').select('*', { count: 'exact', head: true })
      .eq('queue_name', q).eq('status', 'processing')
    const { count: failed } = await supabase
      .from('queue_items').select('*', { count: 'exact', head: true })
      .eq('queue_name', q).eq('status', 'failed')
    const { count: pending_approval } = await supabase
      .from('queue_items').select('*', { count: 'exact', head: true })
      .eq('queue_name', q).eq('status', 'pending_approval')

    result[q] = {
      pending: pending || 0,
      processing: processing || 0,
      failed: failed || 0,
      pending_approval: pending_approval || 0,
    }
  }

  return result
}

export async function getConcurrency(queueName: QueueName): Promise<number> {
  const { data } = await supabase.from('system_config').select('value').eq('key', 'concurrency').single()
  const config = (data?.value || { verify: 1, copywrite: 1, build: 1, seo: 1, review: 1, deploy: 1, call: 1, followup: 1, close: 1 }) as ConcurrencyConfig
  return config[queueName] || 1
}

export async function setConcurrency(queueName: QueueName, max: number): Promise<void> {
  const { data } = await supabase.from('system_config').select('value').eq('key', 'concurrency').single()
  const config = (data?.value || {}) as Record<string, number>
  config[queueName] = max
  await supabase
    .from('system_config')
    .update({ value: config, updated_at: new Date().toISOString() })
    .eq('key', 'concurrency')
}

export async function getProcessingCount(queueName: QueueName): Promise<number> {
  const { count } = await supabase
    .from('queue_items')
    .select('*', { count: 'exact', head: true })
    .eq('queue_name', queueName)
    .eq('status', 'processing')
  return count || 0
}

// Config helpers
async function getBusinessHours(): Promise<BusinessHoursConfig> {
  const { data } = await supabase.from('system_config').select('value').eq('key', 'business_hours').single()
  return (data?.value as unknown as BusinessHoursConfig) || { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], timezone: 'Europe/London' }
}

async function getHITLConfig(): Promise<HITLConfig> {
  const defaults: HITLConfig = { verify: 'auto', copywrite: 'auto', build: 'auto', seo: 'auto', review: 'auto', deploy: 'auto', call: 'hitl', followup: 'auto', close: 'hitl' }
  const { data } = await supabase.from('system_config').select('value').eq('key', 'hitl_config').single()
  return { ...defaults, ...(data?.value as unknown as Partial<HITLConfig>) }
}

async function getQueueStates(): Promise<QueueStates> {
  const defaults: QueueStates = { verify: 'active', copywrite: 'active', build: 'active', seo: 'active', review: 'active', deploy: 'active', call: 'active', followup: 'active', close: 'active' }
  const { data } = await supabase.from('system_config').select('value').eq('key', 'queue_states').single()
  return { ...defaults, ...(data?.value as unknown as Partial<QueueStates>) }
}

async function getConcurrencyConfig(): Promise<ConcurrencyConfig> {
  const defaults: ConcurrencyConfig = { verify: 1, copywrite: 1, build: 1, seo: 1, review: 1, deploy: 1, call: 1, followup: 1, close: 1 }
  const { data } = await supabase.from('system_config').select('value').eq('key', 'concurrency').single()
  return { ...defaults, ...(data?.value as unknown as Partial<ConcurrencyConfig>) }
}

export { getBusinessHours, getHITLConfig, getQueueStates, getConcurrencyConfig }
