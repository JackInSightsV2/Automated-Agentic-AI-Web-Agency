/**
 * Thin Bland.ai client shared by the caller, follow-up, and closer agents.
 *
 * Post-call structure comes from Bland's documented mechanisms:
 * - `dispositions`: a list of outcome tags we pass on send; after the call
 *   Bland picks one from the transcript and returns it as `disposition_tag`.
 * - `summary_prompt`: instructions for the generated `summary`.
 * - `answered_by`: "human" | "voicemail" | "no-answer" | "unknown".
 * Agents use these first and fall back to transcript/summary regexes.
 */
import { fetchWithRetry } from './fetch-retry'

export interface BlandCall {
  call_id?: string
  status?: string          // completed | failed | busy | no-answer | canceled | unknown | in-progress | queued
  completed?: boolean
  queue_status?: string
  answered_by?: string | null
  disposition_tag?: string | null
  summary?: string
  transcripts?: Array<{ user: string; text: string }>
  analysis?: Record<string, unknown> | null
  variables?: Record<string, unknown> | null
  error_message?: string | null
}

/** Signals that describe how a finished call went, in order of trust. */
export interface CallSignals {
  disposition_tag?: string | null
  answered_by?: string | null
  status?: string | null
  analysis?: Record<string, unknown> | null
}

export function callSignals(call: BlandCall): CallSignals {
  return { disposition_tag: call.disposition_tag, answered_by: call.answered_by, status: call.status, analysis: call.analysis }
}

function apiKey(): string {
  const key = process.env.BLAND_AI_API_KEY
  if (!key) throw new Error('BLAND_AI_API_KEY must be set')
  return key
}

export async function startCall(payload: Record<string, unknown>): Promise<string> {
  const res = await fetchWithRetry('https://api.bland.ai/v1/calls', {
    method: 'POST',
    headers: { Authorization: apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice: 'nat',
      language: 'en-GB',
      record: true,
      noise_cancellation: true,
      ...payload,
    }),
  })
  const data = await res.json() as { call_id?: string; status?: string; message?: string }
  if (!data.call_id) throw new Error(`Bland call failed: ${JSON.stringify(data)}`)
  return data.call_id
}

export async function getCall(callId: string): Promise<BlandCall> {
  const res = await fetchWithRetry(`https://api.bland.ai/v1/calls/${callId}`, {
    headers: { Authorization: apiKey() },
  })
  return await res.json() as BlandCall
}

/** Bland reports completion via `completed: true` and/or `status: 'completed'`. */
export function isCallFinished(call: BlandCall): boolean {
  return call.completed === true || call.status === 'completed'
}

const FAILED_STATUSES = new Set(['failed', 'error', 'busy', 'no-answer', 'canceled', 'cancelled'])

/** Calls that ended without a conversation (Bland-side) so we do not wait on them forever. */
export function isCallFailed(call: BlandCall): boolean {
  return (!!call.status && FAILED_STATUSES.has(call.status)) || !!call.error_message
}
