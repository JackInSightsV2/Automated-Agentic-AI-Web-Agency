export function renderLogFeed(container, logs) {
  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Agent Activity</h2>'

  const feed = document.createElement('div')
  feed.className = 'scroll-container'
  feed.style.maxHeight = '400px'

  for (const log of (logs || []).slice(0, 25)) {
    const entry = document.createElement('div')
    entry.className = `log-entry ${log.level || ''}`

    const time = new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const ago = getTimeAgo(log.created_at)

    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-agent">[${log.agent}]</span>
      <span>${log.message}</span>
      <span class="text-dim" style="font-size:10px;margin-left:8px">${ago}</span>
    `
    feed.appendChild(entry)
  }

  if (!logs?.length) {
    feed.innerHTML = '<div class="text-dim text-sm" style="padding:8px">No recent activity — run a pipeline to see agents working</div>'
  }

  card.appendChild(feed)
  container.appendChild(card)
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}
