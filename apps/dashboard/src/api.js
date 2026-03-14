const API_BASE = '/admin'

async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  return res.json()
}

async function pipelineRequest(path, opts = {}) {
  const res = await fetch(`/pipeline${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  return res.json()
}

export const api = {
  getQueues: () => request('/queues'),
  pauseQueue: (name) => request(`/queues/${name}/pause`, { method: 'POST' }),
  resumeQueue: (name) => request(`/queues/${name}/resume`, { method: 'POST' }),
  getLeads: (status, limit = 50) => request(`/leads?${status ? `status=${status}&` : ''}limit=${limit}`),
  getLead: (id) => request(`/leads/${id}`),
  getConfig: () => request('/config'),
  updateConfig: (key, value) => request('/config', { method: 'POST', body: JSON.stringify({ key, value }) }),
  approveItem: (id, mode = 'now') => request(`/queue-items/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  }),
  skipItem: (id) => request(`/queue-items/${id}/skip`, { method: 'POST' }),
  retryItem: (id) => request(`/queue-items/${id}/retry`, { method: 'POST' }),
  getFailed: () => request('/failed'),
  getStats: () => request('/stats'),
  getLogs: (limit = 50) => request(`/logs?limit=${limit}`),
  getHITL: () => request('/hitl'),
  startPipeline: (query, location, limit = 3) => pipelineRequest('/start', {
    method: 'POST',
    body: JSON.stringify({ query, location, limit }),
  }),
  rebuildLead: (id, changes) => request(`/leads/${id}/rebuild`, {
    method: 'POST',
    body: JSON.stringify({ changes }),
  }),
  clearAll: () => request('/clear', { method: 'POST' }),
}
