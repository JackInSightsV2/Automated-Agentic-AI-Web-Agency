/**
 * Thin Bland.ai client shared by the caller, follow-up, and closer agents.
 *
 * `analysis_schema` asks Bland to return structured fields after the call
 * (available as `analysis` on GET /v1/calls/:id). Agents prefer those fields
 * and fall back to transcript/summary regexes when Bland does not return them.
 */
import { fetchWithRetry } from './fetch-retry'

export interface BlandCall {
  call_id?: string
  status?: string
  completed?: boolean
  queue_status?: string
  answered_by?: string
  summary?: string
  transcripts?: Array<{ user: string; text: string }>
  analysis?: Record<string, unknown> | null
  error_message?: string | null
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

/** Calls that never connected (Bland-side failure) so we do not wait on them forever. */
export function isCallFailed(call: BlandCall): boolean {
  return call.status === 'failed' || call.status === 'error' || !!call.error_message
}
