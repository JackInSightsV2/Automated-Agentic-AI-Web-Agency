import { renderPipelineOffice } from '../components/pipeline-office.js'
import { renderRunPanel } from '../components/run-panel.js'
import { renderQueuePanel } from '../components/queue-panel.js'
import { renderStatsPanel } from '../components/stats-panel.js'
import { renderLogFeed } from '../components/log-feed.js'
import { renderLeadList } from '../components/lead-card.js'
import { generateCEOEmails, renderCEOInbox, } from '../components/ceo-inbox.js'
import { AgentTerminal } from '../components/agent-terminal.js'
import { api } from '../api.js'

let terminal = null

export async function renderDashboard(container, workdayActive = false) {
  let _workday = workdayActive

  // Clean up previous terminal SSE connection
  if (terminal) { terminal.destroy(); terminal = null }

  container.innerHTML = `
    <div id="run-container"></div>
    <div id="office-container"></div>
    <div class="grid grid-2">
      <div id="queue-container"></div>
      <div id="stats-container"></div>
    </div>
    <div id="hitl-container"></div>
    <div id="failed-container"></div>
    <div id="inbox-container"></div>
    <div id="leads-container"></div>
    <div id="terminal-container"></div>
    <div id="logs-container"></div>
  `

  // Pipeline run controls
  renderRunPanel(document.getElementById('run-container'))

  // Render pixel art office (full sprite-based renderer from pixel-agent-desk)
  const office = await renderPipelineOffice(document.getElementById('office-container'))

  // Initial data load
  const [queueData, statsData, logsData, configData] = await Promise.all([
    api.getQueues(),
    api.getStats(),
    api.getLogs(30),
    api.getConfig(),
  ])

  renderQueuePanel(document.getElementById('queue-container'), {
    ...queueData,
    concurrency: configData.config?.concurrency || {},
  })
  renderStatsPanel(document.getElementById('stats-container'), statsData)
  renderLogFeed(document.getElementById('logs-container'), logsData.logs)

  // Agent terminal — live filtered Claude Code output stream
  terminal = new AgentTerminal(document.getElementById('terminal-container'))

  // Load active leads
  const leadsData = await api.getLeads(null, 30)
  renderLeadList(document.getElementById('leads-container'), leadsData.leads)

  // HITL pending items + failed items
  await renderHITLItems()
  await renderFailedItems()

  return {
    office,
    setWorkday(active) {
      _workday = active
      if (!active) {
        // Force all agents to idle immediately
        office.update({ _forceIdle: true })
      }
    },
    update(data) {
      // Inject workday state so office knows whether to animate
      data._workday = _workday
      office.update(data)

      // Pass concurrency config to queue panel
      const concurrency = data.concurrency || {}
      renderQueuePanel(document.getElementById('queue-container'), {
        queues: formatQueuesForPanel(data),
        concurrency,
      })
      renderLogFeed(document.getElementById('logs-container'), data.recentLogs)
      renderLeadList(document.getElementById('leads-container'), data.activeLeads)

      // CEO inbox — generate contextual emails based on pipeline state
      const emails = generateCEOEmails(data)
      renderCEOInbox(document.getElementById('inbox-container'), emails)

      // Refresh HITL and failed items
      if (data.hitlItems?.length > 0) renderHITLItems()
      renderFailedItems()
    },
  }
}

function formatQueuesForPanel(data) {
  if (!data.queues || !data.queueStates) return []
  const hitl = data.hitlConfig || {}
  return Object.entries(data.queues).map(([name, stats]) => ({
    name,
    state: data.queueStates[name] || 'active',
    hitl: hitl[name] || 'auto',
    ...stats,
  }))
}

async function renderHITLItems() {
  const container = document.getElementById('hitl-container')
  if (!container) return

  const { items } = await api.getHITL()
  if (!items?.length) {
    container.innerHTML = ''
    return
  }

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Awaiting Approval</h2>'

  for (const item of items) {
    const lead = item.leads || {}
    const div = document.createElement('div')
    div.className = 'hitl-card'
    div.innerHTML = `
      <div class="hitl-info">
        <strong>${lead.name || 'Unknown'}</strong>
        <span class="text-dim text-sm"> — ${item.queue_name} stage</span>
        <div class="text-dim text-sm">${lead.phone || ''} | ${lead.category || ''}</div>
      </div>
      <div class="hitl-actions">
        <button class="btn btn-green btn-sm" data-approve-now="${item.id}" title="Execute immediately">Approve</button>
        <button class="btn btn-sm" data-approve-queue="${item.id}" title="Queue for business hours (9-5)" style="background:var(--surface);border:1px solid var(--green);color:var(--green)">Queue 9-5</button>
        <button class="btn btn-red btn-sm" data-skip="${item.id}">Skip</button>
      </div>
    `
    card.appendChild(div)
  }

  container.innerHTML = ''
  container.appendChild(card)

  container.querySelectorAll('[data-approve-now]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Running...'
      btn.disabled = true
      await api.approveItem(btn.dataset.approveNow, 'now')
      await renderHITLItems()
    })
  })

  container.querySelectorAll('[data-approve-queue]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Queued'
      btn.disabled = true
      await api.approveItem(btn.dataset.approveQueue, 'queue')
      await renderHITLItems()
    })
  })

  container.querySelectorAll('[data-skip]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.skipItem(btn.dataset.skip)
      await renderHITLItems()
    })
  })
}

let lastFailedCount = -1

async function renderFailedItems() {
  const container = document.getElementById('failed-container')
  if (!container) return

  const { items } = await api.getFailed()
  if (!items?.length) {
    if (lastFailedCount !== 0) {
      container.innerHTML = ''
      lastFailedCount = 0
    }
    return
  }

  if (items.length === lastFailedCount) return
  lastFailedCount = items.length

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<h2 style="color:var(--red)">Failed (${items.length})</h2>`

  for (const item of items) {
    const lead = item.leads || {}
    const div = document.createElement('div')
    div.className = 'hitl-card'
    div.innerHTML = `
      <div class="hitl-info">
        <strong>${lead.name || 'Unknown'}</strong>
        <span class="badge badge-failed" style="margin-left:6px">${item.queue_name}</span>
        <div class="text-dim" style="font-size:11px;font-family:monospace;margin-top:4px;max-height:40px;overflow:auto">${(item.error || 'No details').replace(/</g, '&lt;')}</div>
      </div>
      <div class="hitl-actions">
        <button class="btn btn-green btn-sm" data-retry="${item.id}">Retry</button>
        <button class="btn btn-red btn-sm" data-dismiss="${item.id}">Dismiss</button>
      </div>
    `
    card.appendChild(div)
  }

  container.innerHTML = ''
  container.appendChild(card)

  container.querySelectorAll('[data-retry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.textContent = 'Retrying...'
      btn.disabled = true
      await api.retryItem(btn.dataset.retry)
      lastFailedCount = -1
      await renderFailedItems()
    })
  })

  container.querySelectorAll('[data-dismiss]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.skipItem(btn.dataset.dismiss)
      lastFailedCount = -1
      await renderFailedItems()
    })
  })
}
