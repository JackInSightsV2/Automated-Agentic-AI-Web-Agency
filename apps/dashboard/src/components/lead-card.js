import { api } from '../api.js'

export function renderLeadList(container, leads) {
  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = '<h2>Active Leads</h2>'

  const list = document.createElement('div')
  list.className = 'scroll-container'
  list.style.maxHeight = '400px'

  if (!leads?.length) {
    list.innerHTML = '<div class="text-dim text-sm" style="padding:12px">No leads yet — run a pipeline to get started</div>'
    card.appendChild(list)
    container.appendChild(card)
    return
  }

  for (const lead of leads) {
    const row = document.createElement('div')
    row.className = 'lead-item'
    row.style.cssText = 'padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;'

    const badgeClass = `badge badge-${lead.status}`
    const hasUrl = !!lead.vercel_deployment_url

    row.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          <strong>${lead.name}</strong>
          <span class="text-dim text-sm" style="margin-left:8px">${lead.category || ''}</span>
          <span class="${badgeClass}" style="margin-left:8px">${lead.status}</span>
          ${lead.viability_score != null ? `<span class="text-dim text-sm" style="margin-left:6px">${lead.viability_score}pts</span>` : ''}
          ${lead.error ? `<span style="color:var(--red);font-size:11px;margin-left:8px">Error</span>` : ''}
        </div>
        <div class="flex gap-2" onclick="event.stopPropagation()">
          ${hasUrl ? `<a href="${lead.vercel_deployment_url}" target="_blank" class="btn btn-sm" style="color:var(--cyan);border-color:var(--cyan);text-decoration:none">View Site</a>` : ''}
          ${hasUrl ? `<button class="btn btn-sm rebuild-btn" data-lead-id="${lead.id}" data-lead-name="${lead.name}">Request Changes</button>` : ''}
        </div>
      </div>
      ${lead.phone ? `<div class="text-dim text-sm" style="margin-top:2px">${lead.phone}${lead.call_outcome ? ' — ' + lead.call_outcome : ''}</div>` : ''}
    `

    // Click row to open detail modal
    row.addEventListener('click', () => openLeadModal(lead.id))

    list.appendChild(row)
  }

  card.appendChild(list)
  container.appendChild(card)

  // Request Changes handlers
  container.querySelectorAll('.rebuild-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const leadId = btn.dataset.leadId
      const leadName = btn.dataset.leadName
      const changes = prompt(`What changes do you want for "${leadName}"?`)
      if (!changes) return
      btn.disabled = true
      btn.textContent = 'Queuing...'
      try {
        await api.rebuildLead(leadId, changes)
        btn.textContent = 'Queued!'
        btn.style.color = 'var(--green)'
        setTimeout(() => { btn.textContent = 'Request Changes'; btn.style.color = ''; btn.disabled = false }, 2000)
      } catch { btn.textContent = 'Failed'; btn.style.color = 'var(--red)'; btn.disabled = false }
    })
  })
}

async function openLeadModal(leadId) {
  // Fetch full lead detail
  let data
  try {
    data = await api.getLead(leadId)
  } catch { return }

  const lead = data.lead
  if (!lead) return

  // Create modal overlay
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px'
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

  const modal = document.createElement('div')
  modal.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:8px;max-width:700px;width:100%;max-height:85vh;overflow-y:auto;padding:24px;position:relative'

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.textContent = 'X'
  closeBtn.style.cssText = 'position:absolute;top:12px;right:16px;background:none;border:none;color:var(--text-dim);font-size:16px;cursor:pointer'
  closeBtn.addEventListener('click', () => overlay.remove())
  modal.appendChild(closeBtn)

  // Header
  const header = document.createElement('div')
  header.style.marginBottom = '16px'
  header.innerHTML = `
    <h2 style="font-family:var(--pixel-font);font-size:12px;color:var(--accent);margin-bottom:8px">${lead.name}</h2>
    <span class="badge badge-${lead.status}" style="font-size:9px">${lead.status}</span>
    ${lead.viability_score != null ? `<span class="text-dim text-sm" style="margin-left:8px">Viability: ${lead.viability_score}/100</span>` : ''}
  `
  modal.appendChild(header)

  // Details grid
  const details = document.createElement('div')
  details.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:12px'
  details.innerHTML = `
    ${field('Category', lead.category)}
    ${field('Phone', lead.phone)}
    ${field('Email', lead.email)}
    ${field('Address', lead.address)}
    ${field('Google Rating', lead.google_rating ? `${lead.google_rating} (${lead.google_review_count} reviews)` : null)}
    ${field('Companies House', lead.companies_house_status ? `${lead.companies_house_status} (${lead.companies_house_number})` : null)}
    ${field('Call Outcome', lead.call_outcome)}
    ${field('Contact Name', lead.contact_name)}
    ${field('Domain', lead.desired_domain)}
    ${field('CTA', lead.cta_type ? `${lead.cta_type}: ${lead.cta_value || ''}` : null)}
    ${field('Stripe Link', lead.stripe_payment_link ? `<a href="${lead.stripe_payment_link}" target="_blank" style="color:var(--cyan)">Payment Link</a>` : null)}
    ${field('Paid', lead.paid_at ? new Date(lead.paid_at).toLocaleDateString('en-GB') : null)}
  `
  modal.appendChild(details)

  // Viability notes
  if (lead.viability_notes) {
    const notes = document.createElement('div')
    notes.style.cssText = 'background:var(--bg);padding:10px;border-radius:4px;font-size:11px;margin-bottom:16px;white-space:pre-wrap;color:var(--text-dim);font-family:monospace'
    notes.textContent = lead.viability_notes
    const notesLabel = document.createElement('div')
    notesLabel.style.cssText = 'font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text)'
    notesLabel.textContent = 'Viability Breakdown'
    modal.appendChild(notesLabel)
    modal.appendChild(notes)
  }

  // Review results
  if (lead.review_result) {
    try {
      const review = JSON.parse(lead.review_result)
      const reviewLabel = document.createElement('div')
      reviewLabel.style.cssText = 'font-size:11px;font-weight:600;margin-bottom:6px;color:var(--text)'
      reviewLabel.textContent = 'Review Results'
      modal.appendChild(reviewLabel)

      const reviewDiv = document.createElement('div')
      reviewDiv.style.cssText = 'background:var(--bg);padding:12px;border-radius:4px;font-size:11px;margin-bottom:16px'

      const scoreColor = review.overall_score >= 80 ? 'var(--green)' : review.overall_score >= 60 ? 'var(--yellow)' : 'var(--red)'
      const passIcon = review.pass ? '✅' : '❌'

      let scoreGrid = ''
      if (review.scores) {
        scoreGrid = Object.entries(review.scores).map(([k, v]) => {
          const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          const barColor = v >= 80 ? 'var(--green)' : v >= 60 ? 'var(--yellow)' : 'var(--red)'
          return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
            <span style="width:120px;color:var(--text-dim)">${label}</span>
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="width:${v}%;height:100%;background:${barColor};border-radius:3px"></div>
            </div>
            <span style="width:28px;text-align:right;color:${barColor}">${v}</span>
          </div>`
        }).join('')
      }

      reviewDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span style="font-size:14px;font-weight:bold;color:${scoreColor}">${passIcon} ${review.overall_score}/100</span>
          <span style="color:var(--text-dim)">${review.reviewed_at ? new Date(review.reviewed_at).toLocaleString('en-GB', { day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit' }) : ''}</span>
        </div>
        ${scoreGrid}
        ${review.critical_issues?.length ? `<div style="margin-top:8px;color:var(--red)"><strong>Critical:</strong> ${review.critical_issues.join(', ')}</div>` : ''}
        ${review.warnings?.length ? `<div style="margin-top:4px;color:var(--yellow)"><strong>Warnings:</strong> ${review.warnings.join(', ')}</div>` : ''}
      `
      modal.appendChild(reviewDiv)
    } catch { /* skip if unparseable */ }
  }

  // Requested changes
  if (lead.requested_changes) {
    const changes = document.createElement('div')
    changes.style.cssText = 'background:var(--bg);padding:10px;border-radius:4px;font-size:11px;margin-bottom:16px;white-space:pre-wrap;color:var(--yellow)'
    changes.textContent = lead.requested_changes
    const changesLabel = document.createElement('div')
    changesLabel.style.cssText = 'font-size:11px;font-weight:600;margin-bottom:4px;color:var(--text)'
    changesLabel.textContent = 'Requested Changes'
    modal.appendChild(changesLabel)
    modal.appendChild(changes)
  }

  // Error
  if (lead.error) {
    const errDiv = document.createElement('div')
    errDiv.style.cssText = 'background:rgba(248,113,113,0.1);border:1px solid var(--red);padding:10px;border-radius:4px;font-size:11px;margin-bottom:16px;color:var(--red)'
    errDiv.textContent = lead.error
    modal.appendChild(errDiv)
  }

  // Site link
  if (lead.vercel_deployment_url) {
    const siteDiv = document.createElement('div')
    siteDiv.style.cssText = 'margin-bottom:16px'
    siteDiv.innerHTML = `<a href="${lead.vercel_deployment_url}" target="_blank" class="btn btn-sm" style="color:var(--cyan);border-color:var(--cyan);text-decoration:none">View Live Site</a>`
    modal.appendChild(siteDiv)
  }

  // Queue history
  if (data.queueHistory?.length) {
    const qLabel = document.createElement('div')
    qLabel.style.cssText = 'font-size:11px;font-weight:600;margin-bottom:6px;color:var(--text)'
    qLabel.textContent = 'Pipeline Journey'
    modal.appendChild(qLabel)

    const timeline = document.createElement('div')
    timeline.style.cssText = 'margin-bottom:16px'
    for (const item of data.queueHistory) {
      const t = document.createElement('div')
      const time = new Date(item.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      const statusIcon = item.status === 'completed' ? '✅' : item.status === 'failed' ? '❌' : item.status === 'processing' ? '⚡' : '⏳'
      t.style.cssText = 'font-size:11px;padding:3px 0;border-left:2px solid var(--border);padding-left:10px;margin-left:6px;color:var(--text-dim)'
      t.innerHTML = `${statusIcon} <strong>${item.queue_name}</strong> — ${item.status} <span style="margin-left:8px;opacity:0.6">${time}</span>`
      if (item.error) t.innerHTML += `<div style="color:var(--red);font-size:10px;margin-top:2px">${item.error}</div>`
      timeline.appendChild(t)
    }
    modal.appendChild(timeline)
  }

  // Agent logs
  if (data.logs?.length) {
    const lLabel = document.createElement('div')
    lLabel.style.cssText = 'font-size:11px;font-weight:600;margin-bottom:6px;color:var(--text)'
    lLabel.textContent = 'Agent Logs'
    modal.appendChild(lLabel)

    const logsDiv = document.createElement('div')
    logsDiv.style.cssText = 'background:var(--bg);border-radius:4px;padding:8px;max-height:200px;overflow-y:auto;font-family:monospace;font-size:10px'
    for (const log of data.logs) {
      const time = new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const color = log.level === 'success' ? 'var(--green)' : log.level === 'error' ? 'var(--red)' : log.level === 'warn' ? 'var(--yellow)' : 'var(--text-dim)'
      const line = document.createElement('div')
      line.style.cssText = `padding:2px 0;color:${color}`
      line.innerHTML = `<span style="color:#555">${time}</span> <span style="font-weight:bold">[${log.agent}]</span> ${log.message}`
      logsDiv.appendChild(line)
    }
    modal.appendChild(logsDiv)
  }

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // Close on Escape
  const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler) } }
  document.addEventListener('keydown', escHandler)
}

function field(label, value) {
  if (!value) return ''
  return `<div><span class="text-dim">${label}:</span> <span style="color:var(--text)">${value}</span></div>`
}
