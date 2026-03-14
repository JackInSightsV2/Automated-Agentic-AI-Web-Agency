import './style.css'
import { createSSE } from './sse.js'
import { renderDashboard } from './pages/dashboard.js'
import { renderLeadsPage } from './pages/leads.js'
import { renderQueuesPage } from './pages/queues.js'
import { renderSettingsPage } from './pages/settings.js'

const app = document.getElementById('app')
let currentPage = 'dashboard'
let dashboardRef = null
let sse = null
let apiRunning = false
let workdayActive = false

// --- API control ---
async function checkApiStatus() {
  try {
    const res = await fetch('/api-control/status')
    const data = await res.json()
    apiRunning = data.running
  } catch {
    apiRunning = false
  }
  updateHeader()
}

async function startApi() {
  await fetch('/api-control/start', { method: 'POST' })
  await new Promise(r => setTimeout(r, 1500))
  await checkApiStatus()
  if (apiRunning) {
    connectSSE()
    render()
  }
}

async function stopApi() {
  disconnectSSE()
  workdayActive = false
  await fetch('/api-control/stop', { method: 'POST' })
  await new Promise(r => setTimeout(r, 500))
  await checkApiStatus()
  render()
}

function disconnectSSE() {
  if (sse) { sse.close(); sse = null }
}

// --- Work day control ---
async function startWorkDay() {
  // Set workday FIRST so any render that follows sees it
  workdayActive = true
  updateHeader()

  // Start API if not running
  if (!apiRunning) {
    await startApi()
  } else {
    connectSSE()
  }

  // Resume all queues
  if (apiRunning) {
    try {
      const queues = ['verify', 'build', 'deploy', 'call', 'followup', 'close']
      for (const q of queues) {
        await fetch(`/admin/queues/${q}/resume`, { method: 'POST' })
      }
    } catch (e) {
      console.error('Failed to resume queues:', e)
    }
  }

  // Tell existing dashboard instance, or re-render
  if (dashboardRef?.setWorkday) {
    dashboardRef.setWorkday(true)
  } else {
    render()
  }
}

async function finishWorkDay() {
  workdayActive = false
  updateHeader()

  // Pause all queues
  if (apiRunning) {
    try {
      const queues = ['verify', 'build', 'deploy', 'call', 'followup', 'close']
      for (const q of queues) {
        await fetch(`/admin/queues/${q}/pause`, { method: 'POST' })
      }
    } catch (e) {
      console.error('Failed to pause queues:', e)
    }
  }

  // Tell dashboard to put agents to sleep
  if (dashboardRef?.setWorkday) {
    dashboardRef.setWorkday(false)
  }
}

function updateHeader() {
  const dot = document.getElementById('api-dot')
  const label = document.getElementById('api-label')
  const workdayBtn = document.getElementById('workday-btn')
  const apiBtn = document.getElementById('api-toggle')

  if (dot) {
    if (workdayActive && apiRunning) {
      dot.style.background = 'var(--green)'
    } else if (apiRunning) {
      dot.style.background = 'var(--yellow)'
    } else {
      dot.style.background = 'var(--red)'
    }
  }

  if (label) {
    if (workdayActive && apiRunning) {
      label.textContent = 'Work Day Active'
    } else if (apiRunning) {
      label.textContent = 'API Running — Off Duty'
    } else {
      label.textContent = 'Office Closed'
    }
  }

  if (workdayBtn) {
    if (workdayActive) {
      workdayBtn.textContent = 'Finish Work Day'
      workdayBtn.className = 'btn btn-red btn-sm'
    } else {
      workdayBtn.textContent = 'Start Work Day'
      workdayBtn.className = 'btn btn-green btn-sm'
    }
  }

  if (apiBtn) {
    if (apiRunning) {
      apiBtn.textContent = 'Stop API'
      apiBtn.className = 'btn btn-red btn-sm'
      apiBtn.style.fontSize = '9px'
    } else {
      apiBtn.textContent = 'Start API'
      apiBtn.className = 'btn btn-green btn-sm'
      apiBtn.style.fontSize = '9px'
    }
  }
}

function connectSSE() {
  if (sse) sse.close()
  sse = createSSE((data) => {
    const el = document.getElementById('last-update')
    if (el) {
      const time = new Date(data.timestamp).toLocaleTimeString('en-GB')
      el.textContent = `Live — ${time}`
    }

    // Auto-detect workday: if queues have processing/pending items, the day is active
    if (!workdayActive && data.queues) {
      const hasWork = Object.values(data.queues).some(q => q.processing > 0 || q.pending > 0)
      if (hasWork) {
        workdayActive = true
        updateHeader()
        if (dashboardRef?.setWorkday) dashboardRef.setWorkday(true)
      }
    }

    if (dashboardRef?.update) {
      dashboardRef.update(data)
    }
  })
}

function render() {
  app.innerHTML = `
    <div class="header">
      <h1>${import.meta.env.VITE_AGENCY_NAME || 'Web Agency'}</h1>
      <div class="flex items-center gap-2">
        <span id="api-dot" class="status-dot" style="background:var(--red)"></span>
        <span class="text-dim text-sm" id="api-label">Checking...</span>
        <button id="workday-btn" class="btn btn-green btn-sm" style="margin-left:12px">Start Work Day</button>
        <button id="api-toggle" class="btn btn-sm" style="margin-left:4px;font-size:9px">...</button>
        <span class="text-dim text-sm" style="margin-left:12px" id="last-update"></span>
      </div>
    </div>
    <nav>
      <button data-page="dashboard" class="${currentPage === 'dashboard' ? 'active' : ''}">Dashboard</button>
      <button data-page="leads" class="${currentPage === 'leads' ? 'active' : ''}">Leads</button>
      <button data-page="queues" class="${currentPage === 'queues' ? 'active' : ''}">Queues</button>
      <button data-page="settings" class="${currentPage === 'settings' ? 'active' : ''}">Settings</button>
    </nav>
    <div id="page-content"></div>
  `

  // Work day toggle
  document.getElementById('workday-btn').addEventListener('click', () => {
    if (workdayActive) finishWorkDay()
    else startWorkDay()
  })

  // API toggle (smaller, secondary)
  document.getElementById('api-toggle').addEventListener('click', () => {
    if (apiRunning) stopApi()
    else startApi()
  })

  updateHeader()

  // Nav handlers
  app.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentPage = btn.dataset.page
      render()
    })
  })

  loadPage()
}

async function loadPage() {
  const content = document.getElementById('page-content')

  if (!apiRunning) {
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:60px 20px">
        <h2 style="margin-bottom:16px">WebAgency OS</h2>
        <p class="text-dim" style="margin-bottom:24px">The office is closed. Start the work day to bring the team online.</p>
        <button class="btn btn-green" id="start-workday-main" style="font-size:14px;padding:12px 32px">
          Start Work Day
        </button>
      </div>
    `
    document.getElementById('start-workday-main').addEventListener('click', startWorkDay)
    return
  }

  try {
    switch (currentPage) {
      case 'dashboard':
        dashboardRef = await renderDashboard(content, workdayActive)
        break
      case 'leads':
        dashboardRef = null
        await renderLeadsPage(content)
        break
      case 'queues':
        dashboardRef = null
        await renderQueuesPage(content)
        break
      case 'settings':
        dashboardRef = null
        await renderSettingsPage(content)
        break
    }
  } catch (err) {
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:40px">
        <p class="text-dim">Waiting for API to be ready...</p>
      </div>
    `
  }
}

// Initial load
checkApiStatus().then(() => {
  render()
  if (apiRunning) connectSSE()
})

// Poll API status every 5s
setInterval(checkApiStatus, 5000)

// Export for external access
window.__agency = { isWorkdayActive: () => workdayActive }
