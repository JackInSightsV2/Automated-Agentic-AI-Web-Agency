import { api } from '../api.js'

export function renderConfigPanel(container, config) {
  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Settings</h2>'

  const content = document.createElement('div')

  // Worker Names
  const workerNames = config?.worker_names || {}
  const workers = [
    { key: 'ceo',       title: 'Chief Executive' },
    { key: 'finance',   title: 'Finance Director' },
    { key: 'scout',     title: 'Lead Scout' },
    { key: 'verify',    title: 'Compliance Analyst' },
    { key: 'copywrite', title: 'Copywriter' },
    { key: 'build',     title: 'Web Developer' },
    { key: 'seo',       title: 'SEO Specialist' },
    { key: 'review',    title: 'Code Reviewer' },
    { key: 'deploy',    title: 'DevOps Engineer' },
    { key: 'call',      title: 'Business Development' },
    { key: 'followup',  title: 'Client Relations' },
    { key: 'close',     title: 'Sales Director' },
    { key: 'monitor',   title: 'Lead Monitor' },
    { key: 'deliver',   title: 'Project Manager' },
  ]
  const defaults = { ceo: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AGENCY_OWNER_NAME) || 'The Owner', finance: 'Nina Okonkwo', scout: 'Maya Chen', verify: 'James Okafor', copywrite: 'Lena Kovacs', build: 'Priya Sharma', seo: 'Dani Ortega', review: 'Chris Nakamura', deploy: 'Tom Walsh', call: 'Alex Cooper', followup: 'Sophie Laurent', close: 'Marcus Reid', monitor: 'Ava Lindström', deliver: 'Zara Hussain' }

  content.innerHTML += '<h3 style="margin-bottom:8px">Team</h3>'
  for (const w of workers) {
    content.innerHTML += `
      <div class="config-row">
        <label><span class="text-dim text-sm">${w.title}</span></label>
        <div class="flex gap-2 items-center">
          <input type="text" data-worker-name="${w.key}" value="${workerNames[w.key] || defaults[w.key]}" placeholder="${defaults[w.key]}" style="width:160px" />
        </div>
      </div>
    `
  }
  content.innerHTML += `
    <div style="margin-top:8px;margin-bottom:16px">
      <button class="btn btn-green btn-sm" id="save-worker-names">Save Names</button>
    </div>
  `

  // Business hours
  const hours = config?.business_hours || { start: '09:00', end: '17:00', timezone: 'Europe/London' }
  content.innerHTML += `
    <h3 style="margin-top:16px;margin-bottom:8px">Business Hours</h3>
    <div class="config-row">
      <label>Call & Close Window</label>
      <div class="flex gap-2 items-center">
        <input type="time" id="cfg-hours-start" value="${hours.start}" />
        <span class="text-dim">to</span>
        <input type="time" id="cfg-hours-end" value="${hours.end}" />
        <button class="btn btn-sm" id="cfg-hours-save">Save</button>
      </div>
    </div>
    <div class="text-dim text-sm" style="margin-top:4px">Calls and closing calls only happen during these hours (${hours.timezone})</div>
  `

  // HITL toggles per queue
  const hitl = config?.hitl_config || {}
  const queues = ['verify', 'copywrite', 'build', 'seo', 'review', 'deploy', 'call', 'followup', 'close']

  content.innerHTML += '<h3 style="margin-top:16px;margin-bottom:8px">HITL (Human Approval)</h3>'
  for (const q of queues) {
    const isHITL = hitl[q] === 'hitl'
    content.innerHTML += `
      <div class="config-row">
        <label>${q} <span class="text-dim text-sm">${isHITL ? '— requires approval' : '— automatic'}</span></label>
        <div class="toggle ${isHITL ? 'on' : ''}" data-hitl-queue="${q}"></div>
      </div>
    `
  }

  // Concurrency
  const concurrency = config?.concurrency || {}
  content.innerHTML += '<h3 style="margin-top:16px;margin-bottom:8px">Concurrency (Workers per stage)</h3>'
  for (const q of queues) {
    content.innerHTML += `
      <div class="config-row">
        <label>${q}</label>
        <div class="flex gap-2 items-center">
          <input type="number" min="1" max="10" value="${concurrency[q] || 1}" data-concurrency-queue="${q}" style="width:60px" />
          <button class="btn btn-sm" data-concurrency-save="${q}">Set</button>
        </div>
      </div>
    `
  }

  card.appendChild(content)
  container.appendChild(card)

  // Event handlers
  document.getElementById('save-worker-names')?.addEventListener('click', async () => {
    const newNames = {}
    container.querySelectorAll('[data-worker-name]').forEach(input => {
      newNames[input.dataset.workerName] = input.value.trim() || defaults[input.dataset.workerName]
    })
    await api.updateConfig('worker_names', newNames)
    const btn = document.getElementById('save-worker-names')
    btn.textContent = 'Saved!'
    setTimeout(() => { btn.textContent = 'Save Names' }, 1500)
  })

  document.getElementById('cfg-hours-save')?.addEventListener('click', async () => {
    const start = document.getElementById('cfg-hours-start').value
    const end = document.getElementById('cfg-hours-end').value
    await api.updateConfig('business_hours', { ...hours, start, end })
  })

  container.querySelectorAll('[data-hitl-queue]').forEach(toggle => {
    toggle.addEventListener('click', async () => {
      const queue = toggle.dataset.hitlQueue
      const isOn = toggle.classList.contains('on')
      const newConfig = { ...hitl, [queue]: isOn ? 'auto' : 'hitl' }
      await api.updateConfig('hitl_config', newConfig)
      toggle.classList.toggle('on')
    })
  })

  container.querySelectorAll('[data-concurrency-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const queue = btn.dataset.concurrencySave
      const input = container.querySelector(`[data-concurrency-queue="${queue}"]`)
      const val = Number.parseInt(input.value) || 1
      const newConfig = { ...concurrency, [queue]: val }
      await api.updateConfig('concurrency', newConfig)
    })
  })
}
