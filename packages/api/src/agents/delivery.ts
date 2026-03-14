import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { notify } from '../lib/telegram'
import { runJob } from '../lib/orchestrator'
import { existsSync, cpSync } from 'fs'
import { join, sep } from 'path'

/** Filter that skips node_modules and .git when copying */
const skipNodeModules = (src: string) => !src.split(sep).includes('node_modules') && !src.split(sep).includes('.git')

/**
 * Delivery agent: applies requested changes to the website using Claude Code,
 * rebuilds, redeploys, and notifies the client.
 */
export async function runDeliveryAgent(leadId: string): Promise<void> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead) {
    await agentLog('delivery', `Lead not found: ${leadId}`, { leadId, level: 'error' })
    return
  }

  await agentLog('delivery', `Starting delivery for: ${lead.name}`, { leadId })

  await supabase.from('leads').update({
    status: 'delivering',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  const contactName = lead.contact_name || lead.name.split(' ')[0]
  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
  const previewDir = join(process.cwd(), 'preview', slug)

  // Check if we have the site files locally
  if (!existsSync(previewDir)) {
    await agentLog('delivery', `No local preview found at ${previewDir}, cannot apply changes`, {
      leadId, level: 'error'
    })
    await notify(
      `Could not find site files for ${lead.name} at ${previewDir}.\n` +
      `You may need to manually apply changes.`
    )
    return
  }

  // Build the change prompt for Claude Code
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
  } else {
    // Copy preview to a job directory so Claude Code can work on it
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
      // Copy edited files back to preview
      cpSync(jobDir, previewDir, { recursive: true, filter: skipNodeModules })
      await agentLog('delivery', `Changes applied for ${lead.name}`, { leadId, level: 'success' })
    } else {
      await agentLog('delivery', `Claude Code failed to apply changes: ${result.error}`, {
        leadId, level: 'error'
      })
    }
  }

  // Rebuild and redeploy
  try {
    const { runDeployerAgent } = await import('./deployer')
    await runDeployerAgent(leadId)
    await agentLog('delivery', `Redeployed ${lead.name}`, { leadId, level: 'success' })
  } catch (err) {
    await agentLog('delivery', `Redeploy failed for ${lead.name}: ${String(err)}`, {
      leadId, level: 'error'
    })
  }

  // Fetch updated deployment URL
  const { data: updated } = await supabase
    .from('leads')
    .select('vercel_deployment_url')
    .eq('id', leadId)
    .single()

  // Notify client that the site is ready for review
  const siteUrl = updated?.vercel_deployment_url || lead.vercel_deployment_url

  await notify(
    `Hey ${contactName}! Great news — we've made the changes you asked for and your website is ready for review.\n\n` +
    `Have a look: ${siteUrl}\n\n` +
    `This is your chance to check everything over before we connect it to your domain. If there's anything you'd like tweaked, just let us know!\n\n` +
    `Once you're happy, we'll get it live on your own domain.\n\n` +
    `— ${process.env.AGENCY_CALLER_NAME || 'Alex'}, ${process.env.AGENCY_NAME || 'Web Agency'}`
  )

  await supabase.from('leads').update({
    status: 'delivering',
    status_updated_at: new Date().toISOString()
  }).eq('id', leadId)

  await agentLog('delivery', `Delivery complete for ${lead.name} — awaiting client review`, {
    leadId, level: 'success'
  })
}
