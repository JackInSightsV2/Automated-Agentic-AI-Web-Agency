import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stageClaudeAssets, PROFILE_ASSETS, CLAUDE_ASSETS_DIR } from '../../lib/orchestrator'
import { skipInternal } from '../../lib/fs'

describe('vendored Claude Code assets', () => {
  test('every asset referenced by PROFILE_ASSETS exists in packages/api/claude', () => {
    for (const [profile, wanted] of Object.entries(PROFILE_ASSETS)) {
      for (const skill of wanted?.skills || []) {
        expect(existsSync(join(CLAUDE_ASSETS_DIR, 'skills', skill, 'SKILL.md'))).toBe(true)
      }
      for (const agent of wanted?.agents || []) {
        const file = join(CLAUDE_ASSETS_DIR, 'agents', `${agent}.md`)
        expect(existsSync(file)).toBe(true)
        // frontmatter name must match the filename, or Claude Code can't address it
        const head = readFileSync(file, 'utf-8').split('\n').slice(0, 10).join('\n')
        expect(head).toContain(`name: ${agent}`)
        expect(profile).toBeTruthy()
      }
    }
  })
})

describe('stageClaudeAssets', () => {
  let jobDir: string
  let assets: string

  beforeEach(() => {
    jobDir = mkdtempSync(join(tmpdir(), 'job-'))
    assets = mkdtempSync(join(tmpdir(), 'assets-'))
    mkdirSync(join(assets, 'skills', 'frontend-design'), { recursive: true })
    writeFileSync(join(assets, 'skills', 'frontend-design', 'SKILL.md'), '---\nname: frontend-design\n---\nbody')
    mkdirSync(join(assets, 'agents'), { recursive: true })
    writeFileSync(join(assets, 'agents', 'code-reviewer.md'), '---\nname: code-reviewer\n---\nbody')
  })

  afterEach(() => {
    rmSync(jobDir, { recursive: true, force: true })
    rmSync(assets, { recursive: true, force: true })
  })

  test('builder gets only its skill', () => {
    const staged = stageClaudeAssets('builder', jobDir, assets)
    expect(staged).toEqual({ skills: ['frontend-design'], agents: [] })
    expect(existsSync(join(jobDir, '.claude', 'skills', 'frontend-design', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(jobDir, '.claude', 'agents'))).toBe(false)
  })

  test('reviewer gets its agents, missing ones are skipped not fatal', () => {
    const staged = stageClaudeAssets('reviewer', jobDir, assets)
    expect(staged.agents).toEqual(['code-reviewer']) // performance-engineer absent from the fake assets dir
    expect(existsSync(join(jobDir, '.claude', 'agents', 'code-reviewer.md'))).toBe(true)
  })

  test('profiles without assets stage nothing', () => {
    expect(stageClaudeAssets('deployer', jobDir, assets)).toEqual({ skills: [], agents: [] })
    expect(existsSync(join(jobDir, '.claude'))).toBe(false)
  })
})

describe('skipInternal', () => {
  test('keeps .claude, node_modules, .git and dist out of preview copies', () => {
    expect(skipInternal('/tmp/job/.claude/skills/x/SKILL.md')).toBe(false)
    expect(skipInternal('/tmp/job/node_modules/vite/index.js')).toBe(false)
    expect(skipInternal('/tmp/job/dist/index.html')).toBe(false)
    expect(skipInternal('/tmp/job/src/main.js')).toBe(true)
    expect(skipInternal('/tmp/job/public/hero.webp')).toBe(true)
  })
})
