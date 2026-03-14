/**
 * Office Init — Entry point: initializes the full pixel art office
 * Adapted from pixel-agent-desk office-init.js
 */

import { loadAvatarFiles, loadSpriteFrames, PIPELINE_AGENTS } from './config.js'
import { officeRenderer } from './renderer.js'
import { officeCharacters } from './character.js'

let officeInitialized = false

// Track spawned worker clones per queue: { build: 4, deploy: 1, ... }
let activeWorkerCounts = {}

export async function initOffice(canvas) {
  if (officeInitialized) {
    officeRenderer.resume()
    return
  }

  // Load shared config before anything else
  await Promise.all([loadAvatarFiles(), loadSpriteFrames()])

  // Show loading indicator
  const container = canvas.parentElement
  let loadingEl = container.querySelector('.office-loading')
  if (!loadingEl) {
    loadingEl = document.createElement('div')
    loadingEl.className = 'office-loading'
    loadingEl.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);color:#fff;font-size:14px;z-index:10;font-family:monospace;'
    loadingEl.textContent = 'Loading Office...'
    container.style.position = 'relative'
    container.appendChild(loadingEl)
  }

  try {
    await officeRenderer.init(canvas)
  } catch (e) {
    console.error('[Office] Init failed:', e)
    if (loadingEl) loadingEl.textContent = 'Failed to load office view'
    return
  }

  if (loadingEl) loadingEl.remove()
  officeInitialized = true
}

/**
 * Update agent states from SSE data
 * Maps queue stats + processing items → pipeline agent working/idle/paused states
 * Uses worker names from config, and shows what each agent is working on
 */
export function updateOfficeFromSSE(data) {
  if (!officeInitialized) return

  // Force idle — ONLY on explicit force (finish work day button), never from _workday alone
  // If there's queue activity, the workday is implicitly active
  const hasQueueWork = data.queues && Object.values(data.queues).some(q => q.processing > 0 || q.pending > 0)
  if (data._forceIdle && !hasQueueWork) {
    // Idle all base agents
    for (const agent of PIPELINE_AGENTS) {
      officeCharacters.updateCharacter({
        id: agent.id,
        name: agent.name,
        title: agent.title,
        status: 'idle',
        lastMessage: null,
      })
    }
    // Idle all clones too (they stay in the office but sleep)
    for (const char of officeCharacters.getCharacterArray()) {
      if (char.id.includes('-') && /\d+$/.test(char.id)) {
        officeCharacters.updateCharacter({
          id: char.id,
          name: char.role,
          title: char.title,
          status: 'idle',
          lastMessage: null,
        })
      }
    }
    return
  }

  const queueMap = {
    verify: 'agent-verify',
    copywrite: 'agent-copywrite',
    build: 'agent-build',
    seo: 'agent-seo',
    review: 'agent-review',
    deploy: 'agent-deploy',
    call: 'agent-call',
    followup: 'agent-followup',
    close: 'agent-close',
  }

  const queueToLogAgent = {
    verify: 'verifier',
    copywrite: 'copywriter',
    build: 'builder',
    seo: 'seo',
    review: 'reviewer',
    deploy: 'deployer',
    call: 'caller',
    followup: 'followup',
    close: 'closer',
  }

  // Worker names from config (user can override)
  const names = data.workerNames || {}
  const concurrency = data.concurrency || {}

  // Build a map of what each queue is currently processing (lead names, multiple)
  const processingByQueue = {}
  if (data.processingItems) {
    for (const item of data.processingItems) {
      if (!processingByQueue[item.queue_name]) processingByQueue[item.queue_name] = []
      processingByQueue[item.queue_name].push(item.leads?.name || 'Lead')
    }
  }

  // Collect pipeline-wide context for idle behaviours
  const totalLeads = data.activeLeads?.length || 0
  const hasActivity = data.recentLogs?.length > 0
  const deployedLeads = data.activeLeads?.filter(l => ['deployed', 'emailed', 'called', 'booked', 'closed', 'paid'].includes(l.status)) || []
  const calledLeads = data.activeLeads?.filter(l => ['called', 'hitl_ready'].includes(l.status)) || []
  const bookedLeads = data.activeLeads?.filter(l => l.status === 'booked') || []
  const paidLogs = data.recentLogs?.filter(l => l.agent === 'cron' && l.message.includes('Payment')) || []

  // Idle behaviour flavour text — rotates on a slow timer
  const idleCycle = Math.floor(Date.now() / 12000) // changes every 12s

  // Unique names for worker clones per role
  const CLONE_NAMES = {
    verify:    ['Aisha Patel', 'Daniel Koh', 'Fiona Byrne', 'Leo Nguyen', 'Rosa Mendez', 'Yuki Tanaka', 'Omar Hassan', 'Chloe Adams', 'Ivan Petrov'],
    copywrite: ['Nora Abbasi', 'Felix Drummond', 'Ines Cardoso', 'Tobias Engström', 'Priya Mohan', 'Clara Dubois', 'Stefan Radev', 'Jade Thornton', 'Emeka Nnadi'],
    build:     ['Kai Nakamura', 'Elena Volkov', 'Rahul Desai', 'Megan O\'Brien', 'Tariq Osman', 'Lena Johansson', 'Diego Reyes', 'Amara Diallo', 'Finn McCarthy'],
    seo:       ['Harper Quinn', 'Samir Beloufa', 'Astrid Holm', 'Rohan Puri', 'Camille Leroy', 'Brandon Osei', 'Petra Novak', 'Jasper Kim', 'Lucia Vargas'],
    review:    ['Yara Farouk', 'Max Eisenberg', 'Suki Ito', 'David Brennan', 'Ananya Rao', 'Simon Lefèvre', 'Thandi Nkosi', 'Oscar Eng', 'Maren Svendsen'],
    deploy:    ['Sam Okafor', 'Ingrid Larsen', 'Ravi Kapoor', 'Holly Chambers', 'Jamal Wright', 'Anya Kowalski', 'Lucas Ferreira', 'Nadia Petrova', 'Ben Hartley'],
    call:      ['Olivia Barnes', 'Kofi Mensah', 'Isla MacLeod', 'Arjun Reddy', 'Freya Nielsen', 'Dante Moretti', 'Zoe Papadopoulos', 'Liam Chen', 'Mila Sorokin'],
    followup:  ['Hannah Osei', 'Ethan Gallagher', 'Fatima Al-Rashid', 'Jake Morrison', 'Sara Lindqvist', 'Mateo Cruz', 'Ruby Blackwood', 'Ali Hussain', 'Cara Doyle'],
    close:     ['Victoria Obi', 'Nathan Archer', 'Layla Khoury', 'Oscar Fleming', 'Mei Lin Wu', 'Ryan Kavanagh', 'Amina Conteh', 'Hugo Delacroix', 'Tessa Brennan'],
  }

  // Update queue-based agents (with concurrency clones)
  if (data.queues && data.queueStates) {
    for (const [qName, stats] of Object.entries(data.queues)) {
      const baseAgentId = queueMap[qName]
      if (!baseAgentId) continue

      const agentDef = PIPELINE_AGENTS.find(a => a.id === baseAgentId)
      if (!agentDef) continue

      const workerCount = concurrency[qName] || 1
      const prevCount = activeWorkerCounts[qName] || 1
      const processingLeads = processingByQueue[qName] || []

      // Spawn or remove clones to match concurrency
      if (workerCount > prevCount) {
        for (let i = prevCount + 1; i <= workerCount; i++) {
          const cloneId = `agent-${qName}-${i}`
          const cloneName = (CLONE_NAMES[qName]?.[i - 2] || `${names[qName] || agentDef.name} #${i}`)
          officeCharacters.addCharacter({
            id: cloneId,
            name: cloneName,
            title: agentDef.title,
            status: 'idle',
            avatarIndex: (agentDef.avatar + i) % 8,
          })
        }
      } else if (workerCount < prevCount) {
        for (let i = workerCount + 1; i <= prevCount; i++) {
          officeCharacters.removeCharacter(`agent-${qName}-${i}`)
        }
      }
      activeWorkerCounts[qName] = workerCount

      // Determine base status
      let baseStatus = 'idle'
      let baseMessage = null

      if (data.queueStates[qName] === 'paused') {
        baseStatus = 'paused'
      } else if (stats.processing > 0) {
        baseStatus = 'working'
        baseMessage = processingLeads[0] || `Processing...`
      } else if (stats.pending > 0 || stats.pending_approval > 0) {
        baseStatus = 'thinking'
        baseMessage = `${stats.pending + stats.pending_approval} waiting`
      }

      // Check recent logs for this agent's latest activity message
      if (baseStatus === 'working' && data.recentLogs) {
        const logAgent = queueToLogAgent[qName]
        const recentLog = data.recentLogs.find(
          l => l.agent === logAgent && Date.now() - new Date(l.created_at).getTime() < 60000
        )
        if (recentLog) {
          const msg = recentLog.message
          baseMessage = msg.length > 35 ? msg.slice(0, 32) + '...' : msg
        }
      }

      // Idle behaviours
      if (baseStatus === 'idle') {
        const idleBehaviour = getIdleBehaviour(qName, idleCycle, { totalLeads, deployedLeads, calledLeads, bookedLeads, data })
        if (idleBehaviour) {
          baseStatus = idleBehaviour.status
          baseMessage = idleBehaviour.message
        }
      }

      // Update the primary agent (worker #1)
      officeCharacters.updateCharacter({
        id: baseAgentId,
        name: names[qName] || agentDef.name,
        title: agentDef.title,
        status: baseStatus,
        lastMessage: baseMessage,
      })

      // Update clone workers (#2, #3, ...)
      for (let i = 2; i <= workerCount; i++) {
        const cloneId = `agent-${qName}-${i}`
        const cloneName = (CLONE_NAMES[qName]?.[i - 2] || `${names[qName] || agentDef.name} #${i}`)

        // Each clone can show a different processing lead if available
        let cloneStatus = baseStatus
        let cloneMsg = baseMessage

        if (stats.processing >= i && processingLeads[i - 1]) {
          cloneStatus = 'working'
          cloneMsg = processingLeads[i - 1]
        }
        // Clones just mirror base status — no extra thinking

        officeCharacters.updateCharacter({
          id: cloneId,
          name: cloneName,
          title: agentDef.title,
          status: cloneStatus,
          lastMessage: cloneMsg,
        })
      }
    }
  }

  // Scout (Maya): check recent logs, idle = researching markets
  if (data.recentLogs) {
    const recentScout = data.recentLogs.find(
      l => l.agent === 'scout' && Date.now() - new Date(l.created_at).getTime() < 30000
    )
    const scoutDef = PIPELINE_AGENTS.find(a => a.id === 'agent-scout')
    let scoutStatus = recentScout ? 'working' : 'idle'
    let scoutMsg = recentScout ? trimMsg(recentScout.message) : null

    if (scoutStatus === 'idle' && totalLeads > 0) {
      const scoutThoughts = ['Scanning Google Maps', 'Researching new areas', 'Reviewing lead quality', 'Mapping business density']
      const scoutPhase = (Date.now() + 41000) % 150000  // 150s cycle, offset
      if (scoutPhase < 8000) {
        scoutStatus = 'thinking'
        scoutMsg = scoutThoughts[Math.floor(Date.now() / 15000) % scoutThoughts.length]
      }
    }

    officeCharacters.updateCharacter({
      id: 'agent-scout',
      name: names.scout || scoutDef.name,
      title: scoutDef.title,
      status: scoutStatus,
      lastMessage: scoutMsg,
    })

    // Delivery (Zara): check recent logs, idle = reviewing client specs
    const recentDelivery = data.recentLogs.find(
      l => l.agent === 'delivery' && Date.now() - new Date(l.created_at).getTime() < 60000
    )
    const deliverDef = PIPELINE_AGENTS.find(a => a.id === 'agent-deliver')
    let deliverStatus = recentDelivery ? 'working' : 'idle'
    let deliverMsg = recentDelivery ? trimMsg(recentDelivery.message) : null

    if (deliverStatus === 'idle' && deployedLeads.length > 0) {
      const deliverThoughts = ['Reviewing client specs', 'QA checking live sites', 'Testing mobile layouts', 'Updating project board']
      const deliverPhase = (Date.now() + 73000) % 130000  // 130s cycle, offset
      if (deliverPhase < 8000) {
        deliverStatus = 'thinking'
        deliverMsg = deliverThoughts[Math.floor(Date.now() / 15000) % deliverThoughts.length]
      }
    }

    officeCharacters.updateCharacter({
      id: 'agent-deliver',
      name: names.deliver || deliverDef.name,
      title: deliverDef.title,
      status: deliverStatus,
      lastMessage: deliverMsg,
    })

    // Monitor (Ava): check recent logs, idle = scanning engagement signals
    const recentMonitor = data.recentLogs.find(
      l => l.agent === 'monitor' && Date.now() - new Date(l.created_at).getTime() < 60000
    )
    const monitorDef = PIPELINE_AGENTS.find(a => a.id === 'agent-monitor')
    let monitorStatus = recentMonitor ? 'working' : 'idle'
    let monitorMsg = recentMonitor ? trimMsg(recentMonitor.message) : null

    if (monitorStatus === 'idle' && deployedLeads.length > 0) {
      const monitorThoughts = ['Scanning email opens', 'Checking call outcomes', 'Scoring lead warmth', 'Tracking click-throughs']
      const monitorPhase = (Date.now() + 97000) % 110000  // 110s cycle, offset
      if (monitorPhase < 8000) {
        monitorStatus = 'thinking'
        monitorMsg = monitorThoughts[Math.floor(Date.now() / 15000) % monitorThoughts.length]
      }
    }

    officeCharacters.updateCharacter({
      id: 'agent-monitor',
      name: names.monitor || monitorDef.name,
      title: monitorDef.title,
      status: monitorStatus,
      lastMessage: monitorMsg,
    })
  }

  // CEO (Stephen): thinks ~20% of the time, works when lots of leads
  const ceoDef = PIPELINE_AGENTS.find(a => a.id === 'agent-ceo')
  const ceoThoughts = ['Reading industry news', 'Reviewing pipeline metrics', 'Drafting strategy update', 'Planning next sprint', 'Writing investor update', 'Analysing market trends']
  let ceoStatus = 'idle'
  let ceoMsg = null
  if (totalLeads > 5) {
    ceoStatus = 'working'
    ceoMsg = `Overseeing ${totalLeads} leads`
  } else {
    const ceoPhase = (Date.now() + 20000) % 60000  // 60s cycle — thinks for 12s (~20%)
    if (ceoPhase < 12000) {
      ceoStatus = 'thinking'
      ceoMsg = ceoThoughts[Math.floor(Date.now() / 20000) % ceoThoughts.length]
    }
  }
  officeCharacters.updateCharacter({
    id: 'agent-ceo',
    name: names.ceo || ceoDef.name,
    title: ceoDef.title,
    status: ceoStatus,
    lastMessage: ceoMsg,
  })

  // Finance (Nina): thinks ~15% of the time, works when payments come in
  const finDef = PIPELINE_AGENTS.find(a => a.id === 'agent-finance')
  const finThoughts = ['Reconciling Stripe', 'Updating cash forecast', 'Reviewing cost per lead', 'Calculating margins', 'Reviewing pricing model', 'Auditing expenses']
  let finStatus = 'idle'
  let finMsg = null
  if (paidLogs.length > 0) {
    finStatus = 'working'
    finMsg = 'Processing payment'
  } else {
    const finPhase = (Date.now() + 55000) % 80000  // 80s cycle — thinks for 10s (~12%)
    if (finPhase < 10000) {
      finStatus = 'thinking'
      finMsg = finThoughts[Math.floor(Date.now() / 18000) % finThoughts.length]
    }
  }
  officeCharacters.updateCharacter({
    id: 'agent-finance',
    name: names.finance || finDef.name,
    title: finDef.title,
    status: finStatus,
    lastMessage: finMsg,
  })
}

function trimMsg(msg) {
  return msg.length > 35 ? msg.slice(0, 32) + '...' : msg
}

/**
 * Idle behaviours — SPARSE. Only one agent thinks at a time, briefly.
 * Most agents sit idle most of the time. A "spotlight" rotates slowly.
 * ~5% of agents are thinking at any given moment.
 */
const IDLE_THOUGHTS = {
  verify: ['Cross-checking Companies House', 'Reviewing viability criteria', 'Auditing lead sources', 'Flagging duplicates'],
  copywrite: ['Crafting brand narratives', 'Researching industry tone', 'Refining value propositions', 'Building content briefs'],
  build: ['Reviewing design templates', 'Studying competitor sites', 'Refining colour palettes', 'Updating component library'],
  seo: ['Analysing keyword density', 'Checking schema markup', 'Reviewing meta descriptions', 'Auditing site structure'],
  review: ['Scanning for vulnerabilities', 'Checking accessibility scores', 'Validating HTML structure', 'Running performance checks'],
  deploy: ['Checking Vercel status', 'Monitoring deploy health', 'Testing CDN performance', 'Updating deploy configs'],
  call: ['Prepping call scripts', 'Reviewing lead profiles', 'Practising objection handling', 'Updating CRM notes'],
  followup: ['Drafting follow-up messages', 'Reviewing client feedback', 'Personalising outreach', 'Tracking open rates'],
  close: ['Preparing proposals', 'Reviewing pricing packages', 'Rehearsing demo flow', 'Checking Stripe links'],
}

function getIdleBehaviour(queueName, _cycle, ctx) {
  const { totalLeads } = ctx
  if (totalLeads === 0) return null

  const thoughts = IDLE_THOUGHTS[queueName]
  if (!thoughts) return null

  // Each agent only thinks for ~8s out of every ~120s (unique per agent)
  const hash = hashStr(queueName)
  const cycleLen = 100000 + (hash % 8) * 20000  // 100-260s per cycle
  const offset = (hash * 13337) % cycleLen
  const phase = (Date.now() + offset) % cycleLen

  // Think for first 8s of cycle only
  if (phase > 8000) return null

  return {
    status: 'thinking',
    message: thoughts[Math.floor(Date.now() / 15000 + hash) % thoughts.length],
  }
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return Math.abs(h)
}

export function stopOffice() {
  officeRenderer.stop()
}

export function resumeOffice() {
  if (officeInitialized) officeRenderer.resume()
}
