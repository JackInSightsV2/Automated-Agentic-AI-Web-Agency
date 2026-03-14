/**
 * Agent Terminal — live streaming feed of a specific agent's Claude Code output
 * Loads history via REST, then streams new entries via SSE
 */

const AGENT_OPTIONS = [
  { value: '', label: 'All Agents' },
  { value: 'scout', label: 'Maya — Scout' },
  { value: 'verifier', label: 'James — Verifier' },
  { value: 'copywriter', label: 'Lena — Copywriter' },
  { value: 'builder', label: 'Priya — Builder' },
  { value: 'seo', label: 'Dani — SEO' },
  { value: 'reviewer', label: 'Chris — Reviewer' },
  { value: 'deployer', label: 'Tom — Deployer' },
  { value: 'caller', label: 'Alex — Caller' },
  { value: 'followup', label: 'Sophie — Follow Up' },
  { value: 'closer', label: 'Marcus — Closer' },
  { value: 'monitor', label: 'Ava — Monitor' },
  { value: 'delivery', label: 'Zara — Delivery' },
  { value: 'orchestrator', label: 'Orchestrator' },
  { value: 'queue', label: 'Queue System' },
]

const LEVEL_COLORS = {
  info: '#94a3b8',
  success: '#4ade80',
  warn: '#fbbf24',
  error: '#f87171',
}

export class AgentTerminal {
  constructor(container) {
    this.container = container
    this.source = null
    this.currentAgent = ''
    this.lines = []
    this.seenIds = new Set()
    this.maxLines = 300
    this.autoScroll = true
    this.reconnectTimer = null
    this.render()
  }

  render() {
    this.container.innerHTML = ''

    const card = document.createElement('div')
    card.className = 'card'

    // Header with filter
    const header = document.createElement('div')
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px'
    header.innerHTML = '<h2 style="margin:0">Agent Terminal</h2>'

    const controls = document.createElement('div')
    controls.className = 'flex gap-2 items-center'

    const select = document.createElement('select')
    select.style.cssText = 'background:var(--bg);color:var(--text);border:1px solid var(--border);padding:4px 8px;font-size:12px;border-radius:3px'
    for (const opt of AGENT_OPTIONS) {
      const o = document.createElement('option')
      o.value = opt.value
      o.textContent = opt.label
      select.appendChild(o)
    }
    select.addEventListener('change', () => this.switchAgent(select.value))
    controls.appendChild(select)

    const clearBtn = document.createElement('button')
    clearBtn.className = 'btn btn-sm'
    clearBtn.textContent = 'Clear'
    clearBtn.addEventListener('click', () => { this.lines = []; this.seenIds.clear(); this.renderLines() })
    controls.appendChild(clearBtn)

    header.appendChild(controls)
    card.appendChild(header)

    // Terminal body
    const terminal = document.createElement('div')
    terminal.style.cssText = `
      background: #0c0c14;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      overflow-y: auto;
      max-height: 400px;
      min-height: 200px;
    `
    terminal.addEventListener('scroll', () => {
      this.autoScroll = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 30
    })
    this.terminalEl = terminal
    card.appendChild(terminal)

    this.container.appendChild(card)

    // Load initial data
    this.switchAgent('')
  }

  async switchAgent(agent) {
    this.currentAgent = agent
    this.lines = []
    this.seenIds.clear()
    this.renderLines()

    // Load history first via REST
    await this.loadHistory()

    // Then connect SSE for live updates
    this.connectSSE()
  }

  async loadHistory() {
    try {
      const res = await fetch(`/admin/logs?limit=100`)
      const data = await res.json()
      let logs = data.logs || []

      // Filter by agent if set
      if (this.currentAgent) {
        logs = logs.filter(l => l.agent === this.currentAgent)
      }

      // Reverse to chronological order
      logs.reverse()

      for (const log of logs) {
        if (this.seenIds.has(log.id)) continue
        this.seenIds.add(log.id)
        this.lines.push(log)
      }

      if (this.lines.length > this.maxLines) {
        this.lines = this.lines.slice(-this.maxLines)
      }

      this.renderLines()
    } catch {
      // API not ready yet
    }
  }

  connectSSE() {
    if (this.source) { this.source.close(); this.source = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }

    const since = this.lines.length > 0
      ? this.lines[this.lines.length - 1].created_at
      : new Date(Date.now() - 5 * 60000).toISOString()

    const url = `/events/agent-feed?agent=${encodeURIComponent(this.currentAgent)}&since=${encodeURIComponent(since)}`

    try {
      this.source = new EventSource(url)

      this.source.addEventListener('logs', (event) => {
        try {
          const logs = JSON.parse(event.data)
          for (const log of logs) {
            if (this.seenIds.has(log.id)) continue
            this.seenIds.add(log.id)
            this.addLine(log)
          }
        } catch {}
      })

      this.source.onerror = () => {
        if (this.source) { this.source.close(); this.source = null }
        // Reconnect after 5s
        this.reconnectTimer = setTimeout(() => this.connectSSE(), 5000)
      }
    } catch {
      this.reconnectTimer = setTimeout(() => this.connectSSE(), 5000)
    }
  }

  addLine(log) {
    this.lines.push(log)
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines)
    }

    if (this.terminalEl) {
      this.terminalEl.appendChild(this.createLineEl(log))
      if (this.autoScroll) {
        this.terminalEl.scrollTop = this.terminalEl.scrollHeight
      }
    }
  }

  createLineEl(log) {
    const line = document.createElement('div')
    line.style.cssText = 'padding:1px 0;word-break:break-word'

    const time = new Date(log.created_at).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })

    const levelColor = LEVEL_COLORS[log.level] || LEVEL_COLORS.info
    const isStream = log.metadata?.stream

    line.innerHTML = `<span style="color:#555">${time}</span> <span style="color:${levelColor};font-weight:bold">[${log.agent}]</span> <span style="color:${isStream ? '#e0e0e8' : levelColor}">${escapeHtml(log.message)}</span>`

    return line
  }

  renderLines() {
    if (!this.terminalEl) return
    this.terminalEl.innerHTML = ''

    if (this.lines.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'color:#555;padding:20px;text-align:center'
      empty.textContent = this.currentAgent
        ? `Watching ${this.currentAgent}... run a pipeline to see output`
        : 'Watching all agents... run a pipeline to see output'
      this.terminalEl.appendChild(empty)
      return
    }

    for (const log of this.lines) {
      this.terminalEl.appendChild(this.createLineEl(log))
    }

    if (this.autoScroll) {
      this.terminalEl.scrollTop = this.terminalEl.scrollHeight
    }
  }

  destroy() {
    if (this.source) { this.source.close(); this.source = null }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
