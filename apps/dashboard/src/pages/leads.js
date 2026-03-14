import { api } from '../api.js'

export async function renderLeadsPage(container) {
  container.innerHTML = `
    <div class="card" id="failed-section"></div>
    <div class="card">
      <h2>All Leads</h2>
      <div class="flex gap-2 mb-4">
        <select id="lead-filter">
          <option value="">All statuses</option>
          <option value="discovered">Discovered</option>
          <option value="verified">Verified</option>
          <option value="briefed">Briefed</option>
          <option value="building">Building</option>
          <option value="built">Built</option>
          <option value="seo_optimized">SEO Optimized</option>
          <option value="reviewed">Reviewed</option>
          <option value="deployed">Deployed</option>
          <option value="emailed">Emailed</option>
          <option value="called">Called</option>
          <option value="booked">Booked</option>
          <option value="closed">Closed</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="hitl_ready">HITL Ready</option>
        </select>
      </div>
      <div id="leads-list"></div>
    </div>
  `

  const filter = document.getElementById('lead-filter')
  const list = document.getElementById('leads-list')

  async function loadLeads() {
    const status = filter.value || null
    const data = await api.getLeads(status, 100)
    renderTable(list, data.leads || [])
  }

  filter.addEventListener('change', loadLeads)

  // Load failed items and leads in parallel
  await Promise.all([loadLeads(), loadFailed()])
}

async function loadFailed() {
  const section = document.getElementById('failed-section')
  const data = await api.getFailed()
  const items = data.items || []

  if (items.length === 0) {
    section.style.display = 'none'
    return
  }

  section.style.display = 'block'
  section.innerHTML = `<h2 style="color:var(--red)">Failed Items (${items.length})</h2>`

  for (const item of items) {
    const lead = item.leads || {}
    const div = document.createElement('div')
    div.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border);'
    div.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <strong>${lead.name || 'Unknown'}</strong>
          <span class="badge badge-failed" style="margin-left:6px">${item.queue_name}</span>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-green btn-sm" data-retry="${item.id}">Retry</button>
          <button class="btn btn-red btn-sm" data-dismiss="${item.id}">Dismiss</button>
        </div>
      </div>
      <div class="text-dim text-sm" style="margin-top:4px;font-family:monospace;font-size:11px;max-height:60px;overflow:auto;padding:4px 6px;background:var(--bg);border-radius:3px">${escapeHtml(item.error || 'No error details')}</div>
      <div class="text-dim" style="font-size:10px;margin-top:4px">${new Date(item.created_at).toLocaleString('en-GB')}</div>
    `
    section.appendChild(div)
  }

  // Retry handlers
  section.querySelectorAll('[data-retry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Retrying...'
      btn.disabled = true
      await api.retryItem(btn.dataset.retry)
      await loadFailed()
    })
  })

  // Dismiss (skip) handlers
  section.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.skipItem(btn.dataset.dismiss)
      await loadFailed()
    })
  })
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderTable(container, leads) {
  if (!leads.length) {
    container.innerHTML = '<div class="text-dim text-sm" style="padding:12px">No leads found</div>'
    return
  }

  let html = `
    <div class="lead-row lead-row--header" style="font-weight:600;font-size:11px;color:var(--text-dim)">
      <span>Name</span>
      <span>Category</span>
      <span>Status</span>
      <span>Score</span>
      <span>Site</span>
      <span>Actions</span>
    </div>
  `

  for (const lead of leads) {
    const hasError = lead.error || lead.status === 'building' || lead.status === 'hitl_ready'
    html += `
      <div class="lead-row${hasError ? ' lead-row--error' : ''}">
        <span>${lead.name}</span>
        <span class="text-dim text-sm">${lead.category || '—'}</span>
        <span><span class="badge badge-${lead.status}">${lead.status}</span></span>
        <span class="text-dim text-sm">${lead.viability_score !== null ? lead.viability_score + 'pts' : '—'}</span>
        <span>${lead.vercel_deployment_url ? `<a href="${lead.vercel_deployment_url}" target="_blank" style="color:var(--cyan);font-size:11px">View</a>` : '—'}</span>
        <span>
          ${lead.error ? `<span class="text-dim text-sm" title="${escapeHtml(lead.error)}" style="cursor:help;color:var(--red)">⚠</span>` : ''}
          ${lead.vercel_deployment_url ? `<button class="btn btn-sm" data-rebuild-lead="${lead.id}" style="font-size:9px;padding:2px 6px">Rebuild</button>` : ''}
        </span>
      </div>
    `
  }

  container.innerHTML = html

  // Rebuild handlers
  container.querySelectorAll('[data-rebuild-lead]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const changes = prompt('What changes? (leave blank for full rebuild)')
      btn.textContent = 'Queued'
      btn.disabled = true
      await api.rebuildLead(btn.dataset.rebuildLead, changes || 'Full rebuild - regenerate site')
    })
  })
}
