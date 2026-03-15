import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, } from 'node:fs'
import { join, relative } from 'node:path'
import { agentLog } from './logger'

export type JobProfile = 'scout' | 'builder' | 'deployer' | 'emailer' | 'caller' | 'analyst' | 'delivery' | 'copywriter' | 'seo' | 'reviewer'

interface Job {
  id: string
  profile: JobProfile
  prompt: string
  leadId?: string
  runId?: string
}

interface JobResult {
  success: boolean
  output: string
  jobDir: string
  files: Record<string, string>  // relative path -> content
  error?: string
}

const PROFILES: Record<JobProfile, { maxTurns: number; model?: string }> = {
  scout:    { maxTurns: 5,  model: 'sonnet' },
  builder:  { maxTurns: 20 },
  deployer: { maxTurns: 5,  model: 'sonnet' },
  emailer:  { maxTurns: 5,  model: 'sonnet' },
  caller:   { maxTurns: 3,  model: 'sonnet' },
  analyst:    { maxTurns: 10, model: 'sonnet' },
  delivery:   { maxTurns: 10, model: 'sonnet' },
  copywriter: { maxTurns: 5,  model: 'sonnet' },
  seo:        { maxTurns: 15 },
  reviewer:   { maxTurns: 5,  model: 'sonnet' },
}

/** Recursively collect all text files from a directory */
function collectFiles(dir: string, baseDir: string, files: Record<string, string>) {
  const { readdirSync } = require('node:fs') as typeof import('fs')
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.isDirectory()) {
        collectFiles(fullPath, baseDir, files)
      } else {
        const ext = entry.name.split('.').pop() || ''
        const textExts = ['html', 'css', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'svg', 'txt', 'mjs']
        if (textExts.includes(ext)) {
          try {
            const relPath = relative(baseDir, fullPath)
            files[relPath] = readFileSync(fullPath, 'utf-8')
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch { /* dir read error */ }
}

export async function runJob(job: Job): Promise<JobResult> {
  const jobDir = `/tmp/webagency-jobs/${job.id}`
  mkdirSync(jobDir, { recursive: true })

  await agentLog('orchestrator', `Spawning Claude Code: ${job.profile} job ${job.id}`, {
    leadId: job.leadId,
    runId: job.runId,
    metadata: { profile: job.profile, maxTurns: PROFILES[job.profile].maxTurns }
  })

  const profile = PROFILES[job.profile]

  return new Promise((resolve) => {
    const args = [
      '--dangerously-skip-permissions',
      '--max-turns', String(profile.maxTurns),
      '--output-format', 'json',
      ...(profile.model ? ['--model', profile.model] : []),
      '-p', job.prompt
    ]

    // Unset CLAUDECODE to allow nested sessions
    const env = { ...process.env }
    env.CLAUDECODE = undefined
    // Ensure GEMINI_API_KEY is set for nano-banana skill
    if (!env.GEMINI_API_KEY && env.NANOBANANA_GEMINI_API_KEY) {
      env.GEMINI_API_KEY = env.NANOBANANA_GEMINI_API_KEY
    }

    const proc = spawn('claude', args, {
      cwd: jobDir,
      env: {
        ...env,
        WEBAGENCY_JOB_ID: job.id,
        WEBAGENCY_LEAD_ID: job.leadId || '',
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    // Stream stderr line-by-line into agent_logs for live visibility
    let stderrBuffer = ''
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      stderrBuffer += chunk

      // Process complete lines
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() || '' // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        // Skip empty box-drawing chrome and cost summaries
        if (/^[╭╰─┄]+$/.test(trimmed)) continue
        if (trimmed.includes('token') && trimmed.includes('cost')) continue
        // Skip pure JSON blobs (final output)
        if (trimmed.startsWith('{"') && trimmed.endsWith('}')) continue

        // Clean up box-drawing prefixes (│ ) for readability
        const cleaned = trimmed.replace(/^[│┃]\s*/, '').trim()
        if (!cleaned) continue

        agentLog(job.profile, cleaned, {
          leadId: job.leadId,
          runId: job.runId,
          metadata: { stream: true, jobId: job.id },
        }).catch(() => {})
      }
    })

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', async (code) => {
      // Recursively collect all files created in the job directory
      const files: Record<string, string> = {}
      collectFiles(jobDir, jobDir, files)

      try {
        const parsed = JSON.parse(stdout)
        const text = parsed.result || ''

        await agentLog('orchestrator', `Job ${job.id} complete (exit ${code}, ${Object.keys(files).length} files)`, {
          leadId: job.leadId,
          runId: job.runId,
          level: code === 0 ? 'success' : 'warn',
          metadata: { outputLength: text.length, files: Object.keys(files) }
        })

        resolve({ success: true, output: text, jobDir, files })
      } catch {
        if (stdout.trim().length > 0 || Object.keys(files).length > 0) {
          resolve({ success: true, output: stdout.trim(), jobDir, files })
        } else {
          const errorMsg = `Claude Code exited ${code}. stderr: ${stderr.slice(0, 500)}`
          await agentLog('orchestrator', `Job ${job.id} failed: ${errorMsg}`, {
            leadId: job.leadId,
            runId: job.runId,
            level: 'error'
          })
          resolve({ success: false, output: '', jobDir, files: {}, error: errorMsg })
        }
      }
    })

    // 5-minute timeout
    setTimeout(() => {
      proc.kill()
      resolve({ success: false, output: '', jobDir, files: {}, error: 'Job timeout after 5 minutes' })
    }, 5 * 60 * 1000)
  })
}
