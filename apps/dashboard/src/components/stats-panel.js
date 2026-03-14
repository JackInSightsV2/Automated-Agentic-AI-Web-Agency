export function renderStatsPanel(container, data) {
  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Pipeline Stats</h2>'

  const grid = document.createElement('div')
  grid.className = 'grid grid-3'

  const stats = [
    { label: 'Total Leads', value: data?.totalLeads || 0, color: 'var(--blue)' },
    { label: 'Pipeline Runs', value: data?.totalRuns || 0, color: 'var(--purple)' },
    { label: 'Closed', value: data?.statusCounts?.closed || 0, color: 'var(--green)' },
    { label: 'Verified', value: data?.statusCounts?.verified || 0, color: 'var(--cyan)' },
    { label: 'Deployed', value: data?.statusCounts?.deployed || 0, color: 'var(--yellow)' },
    { label: 'Rejected', value: data?.statusCounts?.rejected || 0, color: 'var(--red)' },
  ]

  for (const s of stats) {
    const stat = document.createElement('div')
    stat.className = 'stat'
    stat.innerHTML = `
      <div class="stat-value" style="color:${s.color}">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    `
    grid.appendChild(stat)
  }

  card.appendChild(grid)
  container.appendChild(card)
}
