import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { makeLead } from '../helpers/fixtures'

// We need a custom supabase mock for monitor since it uses .in() filter
// Mock supabase at the absolute module level
const mockStore: Record<string, any[]> = {}

function seedTable(table: string, rows: any[]) {
  mockStore[table] = [...rows]
}

function getTable(table: string): any[] {
  return mockStore[table] || []
}

function resetStore() {
  for (const key of Object.keys(mockStore)) {
    delete mockStore[key]
  }
}

// Create a supabase-like mock
const supabaseMock = {
  from(table: string) {
    return {
      select(_cols?: string, opts?: any) {
        const filters: any[] = []
        const chain: any = {
          eq: (col: string, val: any) => { filters.push({ type: 'eq', col, val }); return chain },
          in: (col: string, vals: any[]) => { filters.push({ type: 'in', col, vals }); return chain },
          order: () => chain,
          limit: () => chain,
          single() {
            const rows = applyFilters(getTable(table), filters)
            return { data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } }
          },
        }
        function resolve() {
          const rows = applyFilters(getTable(table), filters)
          if (opts?.count && opts?.head) return { data: null, error: null, count: rows.length }
          return { data: rows, error: null }
        }
        // biome-ignore lint/suspicious/noThenProperty: Supabase returns thenable chains
        chain.then = (resolve_: any, reject_: any) => {
          return Promise.resolve(resolve()).then(resolve_, reject_)
        }
        return chain
      },
      update(data: any) {
        const filters: any[] = []
        const chain: any = {
          eq: (col: string, val: any) => {
            filters.push({ type: 'eq', col, val })
            // Apply the update
            const rows = getTable(table)
            const updated = rows.map(r => {
              if (applyFilters([r], filters).length > 0) {
                return { ...r, ...data }
              }
              return r
            })
            mockStore[table] = updated
            return chain
          },
          select: () => chain,
          single: () => ({ data: null, error: null }),
        }
        return chain
      },
      insert: (data: any) => ({ data, error: null, select: () => ({ single: () => ({ data, error: null }) }) }),
      delete: () => ({ eq: () => ({ data: null, error: null }), neq: () => ({ data: null, error: null }) }),
    }
  }
}

function applyFilters(rows: any[], filters: any[]): any[] {
  return rows.filter(row =>
    filters.every(f => {
      if (f.type === 'eq') return row[f.col] === f.val
      if (f.type === 'in') return f.vals.includes(row[f.col])
      return true
    })
  )
}

// Mock the modules
mock.module('../../lib/supabase', () => ({
  supabase: supabaseMock,
  getSupabase: () => supabaseMock,
}))

mock.module('../../lib/telegram', () => ({
  notify: () => Promise.resolve(),
  notifyHITL: () => Promise.resolve(),
  notifyQueueApproval: () => Promise.resolve(),
}))

mock.module('../../lib/logger', () => ({
  agentLog: () => Promise.resolve(),
}))

describe('runMonitorAgent scoring', () => {
  beforeEach(() => {
    resetStore()
  })

  test('email_clicked + demo_booked → score ≥ 50 → promoted to hitl_ready', async () => {
    const lead = makeLead({
      status: 'emailed',
      email_clicked_at: new Date().toISOString(),
      demo_booked_at: new Date().toISOString(),
    })
    seedTable('leads', [lead])

    const { runMonitorAgent } = await import('../../agents/monitor')
    await runMonitorAgent()

    const updated = getTable('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('hitl_ready')
  })

  test('only email_opened → score = 20 → not promoted', async () => {
    const lead = makeLead({
      status: 'emailed',
      email_opened_at: new Date().toISOString(),
    })
    seedTable('leads', [lead])

    const { runMonitorAgent } = await import('../../agents/monitor')
    await runMonitorAgent()

    const updated = getTable('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('emailed') // Not changed
  })

  test('call_outcome interested + email_clicked → promoted', async () => {
    const lead = makeLead({
      status: 'called',
      call_outcome: 'interested',
      email_clicked_at: new Date().toISOString(),
    })
    seedTable('leads', [lead])

    const { runMonitorAgent } = await import('../../agents/monitor')
    await runMonitorAgent()

    const updated = getTable('leads').find(l => l.id === lead.id)
    expect(updated?.status).toBe('hitl_ready')
  })
})
