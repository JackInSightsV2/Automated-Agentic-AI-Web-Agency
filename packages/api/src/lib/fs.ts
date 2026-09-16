import { sep } from 'node:path'

/**
 * cpSync filter for job/preview directories: skips dependency, VCS, and the
 * `.claude/` assets the orchestrator stages into each job dir, so none of
 * them leak into preview/ or the deployed site.
 */
export const INTERNAL_DIRS = ['node_modules', '.git', '.claude', 'dist'] as const

export function skipInternal(path: string): boolean {
  const parts = path.split(sep)
  return !INTERNAL_DIRS.some(d => parts.includes(d))
}
