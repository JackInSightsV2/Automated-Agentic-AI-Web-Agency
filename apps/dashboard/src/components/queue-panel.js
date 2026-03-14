import { api } from '../api.js'

export function renderQueuePanel(container, data) {
  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Queue Control</h2>'

  const grid = document.createElement('div')
  grid.className = 'grid grid-6'

  const queues = data?.queues || []
  const concurrency = data?.concurrency || {}

  for (const q of queues) {
    const total = q.pending + q.processing + q.failed + q.pending_approval
    const stateClass = q.state === 'paused' ? 'paused' : q.hitl === 'hitl' ? 'hitl' : 'active'
    const workers = concurrency[q.name] || 1

    const qCard = document.createElement('div')
    qCard.className = `queue-card ${stateClass}`
    qCard.innerHTML = `
      <div class="queue-name">${q.name}</div>
      <div class="queue-count">${total}</div>
      <div class="queue-status" style="font-size:10px;line-height:1.4">
        ${q.processing > 0 ? `<div>⚡ ${q.processing} active</div>` : ''}
        ${q.pending > 0 ? `<div>⏳ ${q.pending} pending</div>` : ''}
        ${q.pending_approval > 0 ? `<div>🔔 ${q.pending_approval} awaiting</div>` : ''}
        ${q.failed > 0 ? `<div>❌ ${q.failed} failed</div>` : ''}
        ${total === 0 ? '<div>— empty</div>' : ''}
      </div>
      <div class="text-dim" style="font-size:9px;margin-top:4px">${workers} worker${workers > 1 ? 's' : ''} | ${q.hitl === 'hitl' ? 'HITL' : 'auto'}</div>
      <div style="margin-top:6px;display:flex;gap:4px;justify-content:center">
        <button class="btn btn-sm ${q.state === 'paused' ? 'btn-green' : 'btn-red'}" data-action="${q.state === 'paused' ? 'resume' : 'pause'}" data-queue="${q.name}" style="font-size:9px;padding:2px 6px">
          ${q.state === 'paused' ? '▶' : '⏸'}
        </button>
        <button class="btn btn-sm" data-workers-up="${q.name}" style="font-size:9px;padding:2px 6px" title="Add worker">+</button>
        <button class="btn btn-sm" data-workers-down="${q.name}" style="font-size:9px;padding:2px 6px" title="Remove worker">-</button>
      </div>
    `
    grid.appendChild(qCard)
  }

  card.appendChild(grid)
  container.appendChild(card)

  // Pause/resume handlers
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action
      const queue = btn.dataset.queue
      if (action === 'pause') await api.pauseQueue(queue)
      else await api.resumeQueue(queue)
    })
  })

  // Worker +/- handlers
  container.querySelectorAll('[data-workers-up]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const queue = btn.dataset.workersUp
      const current = concurrency[queue] || 1
      const newVal = Math.min(current + 1, 10)
      const newConfig = { ...concurrency, [queue]: newVal }
      await api.updateConfig('concurrency', newConfig)
    })
  })

  container.querySelectorAll('[data-workers-down]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const queue = btn.dataset.workersDown
      const current = concurrency[queue] || 1
      const newVal = Math.max(current - 1, 1)
      const newConfig = { ...concurrency, [queue]: newVal }
      await api.updateConfig('concurrency', newConfig)
    })
  })
}
