/**
 * Chainable Supabase mock supporting the fluent builder pattern.
 * All chains are "thenable" — they auto-resolve when awaited.
 */
import { mock } from 'bun:test'

// biome-ignore lint/suspicious/noExplicitAny: flexible row type for mock store
type Row = Record<string, any>

class MemoryStore {
  private tables: Record<string, Row[]> = {}

  _seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map(r => ({ ...r }))
  }

  _reset() {
    this.tables = {}
  }

  _get(table: string): Row[] {
    return this.tables[table] || []
  }

  _set(table: string, rows: Row[]) {
    this.tables[table] = rows
  }
}

export const store = new MemoryStore()

type Filter = { type: string; col: string; val: unknown }

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter(row =>
    filters.every(f => {
      switch (f.type) {
        case 'eq': return row[f.col] === f.val
        case 'neq': return row[f.col] !== f.val
        case 'in': return Array.isArray(f.val) && f.val.includes(row[f.col])
        case 'ilike': {
          const pattern = String(f.val).replace(/%/g, '.*')
          return new RegExp(pattern, 'i').test(String(row[f.col] || ''))
        }
        case 'gt': return String(row[f.col] || '') > String(f.val)
        default: return true
      }
    })
  )
}

function makeChain(
  table: string,
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
  payload?: Row | Row[],
) {
  const filters: Filter[] = []
  let _selectCols = '*'
  let orderCol: string | null = null
  let orderAsc = true
  let limitN: number | null = null
  let countMode: string | null = null
  let isHead = false
  let hasSelect = false

  function resolve(single = false): { data: any; error: any; count?: number } {
    let rows = store._get(table)

    if (op === 'select') {
      rows = applyFilters(rows, filters)
      if (countMode && isHead) {
        return { data: null, error: null, count: rows.length }
      }
      if (orderCol) {
        const col = orderCol
        rows.sort((a, b) => {
          if (a[col] === b[col]) return 0
          const cmp = String(a[col] || '') < String(b[col] || '') ? -1 : 1
          return orderAsc ? cmp : -cmp
        })
      }
      if (limitN !== null) rows = rows.slice(0, limitN)
      if (single) return { data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } }
      return { data: rows, error: null }
    }

    if (op === 'insert') {
      const newRows = (Array.isArray(payload) ? payload : [payload!]).map(r => ({
        id: r.id || crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...r,
      }))
      store._set(table, [...rows, ...newRows])
      if (!hasSelect) return { data: newRows, error: null }
      const filtered = applyFilters(newRows, filters)
      if (single) return { data: filtered[0] || null, error: null }
      return { data: filtered, error: null }
    }

    if (op === 'update') {
      const matched = applyFilters(rows, filters)
      const matchedIds = new Set(matched.map(r => r.id))
      const updated = rows.map(r =>
        matchedIds.has(r.id) ? { ...r, ...(payload as Row) } : r
      )
      store._set(table, updated)
      if (hasSelect) {
        const result = updated.filter(r => matchedIds.has(r.id))
        if (single) return { data: result[0] || null, error: null }
        return { data: result, error: null }
      }
      return { data: null, error: null }
    }

    if (op === 'delete') {
      const toKeep = rows.filter(r => applyFilters([r], filters).length === 0)
      const removed = rows.length - toKeep.length
      store._set(table, toKeep)
      return { data: null, error: null, count: removed }
    }

    if (op === 'upsert') {
      const newRows = Array.isArray(payload) ? payload : [payload!]
      for (const newRow of newRows) {
        const idx = rows.findIndex(r => r.key === newRow.key || r.id === newRow.id)
        if (idx >= 0) rows[idx] = { ...rows[idx], ...newRow }
        else rows.push({ id: crypto.randomUUID(), ...newRow })
      }
      store._set(table, rows)
      return { data: newRows, error: null }
    }

    return { data: null, error: null }
  }

  const chain: any = {
    select(cols?: string, opts?: { count?: string; head?: boolean }) {
      hasSelect = true
      if (cols) _selectCols = cols
      if (opts?.count) countMode = opts.count
      if (opts?.head) isHead = true
      return chain
    },
    eq(col: string, val: unknown) { filters.push({ type: 'eq', col, val }); return chain },
    neq(col: string, val: unknown) { filters.push({ type: 'neq', col, val }); return chain },
    in(col: string, val: unknown[]) { filters.push({ type: 'in', col, val }); return chain },
    ilike(col: string, val: string) { filters.push({ type: 'ilike', col, val }); return chain },
    gt(col: string, val: unknown) { filters.push({ type: 'gt', col, val }); return chain },
    order(col: string, opts?: { ascending?: boolean }) {
      orderCol = col
      orderAsc = opts?.ascending ?? true
      return chain
    },
    limit(n: number) { limitN = n; return chain },
    single() { return resolve(true) },
    // biome-ignore lint/suspicious/noThenProperty: Supabase returns thenable chains
    then(onFulfilled: any, onRejected?: any) {
      return Promise.resolve(resolve(false)).then(onFulfilled, onRejected)
    },
  }

  return chain
}

const supabaseProxy = {
  from(table: string) {
    return {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        const c = makeChain(table, 'select')
        return c.select(cols, opts)
      },
      insert(data: Row | Row[]) {
        return makeChain(table, 'insert', data)
      },
      update(data: Row) {
        return makeChain(table, 'update', data)
      },
      upsert(data: Row | Row[]) {
        return makeChain(table, 'upsert', data)
      },
      delete() {
        return makeChain(table, 'delete')
      },
    }
  },
}

export const mockSupabase = {
  supabase: supabaseProxy,
  getSupabase: () => supabaseProxy,
}

export function installSupabaseMock() {
  mock.module('../../lib/supabase', () => mockSupabase)
}
