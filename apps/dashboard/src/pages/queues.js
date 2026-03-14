import { api } from '../api.js'

export async function renderQueuesPage(container) {
  container.innerHTML = '<div class="card"><h2>Queue Management</h2><div id="queues-detail"></div></div>'

  const detail = document.getElementById('queues-detail')
  const data = await api.getQueues()

  for (const q of data.queues || []) {
    const div = document.createElement('div')
    div.style.cssText = 'padding:12px;border-bottom:1px solid var(--border)'

    const total = q.pending + q.processing + q.failed + q.pending_approval
    const stateIcon = q.state === 'active' ? '🟢' : '🔴'
    const hitlIcon = q.hitl === 'hitl' ? '🔔 HITL' : '🤖 Auto'

    div.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <strong>${stateIcon} ${q.name.toUpperCase()}</strong>
          <span class="text-dim text-sm" style="margin-left:8px">${hitlIcon}</span>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-sm ${q.state === 'paused' ? 'btn-green' : 'btn-red'}" data-toggle="${q.name}" data-state="${q.state}">
            ${q.state === 'paused' ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>
      <div class="text-dim text-sm" style="margin-top:4px">
        ⏳ ${q.pending} pending | ⚡ ${q.processing} processing | 🔔 ${q.pending_approval} awaiting | ❌ ${q.failed} failed | Total: ${total}
      </div>
    `
    detail.appendChild(div)
  }

  // Event handlers
  detail.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const queue = btn.dataset.toggle
      const state = btn.dataset.state
      if (state === 'paused') await api.resumeQueue(queue)
      else await api.pauseQueue(queue)
      await renderQueuesPage(container)
    })
  })
}
