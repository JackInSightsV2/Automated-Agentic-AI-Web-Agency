import { api } from '../api.js'

const QUICK_PICKS = [
  'barbers', 'plumbers', 'electricians', 'nail salons', 'takeaways',
  'car washes', 'dry cleaners', 'locksmiths', 'mobile repair', 'cleaners',
  'cafes', 'florists', 'mechanics', 'decorators', 'roofers',
]

export function renderRunPanel(container) {
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <div class="flex justify-between items-center" style="margin-bottom:12px">
      <h2 style="margin:0">Run Pipeline</h2>
      <button id="clear-all-btn" class="btn btn-red btn-sm">Clear All Data</button>
    </div>
    <div class="flex gap-2 items-center" style="flex-wrap:wrap">
      <input type="text" id="run-query" placeholder="Business type"
        style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:3px;font-size:13px;flex:1;min-width:150px" />
      <input type="text" id="run-location" placeholder="Location" value="London"
        style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:8px 12px;border-radius:3px;font-size:13px;width:140px" />
      <select id="run-limit"
        style="background:var(--bg);color:var(--text);border:1px solid var(--border);padding:8px 6px;border-radius:3px;font-size:13px;width:60px;cursor:pointer">
        <option value="1">1</option>
        <option value="3" selected>3</option>
        <option value="5">5</option>
        <option value="10">10</option>
        <option value="20">20</option>
      </select>
      <button id="run-btn" class="btn btn-green" style="padding:8px 20px;white-space:nowrap">
        Run
      </button>
    </div>
    <div class="flex gap-2" style="flex-wrap:wrap;margin-top:8px" id="quick-picks"></div>
    <div id="run-status" class="text-dim text-sm" style="margin-top:8px"></div>
  `

  container.appendChild(card)

  // Quick pick buttons
  const picksContainer = card.querySelector('#quick-picks')
  for (const pick of QUICK_PICKS) {
    const btn = document.createElement('button')
    btn.className = 'btn btn-sm'
    btn.textContent = pick
    btn.style.fontSize = '10px'
    btn.style.padding = '3px 8px'
    btn.addEventListener('click', () => {
      card.querySelector('#run-query').value = pick
    })
    picksContainer.appendChild(btn)
  }

  const queryInput = card.querySelector('#run-query')
  const locationInput = card.querySelector('#run-location')
  const limitSelect = card.querySelector('#run-limit')
  const runBtn = card.querySelector('#run-btn')
  const statusEl = card.querySelector('#run-status')

  runBtn.addEventListener('click', async () => {
    const query = queryInput.value.trim()
    const location = locationInput.value.trim() || 'London'
    const limit = Number.parseInt(limitSelect.value) || 3

    if (!query) {
      statusEl.textContent = 'Pick a business type first'
      statusEl.style.color = 'var(--red)'
      return
    }

    runBtn.disabled = true
    runBtn.textContent = 'Starting...'
    statusEl.textContent = ''

    try {
      const result = await api.startPipeline(query, location, limit)

      if (result.run_id) {
        statusEl.style.color = 'var(--green)'
        statusEl.textContent = `Pipeline started — Scout is finding ${query} in ${location}...`
        queryInput.value = ''
      } else {
        statusEl.style.color = 'var(--red)'
        statusEl.textContent = result.error || 'Failed to start pipeline'
      }
    } catch (err) {
      statusEl.style.color = 'var(--red)'
      statusEl.textContent = 'Error: ' + String(err)
    }

    runBtn.disabled = false
    runBtn.textContent = 'Run'
  })

  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runBtn.click()
  })

  // Clear all data
  card.querySelector('#clear-all-btn').addEventListener('click', async () => {
    if (!confirm('Clear all leads, queue items, logs, and pipeline runs?')) return
    await api.clearAll()
    statusEl.style.color = 'var(--green)'
    statusEl.textContent = 'All data cleared'
  })
}
