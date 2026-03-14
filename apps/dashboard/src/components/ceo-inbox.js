/**
 * CEO Inbox — Owner sends periodic email updates to the dashboard
 * Mocked for now — generates contextual emails based on live pipeline data
 */

const CEO_NAME = import.meta.env.VITE_AGENCY_OWNER_NAME || 'The Owner'
const CEO_TITLE = `Chief Executive, ${import.meta.env.VITE_AGENCY_NAME || 'Web Agency'}`

const EMAIL_TEMPLATES = [
  {
    trigger: (d) => d.totalLeads >= 1 && d.totalLeads <= 5,
    subject: 'Pipeline warming up',
    body: (d) => `Team,\n\nWe've got ${d.totalLeads} leads in the pipeline now. Good start. Let's make sure the verification process is tight — I don't want us wasting build cycles on businesses that have shut down.\n\nKeep an eye on the viability scores and flag anything under 50.\n\nStephen`,
  },
  {
    trigger: (d) => d.deployed > 0 && d.deployed <= 3,
    subject: 'First sites deployed — check quality',
    body: (d) => `Team,\n\n${d.deployed} site${d.deployed > 1 ? 's are' : ' is'} now live on Vercel. I want someone to eyeball each one before we start calling. The site IS the pitch — if it looks rough, we lose them on the phone.\n\nPriya, Tom — make sure we're proud of what's going out.\n\nStephen`,
  },
  {
    trigger: (d) => d.totalLeads >= 10,
    subject: 'Scaling up — pipeline at double digits',
    body: (d) => `Team,\n\nWe've passed ${d.totalLeads} leads. This is exactly where we need to be. A few things:\n\n1. Builder concurrency — consider bumping to 2-3 workers if the queue is backing up\n2. Call window — we're only calling during business hours. Make sure the queue doesn't get clogged overnight\n3. Quality > quantity — reject anything that doesn't feel right\n\nGreat work so far.\n\nStephen`,
  },
  {
    trigger: (d) => d.called > 0,
    subject: 'Calls going out — watch the outcomes',
    body: (d) => `Team,\n\nAlex has made ${d.called} call${d.called > 1 ? 's' : ''} so far. I want to see the conversion — how many are interested vs voicemail vs not interested.\n\nIf we're getting a lot of voicemails, we should consider the time of day we're calling. Barbers are busy mornings. Takeaways are busy evenings. Let's be smart about this.\n\nStephen`,
  },
  {
    trigger: (d) => d.rejected > 3,
    subject: 'RE: High rejection rate',
    body: (d) => `Team,\n\n${d.rejected} leads rejected so far. That's ${d.totalLeads > 0 ? Math.round(d.rejected / d.totalLeads * 100) : 0}% rejection rate. If it's mostly from verification (dissolved companies), that's fine — the filter is working.\n\nBut if we're losing them at the call stage, we need to look at the script. Sophie, can you review the last few call transcripts?\n\nStephen`,
  },
  {
    trigger: (d) => d.paid > 0,
    subject: 'REVENUE!',
    body: (d) => `Team,\n\nWe have ${d.paid} paid client${d.paid > 1 ? 's' : ''}! This is what it's all about. Nina's processing the payment${d.paid > 1 ? 's' : ''} now.\n\nZara — kick off delivery immediately. I want these clients seeing changes within 24 hours. First impressions matter and right now they're excited. Let's capitalise.\n\nProud of the team.\n\nStephen`,
  },
  {
    trigger: (d) => d.booked > 0,
    subject: 'Demos booked — closing time',
    body: (d) => `Team,\n\n${d.booked} demo${d.booked > 1 ? 's' : ''} booked! Marcus, these are warm leads — they've seen the site, they're interested. The closing call should be consultative, not pushy. Ask them what they'd change, get them excited about the possibilities.\n\nDon't forget to mention the domain and email setup as part of the package.\n\nStephen`,
  },
  {
    trigger: () => true,
    subject: 'Morning update',
    body: (d) => `Team,\n\nQuick status check. We have ${d.totalLeads} leads in the system across all stages. The pipeline is ${d.totalLeads > 0 ? 'running' : 'quiet — time to fire up a new scout run'}.\n\nReminder: our goal is 10 paying clients this month. Every lead matters.\n\nStephen`,
  },
]

let lastEmailTime = 0
let sentTriggers = new Set()
let emailHistory = []

export function generateCEOEmails(data) {
  const now = Date.now()
  if (now - lastEmailTime < 30000) return emailHistory

  const stats = {
    totalLeads: data.activeLeads?.length || 0,
    deployed: data.activeLeads?.filter(l => ['deployed', 'emailed', 'called', 'booked', 'closed'].includes(l.status)).length || 0,
    called: data.activeLeads?.filter(l => ['called', 'hitl_ready'].includes(l.status)).length || 0,
    rejected: data.activeLeads?.filter(l => l.status === 'rejected').length || 0,
    paid: data.activeLeads?.filter(l => l.status === 'paid').length || 0,
    booked: data.activeLeads?.filter(l => l.status === 'booked').length || 0,
  }

  for (const template of EMAIL_TEMPLATES) {
    const key = template.subject
    if (sentTriggers.has(key)) continue
    if (!template.trigger(stats)) continue
    if (key === 'Morning update' && stats.totalLeads === 0) continue

    const email = {
      id: Math.random().toString(36).slice(2),
      from: `${CEO_NAME} <${import.meta.env.VITE_AGENCY_EMAIL || 'ceo@agency.com'}>`,
      fromTitle: CEO_TITLE,
      subject: template.subject,
      body: template.body(stats),
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      timestamp: now,
      read: false,
      open: false,
    }

    emailHistory.unshift(email)
    sentTriggers.add(key)
    lastEmailTime = now

    if (emailHistory.length > 10) emailHistory = emailHistory.slice(0, 10)
    break
  }

  return emailHistory
}

export function resetCEOInbox() {
  emailHistory = []
  sentTriggers = new Set()
  lastEmailTime = 0
}

// Track last rendered count to avoid unnecessary re-renders
let lastRenderedCount = -1

export function renderCEOInbox(container, emails) {
  if (!emails?.length) {
    if (lastRenderedCount !== 0) {
      container.innerHTML = ''
      lastRenderedCount = 0
    }
    return
  }

  // Only re-render if email count changed (new email arrived)
  if (emails.length === lastRenderedCount) {
    // Just update the unread count badge
    const badge = container.querySelector('.inbox-unread-count')
    const unread = emails.filter(e => !e.read).length
    if (badge) badge.textContent = unread > 0 ? `${unread} new` : ''
    return
  }

  lastRenderedCount = emails.length

  container.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'card'

  const unread = emails.filter(e => !e.read).length
  card.innerHTML = `<h2>CEO's Inbox <span class="inbox-unread-count" style="color:var(--accent);font-size:10px;margin-left:8px">${unread > 0 ? `${unread} new` : ''}</span></h2>`

  const list = document.createElement('div')
  list.style.maxHeight = '400px'
  list.style.overflowY = 'auto'

  for (const email of emails) {
    const div = document.createElement('div')
    div.style.cssText = `padding:10px 12px;border-bottom:1px solid var(--border);cursor:pointer;${email.read ? 'opacity:0.7' : ''}`

    const bodyDiv = document.createElement('div')
    bodyDiv.style.cssText = `display:${email.open ? 'block' : 'none'};margin-top:8px;padding:10px;background:var(--bg);border-radius:4px;font-size:12px;line-height:1.6;white-space:pre-wrap;color:var(--text)`
    bodyDiv.textContent = email.body

    div.innerHTML = `
      <div class="flex justify-between items-center">
        <div>
          ${!email.read ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:6px"></span>' : ''}
          <strong style="font-size:12px">${email.subject}</strong>
        </div>
        <span class="text-dim" style="font-size:10px">${email.time}</span>
      </div>
      <div class="text-dim text-sm" style="margin-top:2px">From: ${email.from}</div>
    `
    div.appendChild(bodyDiv)

    div.addEventListener('click', () => {
      email.open = !email.open
      bodyDiv.style.display = email.open ? 'block' : 'none'
      email.read = true
      div.style.opacity = '0.7'
      const dot = div.querySelector('span[style*="border-radius:50%"]')
      if (dot) dot.remove()
      // Update badge
      const badge = container.querySelector('.inbox-unread-count')
      const remaining = emails.filter(e => !e.read).length
      if (badge) badge.textContent = remaining > 0 ? `${remaining} new` : ''
    })

    list.appendChild(div)
  }

  card.appendChild(list)
  container.appendChild(card)
}
