import { supabase } from './supabase'
import { QUEUE_NAMES } from '../types'
import type { QueueItem, QueueName, BusinessHoursConfig, HITLConfig, QueueStates, ConcurrencyConfig } from '../types'

// ── system_config cache ──────────────────────────────────────────────
// The SSE stream and the queue cron read the same handful of config rows
// many times per second. Cache them briefly; writes invalidate.

const CONFIG_TTL_MS = 2000
const configCache = new Map<string, { value: unknown; at: number }>()

export function clearConfigCache() {
  configCache.clear()
}

async function getConfigValue<T>(key: string): Promise<T | null> {
  const hit = configCache.get(key)
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.value as T | null
  const { data } = await supabase.from('system_config').select('value').eq('key', key).single()
  const value = (data?.value ?? null) as T | null
  configCache.set(key, { value, at: Date.now() })
  return value
}

async function setConfigValue(key: string, value: unknown) {
  configCache.delete(key)
  await supabase
    .from('system_config')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
}

// ── enqueue / dequeue ────────────────────────────────────────────────

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

  // Atomically mark as processing — only if still in the expected status
  // This prevents race conditions where two workers pick up the same item
  const { data: updated, error: updateError } = await supabase
    .from('queue_items')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', data.id)
    .eq('status', statusFilter)
    .select()
    .single()

  if (updateError || !updated) return null // Already picked up by another worker

  return updated as QueueItem
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

/**
 * Items left in `processing` are never picked up again and hold a concurrency
 * slot forever. This happens when the server restarts mid-job or a handler hangs.
 *
 * - `maxAgeMs = 0` (startup): every processing item is dead, fail them all.
 * - otherwise: fail items whose `updated_at` is older than `maxAgeMs`.
 *
 * Failed items appear in the dashboard with a Retry button, which resets the
 * lead status and re-enqueues, so nothing is lost.
 */
export async function recoverStaleItems(maxAgeMs: number): Promise<QueueItem[]> {
  const { data } = await supabase
    .from('queue_items')
    .select('*')
    .eq('status', 'processing')

  const cutoff = Date.now() - maxAgeMs
  const stale = ((data || []) as QueueItem[]).filter(item =>
    maxAgeMs === 0 || new Date(item.updated_at).getTime() <= cutoff
  )

  for (const item of stale) {
    const reason = maxAgeMs === 0
      ? 'Server restarted while item was processing'
      : `Stale: processing for more than ${Math.round(maxAgeMs / 60000)} minutes`
    const { data: updated } = await supabase
      .from('queue_items')
      .update({ status: 'failed', error: reason, updated_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'processing')
      .select('id')
      .single()
    if (!updated) continue // Finished between our read and write
  }

  return stale
}

// ── business hours / queue state ─────────────────────────────────────

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
  await setConfigValue('queue_states', states)
}

// ── stats ────────────────────────────────────────────────────────────

export type QueueStat = { pending: number; processing: number; failed: number; pending_approval: number }

const COUNTED_STATUSES = ['pending', 'processing', 'failed', 'pending_approval'] as const

/** One query for every queue's live counts (was 4 count queries per queue). */
export async function getQueueStats(): Promise<Record<QueueName, QueueStat>> {
  const result = {} as Record<QueueName, QueueStat>
  for (const q of QUEUE_NAMES) {
    result[q] = { pending: 0, processing: 0, failed: 0, pending_approval: 0 }
  }

  const { data } = await supabase
    .from('queue_items')
    .select('queue_name, status')
    .in('status', [...COUNTED_STATUSES])

  for (const row of (data || []) as Array<{ queue_name: string; status: string }>) {
    const stat = result[row.queue_name as QueueName]
    if (!stat) continue
    if ((COUNTED_STATUSES as readonly string[]).includes(row.status)) {
      stat[row.status as keyof QueueStat]++
    }
  }

  return result
}

export async function getConcurrency(queueName: QueueName): Promise<number> {
  const config = await getConcurrencyConfig()
  return config[queueName] || 1
}

export async function setConcurrency(queueName: QueueName, max: number): Promise<void> {
  const config = await getConcurrencyConfig()
  config[queueName] = max
  await setConfigValue('concurrency', config)
}

export async function getProcessingCount(queueName: QueueName): Promise<number> {
  const { count } = await supabase
    .from('queue_items')
    .select('*', { count: 'exact', head: true })
    .eq('queue_name', queueName)
    .eq('status', 'processing')
  return count || 0
}

// ── config helpers ───────────────────────────────────────────────────

function defaultsFor<T>(value: T): Record<QueueName, T> {
  const out = {} as Record<QueueName, T>
  for (const q of QUEUE_NAMES) out[q] = value
  return out
}

async function getBusinessHours(): Promise<BusinessHoursConfig> {
  const value = await getConfigValue<BusinessHoursConfig>('business_hours')
  return value || { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5], timezone: 'Europe/London' }
}

async function getHITLConfig(): Promise<HITLConfig> {
  const defaults: HITLConfig = { ...defaultsFor<'auto' | 'hitl'>('auto'), call: 'hitl', close: 'hitl' }
  const value = await getConfigValue<Partial<HITLConfig>>('hitl_config')
  return { ...defaults, ...value }
}

async function getQueueStates(): Promise<QueueStates> {
  const value = await getConfigValue<Partial<QueueStates>>('queue_states')
  return { ...defaultsFor<'active' | 'paused'>('active'), ...value }
}

async function getConcurrencyConfig(): Promise<ConcurrencyConfig> {
  const value = await getConfigValue<Partial<ConcurrencyConfig>>('concurrency')
  return { ...defaultsFor(1), ...value }
}

async function getWorkerNames(): Promise<Record<string, string>> {
  const value = await getConfigValue<Record<string, string>>('worker_names')
  return value || {}
}

export { getBusinessHours, getHITLConfig, getQueueStates, getConcurrencyConfig, getWorkerNames }
