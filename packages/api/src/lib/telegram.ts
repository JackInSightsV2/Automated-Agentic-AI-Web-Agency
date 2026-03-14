import TelegramBot from 'node-telegram-bot-api'
import { supabase } from './supabase'
import { agentLog } from './logger'
import type { QueueItem, Lead, QueueName } from '../types'

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN!, { polling: true })
const ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_CHAT_ID!)

// ── Notify helpers ──────────────────────────────────────────────────

export async function notify(message: string, opts?: { leadId?: string; silent?: boolean }) {
  const link = opts?.leadId ? `\n🔗 /lead_${opts.leadId.slice(0, 8)}` : ''
  await bot.sendMessage(ADMIN_ID, message + link, {
    parse_mode: 'Markdown',
    disable_notification: opts?.silent
  })
}

export async function notifyHITL(lead: any) {
  const keyboard = {
    inline_keyboard: [[
      { text: '📲 Send Site Link', callback_data: `sendsite_${lead.id}` },
      { text: '📅 Send Booking', callback_data: `book_${lead.id}` },
    ], [
      { text: '❌ Reject', callback_data: `reject_${lead.id}` }
    ]]
  }
  await bot.sendMessage(ADMIN_ID,
    `🔔 *HITL Ready*\n\n` +
    `*${lead.name}*\n` +
    `📍 ${lead.address || 'N/A'}\n` +
    `📞 ${lead.phone}\n` +
    `🏷️ ${lead.category}\n\n` +
    `🌐 [View Site](${lead.vercel_deployment_url})\n` +
    `📊 Rating: ${lead.google_rating || 'N/A'} ⭐`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  )
}

/** Queue HITL approval notification with inline keyboard */
export async function notifyQueueApproval(item: QueueItem, lead: Lead) {
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `qapprove_${item.id}` },
      { text: '⏭ Skip', callback_data: `qskip_${item.id}` },
    ], [
      { text: '⏸ Pause Queue', callback_data: `qpause_${item.queue_name}` }
    ]]
  }

  const scoreText = lead.viability_score !== null ? `\n📊 Viability: ${lead.viability_score}/100` : ''

  await bot.sendMessage(ADMIN_ID,
    `🔔 *Approval Required: ${item.queue_name.toUpperCase()}*\n\n` +
    `*${lead.name}*\n` +
    `📍 ${lead.address || 'N/A'}\n` +
    `📞 ${lead.phone || 'N/A'}\n` +
    `🏷️ ${lead.category || 'N/A'}${scoreText}\n` +
    `${lead.vercel_deployment_url ? `🌐 [View Site](${lead.vercel_deployment_url})` : ''}`,
    { parse_mode: 'Markdown', reply_markup: keyboard }
  )
}

// ── Commands ────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return
  await bot.sendMessage(ADMIN_ID,
    `🤖 *${process.env.AGENCY_NAME || 'Web Agency'} — WebAgency OS v2*\n\n` +
    `*Pipeline:*\n` +
    `/run [type] [city] — Start pipeline\n` +
    `/status — Pipeline overview\n` +
    `/leads — Recent leads\n` +
    `/stats — Today's numbers\n\n` +
    `*Queues:*\n` +
    `/queues — Queue stats + states\n` +
    `/hitl [queue] on|off — Toggle HITL\n` +
    `/hours HH:MM HH:MM — Set business hours\n` +
    `/workers [queue] [n] — Set concurrency\n` +
    `/pause — Pause all queues\n` +
    `/resume — Resume all queues`,
    { parse_mode: 'Markdown' }
  )
})

bot.onText(/\/run (.+)/, async (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return
  const parts = match![1].split(' ')
  const city = parts.pop() || 'London'
  const type = parts.join(' ') || parts[0]

  await bot.sendMessage(ADMIN_ID, `🚀 Starting pipeline: *${type}* in *${city}*...`, { parse_mode: 'Markdown' })

  const { runPipeline } = await import('../routes/pipeline')
  const { data: run } = await supabase
    .from('pipeline_runs')
    .insert({ query: type, location: city })
    .select()
    .single()

  if (run) {
    runPipeline(run.id, `${type} ${city}`).catch(console.error)
    await bot.sendMessage(ADMIN_ID, `✅ Pipeline started: \`${run.id}\``, { parse_mode: 'Markdown' })
  }
})

bot.onText(/\/status/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return

  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(3)

  const { count: hitl } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'hitl_ready')

  const lines = runs?.map(r =>
    `• ${r.query} — ${r.leads_processed}/${r.leads_found} leads ${r.completed_at ? '✅' : '🔄'}`
  ) || []

  await bot.sendMessage(ADMIN_ID,
    `📊 *Pipeline Status*\n\n${lines.join('\n') || 'No runs yet'}\n\n🔔 HITL Queue: *${hitl || 0}* leads waiting`,
    { parse_mode: 'Markdown' }
  )
})

bot.onText(/\/queues/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return

  const { getQueueStats, getQueueStates, getHITLConfig } = await import('./queue')
  const stats = await getQueueStats()
  const states = await getQueueStates()
  const hitlConfig = await getHITLConfig()

  const lines = Object.entries(stats).map(([name, s]) => {
    const state = states[name as QueueName]
    const hitl = hitlConfig[name as QueueName]
    const icon = state === 'active' ? '🟢' : '🔴'
    return `${icon} *${name}* (${hitl}) — ${s.pending} pending, ${s.processing} processing, ${s.failed} failed, ${s.pending_approval} awaiting`
  })

  await bot.sendMessage(ADMIN_ID,
    `📋 *Queue Status*\n\n${lines.join('\n')}`,
    { parse_mode: 'Markdown' }
  )
})

bot.onText(/\/queue$/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'hitl_ready')
    .limit(5)

  if (!leads?.length) {
    await bot.sendMessage(ADMIN_ID, '✅ No leads in HITL queue')
    return
  }

  for (const lead of leads) {
    await notifyHITL(lead)
  }
})

bot.onText(/\/hitl (\w+) (on|off)/, async (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return
  const queueName = match![1] as QueueName
  const mode = match![2] === 'on' ? 'hitl' : 'auto'

  const { data: config } = await supabase.from('system_config').select('value').eq('key', 'hitl_config').single()
  const hitlConfig = (config?.value || {}) as Record<string, string>
  hitlConfig[queueName] = mode

  await supabase.from('system_config').update({ value: hitlConfig, updated_at: new Date().toISOString() }).eq('key', 'hitl_config')
  await bot.sendMessage(ADMIN_ID, `${mode === 'hitl' ? '🔔' : '🤖'} *${queueName}* queue set to *${mode}*`, { parse_mode: 'Markdown' })
})

bot.onText(/\/hours (\d{2}:\d{2}) (\d{2}:\d{2})/, async (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return
  const start = match![1]
  const end = match![2]

  const { data: config } = await supabase.from('system_config').select('value').eq('key', 'business_hours').single()
  const hours = (config?.value || {}) as Record<string, unknown>
  hours.start = start
  hours.end = end

  await supabase.from('system_config').update({ value: hours, updated_at: new Date().toISOString() }).eq('key', 'business_hours')
  await bot.sendMessage(ADMIN_ID, `🕐 Business hours set to *${start}–${end}*`, { parse_mode: 'Markdown' })
})

bot.onText(/\/workers (\w+) (\d+)/, async (msg, match) => {
  if (msg.chat.id !== ADMIN_ID) return
  const queueName = match![1] as QueueName
  const count = parseInt(match![2])

  const { setConcurrency } = await import('./queue')
  await setConcurrency(queueName, count)
  await bot.sendMessage(ADMIN_ID, `⚙️ *${queueName}* concurrency set to *${count}*`, { parse_mode: 'Markdown' })
})

bot.onText(/\/leads/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return

  const { data: leads } = await supabase
    .from('leads')
    .select('name, status, phone, category, viability_score')
    .order('created_at', { ascending: false })
    .limit(10)

  if (!leads?.length) {
    await bot.sendMessage(ADMIN_ID, 'No leads yet')
    return
  }

  const lines = leads.map(l => {
    const score = l.viability_score !== null ? ` (${l.viability_score}pts)` : ''
    return `• *${l.name}* (${l.category}) — ${l.status}${score}\n  📞 ${l.phone || 'N/A'}`
  })
  await bot.sendMessage(ADMIN_ID, `📋 *Recent Leads*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' })
})

bot.onText(/\/stats/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return

  const counts: Record<string, number> = {}

  for (const status of ['discovered', 'verified', 'built', 'deployed', 'emailed', 'called', 'clicked', 'booked', 'hitl_ready', 'closed', 'paid', 'delivered', 'rejected']) {
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    counts[status] = count || 0
  }

  await bot.sendMessage(ADMIN_ID,
    `📈 *Stats*\n\n` +
    `🔍 Discovered: ${counts.discovered}\n` +
    `✅ Verified: ${counts.verified}\n` +
    `🏗️ Built: ${counts.built}\n` +
    `🌐 Deployed: ${counts.deployed}\n` +
    `📧 Emailed: ${counts.emailed}\n` +
    `📞 Called: ${counts.called}\n` +
    `👆 Clicked: ${counts.clicked}\n` +
    `📅 Booked: ${counts.booked}\n` +
    `🔔 HITL Ready: ${counts.hitl_ready}\n` +
    `💰 Closed: ${counts.closed}\n` +
    `💳 Paid: ${counts.paid}\n` +
    `📦 Delivered: ${counts.delivered}\n` +
    `❌ Rejected: ${counts.rejected}`,
    { parse_mode: 'Markdown' }
  )
})

bot.onText(/\/pause$/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return
  const { setQueueState } = await import('./queue')
  const queues: QueueName[] = ['verify', 'build', 'deploy', 'call', 'followup', 'close']
  for (const q of queues) await setQueueState(q, 'paused')
  await bot.sendMessage(ADMIN_ID, '⏸️ All queues paused. Use /resume to restart.')
})

bot.onText(/\/resume$/, async (msg) => {
  if (msg.chat.id !== ADMIN_ID) return
  const { setQueueState } = await import('./queue')
  const queues: QueueName[] = ['verify', 'build', 'deploy', 'call', 'followup', 'close']
  for (const q of queues) await setQueueState(q, 'active')
  await bot.sendMessage(ADMIN_ID, '▶️ All queues resumed.')
})

// ── Callback buttons (HITL actions) ─────────────────────────────────

bot.on('callback_query', async (query) => {
  // Validate callback origin — only allow from admin chat
  if (query.message?.chat.id !== ADMIN_ID) return

  const data = query.data || ''

  // Queue approval callbacks
  if (data.startsWith('qapprove_')) {
    const itemId = data.replace('qapprove_', '')
    await supabase.from('queue_items').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', itemId)
    await bot.answerCallbackQuery(query.id, { text: '✅ Approved — will process shortly' })
    await notify('✅ Queue item approved')
    return
  }

  if (data.startsWith('qskip_')) {
    const itemId = data.replace('qskip_', '')
    const { data: item } = await supabase.from('queue_items').select('lead_id').eq('id', itemId).single()
    await supabase.from('queue_items').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', itemId)
    if (item) {
      await supabase.from('leads').update({ status: 'rejected', status_updated_at: new Date().toISOString() }).eq('id', item.lead_id)
    }
    await bot.answerCallbackQuery(query.id, { text: '⏭ Skipped' })
    return
  }

  if (data.startsWith('qpause_')) {
    const queueName = data.replace('qpause_', '') as QueueName
    const { setQueueState } = await import('./queue')
    await setQueueState(queueName, 'paused')
    await bot.answerCallbackQuery(query.id, { text: `⏸ ${queueName} queue paused` })
    await notify(`⏸ *${queueName}* queue paused`)
    return
  }

  // Legacy HITL callbacks
  const parts = data.split('_')
  const action = parts[0]
  const leadId = parts.slice(1).join('_')

  if (action === 'sendsite') {
    const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single()
    if (lead) {
      if (lead.phone) {
        try {
          const { sendClientMessage } = await import('./twilio')
          const contactName = lead.contact_name || lead.name.split(' ')[0]
          await sendClientMessage({
            phone: lead.phone,
            leadId: lead.id,
            message:
              `Hi ${contactName}! This is ${process.env.AGENCY_CALLER_NAME || 'Alex'} from ${process.env.AGENCY_NAME || 'Web Agency'}.\n\n` +
              `Here's the website we built for ${lead.name}:\n\n` +
              `${lead.vercel_deployment_url}\n\n` +
              `Have a look and let us know what you think!`,
          })
          await bot.sendMessage(ADMIN_ID,
            `✅ Site link sent to ${lead.name} (${lead.phone}) via SMS/WhatsApp`,
            { parse_mode: 'Markdown' }
          )
        } catch (err) {
          await bot.sendMessage(ADMIN_ID,
            `❌ Failed to send via Twilio: ${String(err)}\n\n` +
            `Manual fallback — site link for ${lead.name}:\n${lead.vercel_deployment_url}`,
            { parse_mode: 'Markdown' }
          )
        }
      } else {
        await bot.sendMessage(ADMIN_ID,
          `⚠️ No phone number for ${lead.name}.\nSite: ${lead.vercel_deployment_url}`,
          { parse_mode: 'Markdown' }
        )
      }
    }
    await bot.answerCallbackQuery(query.id, { text: '✅ Sent' })
  }

  if (action === 'book') {
    await supabase.from('leads').update({ status: 'booked', status_updated_at: new Date().toISOString() }).eq('id', leadId)
    await bot.answerCallbackQuery(query.id, { text: '✅ Marked as booked' })
    await notify(`✅ Lead marked as booked`)
  }

  if (action === 'reject') {
    await supabase.from('leads').update({ status: 'rejected', status_updated_at: new Date().toISOString() }).eq('id', leadId)
    await bot.answerCallbackQuery(query.id, { text: '❌ Lead rejected' })
    await notify(`❌ Lead rejected`)
  }
})

export { bot }
