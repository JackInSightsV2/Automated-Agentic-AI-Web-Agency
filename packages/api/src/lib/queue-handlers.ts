import { supabase } from './supabase'
import { agentLog } from './logger'
import { enqueue } from './queue'
import { notify } from './telegram'
import { sendClientMessage } from './twilio'
import type { QueueItem } from '../types'
import { runVerifierAgent } from '../agents/verifier'
import { runCopywriterAgent } from '../agents/copywriter'
import { runBuilderAgent } from '../agents/builder'
import { runSeoAgent } from '../agents/seo'
import { runCodeReviewerAgent } from '../agents/code-reviewer'
import { runDeployerAgent } from '../agents/deployer'
import { runCallerAgent } from '../agents/caller'
import { runCloserAgent } from '../agents/closer'

/** Fetch lead with name for logging. Throws if lead doesn't exist. */
async function getLead(leadId: string) {
  const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single()
  if (!lead) throw new Error(`Lead ${leadId} not found`)
  return lead
}

/** Validate lead is in an expected status before processing */
function assertStatus(lead: any, expected: string[], stage: string) {
  if (!expected.includes(lead.status)) {
    throw new Error(`${stage}: lead "${lead.name}" is in status "${lead.status}", expected one of [${expected.join(', ')}]. Skipping to avoid out-of-order processing.`)
  }
}

export async function handleVerify(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['discovered'], 'Verify')
  await agentLog('verifier', `Verifying "${lead.name}" — checking Companies House, HMRC + viability score`, { leadId: item.lead_id })

  const viable = await runVerifierAgent(item.lead_id)

  if (viable) {
    await enqueue({
      leadId: item.lead_id,
      queueName: 'copywrite',
      pipelineRunId: item.pipeline_run_id || undefined,
    })
    await agentLog('verifier', `"${lead.name}" passed verification → queued for copywrite`, { leadId: item.lead_id, level: 'success' })
  } else {
    await agentLog('verifier', `"${lead.name}" failed verification — rejected`, { leadId: item.lead_id, level: 'warn' })
  }
}

export async function handleBuild(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['briefed', 'building'], 'Build')
  await agentLog('builder', `Building website for "${lead.name}" (${lead.category})`, { leadId: item.lead_id })

  await runBuilderAgent(item.lead_id)

  // If this is a change request, skip SEO + review and go straight to deploy
  if (lead.skip_to_deploy) {
    await supabase.from('leads').update({
      skip_to_deploy: false,
      requested_changes: null,
      status: 'reviewed',
      status_updated_at: new Date().toISOString(),
    }).eq('id', item.lead_id)

    await enqueue({
      leadId: item.lead_id,
      queueName: 'deploy',
      pipelineRunId: item.pipeline_run_id || undefined,
    })
    await agentLog('builder', `"${lead.name}" changes applied → queued for deploy (skipping SEO/review)`, { leadId: item.lead_id, level: 'success' })
  } else {
    await enqueue({
      leadId: item.lead_id,
      queueName: 'seo',
      pipelineRunId: item.pipeline_run_id || undefined,
    })
    await agentLog('builder', `"${lead.name}" site built → queued for SEO`, { leadId: item.lead_id, level: 'success' })
  }
}

export async function handleDeploy(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['reviewed'], 'Deploy')
  await agentLog('deployer', `Deploying "${lead.name}" to Vercel`, { leadId: item.lead_id })

  await runDeployerAgent(item.lead_id)

  // Fetch updated deployment URL
  const { data: updatedLead } = await supabase.from('leads').select('*').eq('id', item.lead_id).single()

  // Verify deployment actually happened before continuing
  if (!updatedLead?.vercel_deployment_url) {
    throw new Error(`Deploy handler: "${lead.name}" has no deployment URL after deploy. Not continuing.`)
  }

  // Check if this is a delivery (post-payment) deployment
  if (updatedLead.paid_at) {
    const contactName = updatedLead.contact_name || updatedLead.name.split(' ')[0]

    // Send client a message via Twilio that the site is ready
    if (updatedLead.phone) {
      try {
        await sendClientMessage({
          phone: updatedLead.phone,
          leadId: item.lead_id,
          message:
            `Hey ${contactName}! Great news — we've made the changes you asked for and your website is ready for review.\n\n` +
            `Have a look: ${updatedLead.vercel_deployment_url}\n\n` +
            `This is your chance to check everything over before we connect it to your domain. If there's anything you'd like tweaked, just let us know!\n\n` +
            `Once you're happy, we'll get it live on your own domain.\n\n` +
            `— ${process.env.AGENCY_CALLER_NAME || 'Alex'}, ${process.env.AGENCY_NAME || 'Web Agency'}`,
        })
      } catch (err) {
        await agentLog('deployer', `Failed to send delivery message to client via Twilio: ${String(err)}`, {
          leadId: item.lead_id,
          level: 'warn',
        })
      }
    }

    // Notify admin about domain work via Telegram
    const domainInfo = []
    if (updatedLead.desired_domain) {
      domainInfo.push(`Client wants domain: *${updatedLead.desired_domain}*`)
    }
    if (updatedLead.needs_domain) {
      domainInfo.push(`Client needs us to register a domain for them`)
      if (!updatedLead.desired_domain) {
        const suggestedDomain = updatedLead.name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.co.uk'
        domainInfo.push(`Suggested: ${suggestedDomain}`)
      }
    }
    if (updatedLead.needs_email_setup) {
      domainInfo.push(`Needs professional email setup`)
    }

    await notify(
      `*Site delivered: ${updatedLead.name}*\n\n` +
      `Live at: ${updatedLead.vercel_deployment_url}\n` +
      `Client notified via SMS/WhatsApp.\n\n` +
      (domainInfo.length > 0
        ? `*Domain work needed:*\n${domainInfo.map(d => `• ${d}`).join('\n')}\n\n` +
          `_Action required: purchase/configure domain and DNS._`
        : `_No domain work needed — client has their own domain._`)
    )

    await supabase.from('leads').update({
      status: 'delivered',
      status_updated_at: new Date().toISOString()
    }).eq('id', item.lead_id)

    await agentLog('deployer', `Delivery complete for "${updatedLead.name}" — client notified, admin alerted about domain work`, {
      leadId: item.lead_id,
      level: 'success',
    })
    return
  }

  // Standard (non-delivery) deploy: send email if available, queue call
  if (updatedLead?.email) {
    await agentLog('deployer', `"${lead.name}" has email — sending outreach`, { leadId: item.lead_id })
    const { runEmailerAgent } = await import('../agents/emailer')
    await runEmailerAgent(item.lead_id)
  }

  await enqueue({
    leadId: item.lead_id,
    queueName: 'call',
    pipelineRunId: item.pipeline_run_id || undefined,
  })
  await agentLog('deployer', `"${lead.name}" deployed (${updatedLead.vercel_deployment_url}) → queued for call`, { leadId: item.lead_id, level: 'success' })
}

export async function handleCall(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['deployed', 'emailed'], 'Call')

  // Verify the site is actually deployed
  if (!lead.vercel_deployment_url) {
    throw new Error(`Call handler: "${lead.name}" has no deployment URL. Cannot call without a site to show.`)
  }

  await agentLog('caller', `Calling "${lead.name}" at ${lead.phone} — site: ${lead.vercel_deployment_url}`, { leadId: item.lead_id })

  await runCallerAgent(item.lead_id)

  // Refresh lead to get call outcome
  const { data: calledLead } = await supabase
    .from('leads')
    .select('name, vercel_deployment_url, call_outcome')
    .eq('id', item.lead_id)
    .single()

  if (calledLead?.vercel_deployment_url) {
    const calendly = process.env.CALENDLY_LINK || ''
    await notify(
      `Call complete: *${calledLead.name}*\n` +
      `Outcome: ${calledLead.call_outcome || 'unknown'}\n\n` +
      `${calledLead.vercel_deployment_url}\n` +
      `${calendly}`
    )
  }

  await enqueue({
    leadId: item.lead_id,
    queueName: 'followup',
    pipelineRunId: item.pipeline_run_id || undefined,
  })
  await agentLog('caller', `"${calledLead?.name}" called (${calledLead?.call_outcome}) → queued for followup`, { leadId: item.lead_id, level: 'success' })
}

export async function handleCopywrite(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['verified'], 'Copywrite')
  await agentLog('copywriter', `Creating creative brief for "${lead.name}"`, { leadId: item.lead_id })

  await runCopywriterAgent(item.lead_id)

  await enqueue({
    leadId: item.lead_id,
    queueName: 'build',
    pipelineRunId: item.pipeline_run_id || undefined,
  })
  await agentLog('copywriter', `"${lead.name}" brief created → queued for build`, { leadId: item.lead_id, level: 'success' })
}

export async function handleSeo(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['built'], 'SEO')
  await agentLog('seo', `Optimizing SEO for "${lead.name}"`, { leadId: item.lead_id })

  await runSeoAgent(item.lead_id)

  await enqueue({
    leadId: item.lead_id,
    queueName: 'review',
    pipelineRunId: item.pipeline_run_id || undefined,
  })
  await agentLog('seo', `"${lead.name}" SEO optimized → queued for review`, { leadId: item.lead_id, level: 'success' })
}

export async function handleReview(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['seo_optimized'], 'Review')
  await agentLog('reviewer', `Reviewing "${lead.name}" site quality`, { leadId: item.lead_id })

  const passed = await runCodeReviewerAgent(item.lead_id)

  if (passed) {
    await enqueue({
      leadId: item.lead_id,
      queueName: 'deploy',
      pipelineRunId: item.pipeline_run_id || undefined,
    })
    await agentLog('reviewer', `"${lead.name}" passed review → queued for deploy`, { leadId: item.lead_id, level: 'success' })
  } else {
    // Check attempt count
    const currentAttempts = (lead.review_attempts || 0) + 1

    await supabase.from('leads').update({
      review_attempts: currentAttempts,
      status: 'building',
      status_updated_at: new Date().toISOString()
    }).eq('id', item.lead_id)

    if (currentAttempts >= 3) {
      // Escalate to HITL after 3 failed reviews
      await supabase.from('leads').update({
        status: 'hitl_ready',
        status_updated_at: new Date().toISOString()
      }).eq('id', item.lead_id)

      await notify(
        `*Review escalation: ${lead.name}*\n` +
        `Failed ${currentAttempts} review attempts.\n` +
        `Error: ${lead.error || 'See review logs'}\n\n` +
        `_Needs manual intervention_`
      )
      await agentLog('reviewer', `"${lead.name}" failed ${currentAttempts} reviews → escalated to HITL`, {
        leadId: item.lead_id,
        level: 'error'
      })
    } else {
      // For delivery builds that fail review, re-queue to seo (changes already applied)
      // For new builds, re-queue to build
      if (lead.paid_at) {
        await supabase.from('leads').update({
          status: 'built',
          status_updated_at: new Date().toISOString()
        }).eq('id', item.lead_id)

        await enqueue({
          leadId: item.lead_id,
          queueName: 'seo',
          metadata: { review_attempt: currentAttempts, review_errors: lead.error }
        })
        await agentLog('reviewer', `"${lead.name}" delivery failed review (attempt ${currentAttempts}/3) → re-queued for SEO`, {
          leadId: item.lead_id,
          level: 'warn'
        })
      } else {
        await enqueue({
          leadId: item.lead_id,
          queueName: 'build',
          pipelineRunId: item.pipeline_run_id || undefined,
          metadata: { review_attempt: currentAttempts, review_errors: lead.error }
        })
        await agentLog('reviewer', `"${lead.name}" failed review (attempt ${currentAttempts}/3) → re-queued for build`, {
          leadId: item.lead_id,
          level: 'warn'
        })
      }
    }
  }
}

export async function handleFollowup(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['called', 'hitl_ready'], 'Followup')
  await agentLog('followup', `Following up with "${lead.name}"`, { leadId: item.lead_id })

  const calendly = process.env.CALENDLY_LINK || ''
  const contactName = lead.contact_name || lead.name.split(/\s|&/)[0]

  // 1. Send follow-up text to client via Twilio SMS/WhatsApp
  const followupMessage =
    `Hi ${contactName}!\n\n` +
    `It was great chatting just now. As promised, here's the website we built for ${lead.name}:\n\n` +
    `${lead.vercel_deployment_url}\n\n` +
    `Have a browse — it's fully live and working right now. If you like what you see and want to make it yours, book a quick 10-minute call with ${process.env.AGENCY_OWNER_NAME || 'the owner'} of ${process.env.AGENCY_NAME || 'Web Agency'}, and he'll walk you through the whole process:\n\n` +
    `${calendly}\n\n` +
    `No pressure at all — the site is yours to look at either way!\n\n` +
    `Cheers,\n${process.env.AGENCY_CALLER_NAME || 'Alex'} from ${process.env.AGENCY_NAME || 'Web Agency'}`

  if (lead.phone) {
    try {
      await sendClientMessage({ phone: lead.phone, message: followupMessage, leadId: item.lead_id })
    } catch (err) {
      await agentLog('followup', `Twilio follow-up failed for "${lead.name}": ${String(err)}`, {
        leadId: item.lead_id,
        level: 'warn',
      })
    }
  }

  // 2. Notify admin via Telegram
  await notify(
    `Follow-up sent to *${lead.name}* (${contactName}) via SMS/WhatsApp.\n` +
    `Site: ${lead.vercel_deployment_url}`
  )

  // 3. Make follow-up call via Bland.ai
  const { runFollowupCallAgent } = await import('../agents/followup-caller')
  await runFollowupCallAgent(item.lead_id)

  await agentLog('followup', `Follow-up complete for "${lead.name}" — Twilio message + Bland.ai call`, {
    leadId: item.lead_id,
    level: 'success',
  })
}

export async function handleClose(item: QueueItem): Promise<void> {
  const lead = await getLead(item.lead_id)
  assertStatus(lead, ['booked', 'hitl_ready', 'called'], 'Close')
  await agentLog('closer', `Closing call with "${lead.name}"`, { leadId: item.lead_id })

  await runCloserAgent(item.lead_id)

  await agentLog('closer', `"${lead.name}" closing call complete`, { leadId: item.lead_id, level: 'success' })
}
