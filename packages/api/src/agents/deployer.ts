import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { fetchWithRetry } from '../lib/fetch-retry'
import { leadSlug } from '../lib/slug'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const PREVIEW_DIR = join(process.cwd(), 'preview')

/**
 * The SEO agent writes this placeholder into canonical/og:url/JSON-LD/sitemap.
 * The deployer knows the real production hostname before building, so it
 * replaces the placeholder in the source tree and then runs the build.
 */
export const SITE_URL_PLACEHOLDER = '__SITE_URL__'

const TEXT_EXTS = new Set(['html', 'css', 'js', 'mjs', 'ts', 'json', 'xml', 'txt', 'svg', 'md', 'webmanifest'])

/** Recursively collect all files from a directory */
function collectFilesForDeploy(dir: string, baseDir: string): Array<{ file: string; data: string; encoding: 'base64' }> {
  const files: Array<{ file: string; data: string; encoding: 'base64' }> = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFilesForDeploy(fullPath, baseDir))
    } else {
      const relPath = relative(baseDir, fullPath)
      const content = readFileSync(fullPath)
      files.push({
        file: relPath,
        data: content.toString('base64'),
        encoding: 'base64'
      })
    }
  }
  return files
}

/** Replace SITE_URL_PLACEHOLDER in every text file under dir (skips node_modules/dist/.git). */
export function replaceSiteUrlPlaceholder(dir: string, siteHost: string): number {
  let replaced = 0
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue
      const full = join(d, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const ext = entry.name.split('.').pop() || ''
      if (!TEXT_EXTS.has(ext)) continue
      if (statSync(full).size > 2 * 1024 * 1024) continue
      const content = readFileSync(full, 'utf-8')
      if (!content.includes(SITE_URL_PLACEHOLDER)) continue
      writeFileSync(full, content.split(SITE_URL_PLACEHOLDER).join(siteHost))
      replaced++
    }
  }
  walk(dir)
  return replaced
}

async function vercel(path: string, init: RequestInit & { token: string }) {
  const { token, ...rest } = init
  return fetchWithRetry(`https://api.vercel.com${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(rest.headers || {}),
    },
  })
}

/**
 * Reuse the lead's existing Vercel project when there is one, so redeploys
 * (post-payment changes, dashboard tweaks) keep the URL the client was already
 * sent. Falls back to creating a fresh project if the stored one is gone.
 */
async function resolveProject(
  token: string,
  lead: { id: string; name: string; vercel_project_id: string | null },
): Promise<{ id: string; name: string; created: boolean }> {
  if (lead.vercel_project_id) {
    const res = await vercel(`/v9/projects/${lead.vercel_project_id}`, { token })
    if (res.ok) {
      const project = await res.json() as { id: string; name: string }
      return { id: project.id, name: project.name, created: false }
    }
    await agentLog('deployer', `Stored Vercel project ${lead.vercel_project_id} not found (${res.status}), creating a new one`, { leadId: lead.id, level: 'warn' })
  }

  const projectName = `wa-${leadSlug(lead.name)}-${Date.now().toString(36)}`.slice(0, 100)
  const res = await vercel('/v9/projects', {
    token,
    method: 'POST',
    body: JSON.stringify({ name: projectName, framework: null }),
  })
  const project = await res.json() as { id?: string; name?: string; error?: unknown }
  if (!project.id) throw new Error(`Failed to create Vercel project: ${JSON.stringify(project)}`)

  // Disable deployment protection so the site is publicly accessible
  const patch = await vercel(`/v9/projects/${project.id}`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
  })
  if (!patch.ok) {
    await agentLog('deployer', `Could not disable deployment protection on ${projectName} (${patch.status}) — site may require Vercel login`, { leadId: lead.id, level: 'warn' })
  }

  return { id: project.id, name: project.name || projectName, created: true }
}

export async function runDeployerAgent(leadId: string): Promise<string> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.site_html) throw new Error('No site HTML for lead')

  await agentLog('deployer', `Deploying site for: ${lead.name}`, { leadId })

  const slug = leadSlug(lead.name)
  const siteDir = join(PREVIEW_DIR, slug)

  const vercelToken = process.env.VERCEL_TOKEN
  if (!vercelToken) throw new Error('VERCEL_TOKEN must be set')

  // Step 1: Resolve (reuse or create) the Vercel project. Its name determines
  // the stable production URL, which the source needs before the build.
  const project = await resolveProject(vercelToken, lead)
  const siteHost = `${project.name}.vercel.app`
  const liveUrl = `https://${siteHost}`

  if (project.created) {
    // Persist immediately so a failed build/deploy retry reuses this project
    await supabase.from('leads').update({ vercel_project_id: project.id }).eq('id', leadId)
    await agentLog('deployer', `Created Vercel project ${project.name}`, { leadId })
  } else {
    await agentLog('deployer', `Reusing Vercel project ${project.name}`, { leadId })
  }

  // Step 2: Stamp the real hostname into canonical/og:url/JSON-LD/sitemap
  const stamped = replaceSiteUrlPlaceholder(siteDir, siteHost)
  if (stamped > 0) {
    await agentLog('deployer', `Set site URL to ${liveUrl} in ${stamped} file(s)`, { leadId })
  }

  // Step 3: Build the Vite project locally
  await agentLog('deployer', `Building Vite project: ${slug}`, { leadId })
  try {
    execSync('bun install && bun run build', {
      cwd: siteDir,
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}` },
      stdio: 'pipe',
      timeout: 60000
    })
  } catch (err: any) {
    throw new Error(`Vite build failed: ${err.stderr?.toString().slice(0, 500) || err.message}`)
  }

  const distDir = join(siteDir, 'dist')

  // Step 4: Collect built files from dist/
  const files = collectFilesForDeploy(distDir, distDir)
  if (files.length === 0) throw new Error('Vite build produced no output files')

  await agentLog('deployer', `Built ${files.length} files, deploying to Vercel...`, { leadId })

  // Step 5: Deploy dist/ via file upload to the project's production target
  const deployRes = await vercel('/v13/deployments', {
    token: vercelToken,
    method: 'POST',
    body: JSON.stringify({
      name: project.name,
      project: project.id,
      files,
      projectSettings: { framework: null },
      target: 'production'
    })
  })

  const deployment = await deployRes.json() as { url?: string; error?: unknown }
  if (!deployment.url) throw new Error(`Deployment failed: ${JSON.stringify(deployment)}`)

  // Step 6: Update lead in DB. Store the stable production alias, not the
  // per-deployment URL, so the link we text the client survives redeploys.
  await supabase
    .from('leads')
    .update({
      vercel_project_id: project.id,
      vercel_deployment_url: liveUrl,
      status: 'deployed',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('deployer', `Live at: ${liveUrl} (deployment ${deployment.url})`, { leadId, level: 'success' })
  return liveUrl
}
