import { supabase } from '../lib/supabase'
import { agentLog } from '../lib/logger'
import { fetchWithRetry } from '../lib/fetch-retry'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, } from 'node:fs'
import { join, relative } from 'node:path'

const PREVIEW_DIR = join(process.cwd(), 'preview')

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

export async function runDeployerAgent(leadId: string): Promise<string> {
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single()

  if (!lead?.site_html) throw new Error('No site HTML for lead')

  await agentLog('deployer', `Deploying site for: ${lead.name}`, { leadId })

  const slug = lead.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 40)
  const siteDir = join(PREVIEW_DIR, slug)

  // Step 1: Build the Vite project locally
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

  // Step 2: Collect built files from dist/
  const files = collectFilesForDeploy(distDir, distDir)
  if (files.length === 0) throw new Error('Vite build produced no output files')

  await agentLog('deployer', `Built ${files.length} files, deploying to Vercel...`, { leadId })

  const vercelToken = process.env.VERCEL_TOKEN
  if (!vercelToken) throw new Error('VERCEL_TOKEN must be set')

  // Step 3: Create Vercel project
  const projectName = `wa-${slug}-${Date.now().toString(36)}`

  const createProjectRes = await fetchWithRetry('https://api.vercel.com/v9/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: projectName, framework: null })
  })

  const project = await createProjectRes.json() as { id?: string; error?: any }
  if (!project.id) throw new Error(`Failed to create Vercel project: ${JSON.stringify(project)}`)

  // Step 3b: Disable deployment protection so the site is publicly accessible
  await fetchWithRetry(`https://api.vercel.com/v9/projects/${project.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ssoProtection: null, passwordProtection: null })
  })

  // Step 4: Deploy dist/ via file upload
  const deployRes = await fetchWithRetry('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: projectName,
      files,
      projectSettings: { framework: null },
      target: 'production'
    })
  })

  const deployment = await deployRes.json() as { url?: string; error?: any }
  if (!deployment.url) throw new Error(`Deployment failed: ${JSON.stringify(deployment)}`)

  const liveUrl = `https://${deployment.url}`

  // Step 5: Update lead in DB
  await supabase
    .from('leads')
    .update({
      vercel_project_id: project.id,
      vercel_deployment_url: liveUrl,
      status: 'deployed',
      status_updated_at: new Date().toISOString()
    })
    .eq('id', leadId)

  await agentLog('deployer', `Live at: ${liveUrl}`, { leadId, level: 'success' })
  return liveUrl
}
