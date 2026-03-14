import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'
import { enqueue } from '../lib/queue'
import { runJob } from '../lib/orchestrator'
import { existsSync, cpSync } from 'fs'
import { join, sep } from 'path'

/** Filter that skips node_modules and .git when copying */
const skipNodeModules = (src: string) => !src.split(sep).includes('node_modules') && !src.split(sep).includes('.git')

/**
 * Apply requested changes to the website files using Claude Code.
 * Edits the preview directory in place. Does NOT deploy.
 */
export async function applyDeliveryChanges(leadId: string): Promise<boolean> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    await agentLog('delivery', `Lead not found: ${leadId}`, { leadId, level: 'error' })
    return false
  }

  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
  const previewDir = join(process.cwd(), 'preview', slug)

  if (!existsSync(previewDir)) {
    await agentLog('delivery', `No local preview found at ${previewDir}, cannot apply changes`, {
      leadId, level: 'error'
    })
    await notify(
      `Could not find site files for ${lead.name} at ${previewDir}.\n` +
      `You may need to manually apply changes.`
    )
    return false
  }

  const changes: string[] = []

  if (lead.requested_changes) {
    changes.push(`Apply these changes the client requested: ${lead.requested_changes}`)
  }

  if (lead.cta_type === 'phone' && lead.cta_value) {
    changes.push(`Update the CTA/contact section: add a click-to-call button with phone number ${lead.cta_value}`)
  } else if (lead.cta_type === 'email_form' && lead.cta_value) {
    changes.push(`Make sure the contact form sends submissions to ${lead.cta_value}`)
  }

  if (changes.length === 0) {
    await agentLog('delivery', `No changes requested for ${lead.name}, skipping edit step`, { leadId })
    return true
  }

  const jobId = `delivery-${leadId}-${Date.now()}`
  const jobDir = `/tmp/webagency-jobs/${jobId}`
  cpSync(previewDir, jobDir, { recursive: true, filter: skipNodeModules })

  const prompt = [
    `You are editing an existing Vite website in the current directory.`,
    `Business: ${lead.name} (${lead.category})`,
    ``,
    `Make ONLY these changes — do not redesign or restructure the site:`,
    ...changes.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `Edit the files in place. Keep the same structure and styling.`,
    `Do NOT run any build commands. Just edit the source files.`,
  ].join('\n')

  const result = await runJob({
    id: jobId,
    profile: 'builder',
    prompt,
    leadId,
  })

  if (result.success) {
    cpSync(jobDir, previewDir, { recursive: true, filter: skipNodeModules })
    await agentLog('delivery', `Changes applied for ${lead.name}`, { leadId, level: 'success' })
    return true
  } else {
    await agentLog('delivery', `Claude Code failed to apply changes: ${result.error}`, {
      leadId, level: 'error'
    })
    return false
  }
}

/**
 * Full delivery pipeline: apply changes → enqueue to SEO → review → deploy.
 * Called when a client pays. The site goes through the full quality pipeline
 * before being redeployed, then admin is notified about domain work.
 */
export async function runDeliveryPipeline(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    await agentLog('delivery', `Lead not found: ${leadId}`, { leadId, level: 'error' })
    return
  }

  await agentLog('delivery', `Starting delivery pipeline for: ${lead.name}`, { leadId })

  await supabase.from('leads').update({
    status: 'delivering',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  // Step 1: Apply client-requested changes
  const success = await applyDeliveryChanges(leadId)

  if (!success) {
    await notify(
      `Delivery failed for *${lead.name}* — could not apply changes.\n` +
      `Manual intervention needed.`
    )
    return
  }

  // Step 2: Set status to 'built' and enqueue to SEO
  // The pipeline will then flow: SEO → review → deploy
  await supabase.from('leads').update({
    status: 'built',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  await enqueue({
    leadId,
    queueName: 'seo',
  })

  await agentLog('delivery', `${lead.name}: changes applied → queued for SEO optimization`, {
    leadId,
    level: 'success'
  })

  await notify(
    `Delivery pipeline started for *${lead.name}*\n` +
    `Changes applied — now going through SEO → review → deploy.`
  )
}
