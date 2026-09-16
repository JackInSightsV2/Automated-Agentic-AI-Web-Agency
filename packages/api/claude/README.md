# Claude Code assets for subprocess jobs

Skills and subagents that the orchestrator stages into each job directory
(`/tmp/webagency-jobs/<id>/.claude/`) before spawning `claude -p`. Jobs run
outside the repo, so nothing in the repo's own `.claude/` is visible to them;
this directory is the single source of what a job can use, per profile
(see `PROFILE_ASSETS` in `src/lib/orchestrator.ts`).

Vendored rather than installed via `claude plugin install` so every job is
deterministic and does not depend on what happens to be installed on the host.

| Path | Used by | Source | Licence | Local changes |
|------|---------|--------|---------|---------------|
| `skills/frontend-design/` | builder | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) `plugins/frontend-design` | Apache-2.0 (`LICENSE.txt`) | none |
| `agents/content-marketer.md` | copywriter | [wshobson/agents](https://github.com/wshobson/agents) `plugins/content-marketing` | MIT | none |
| `agents/seo-meta-optimizer.md` | seo | wshobson/agents `plugins/seo-technical-optimization` | MIT | none |
| `agents/seo-structure-architect.md` | seo | wshobson/agents `plugins/seo-technical-optimization` | MIT | none |
| `agents/code-reviewer.md` | reviewer | wshobson/agents `plugins/comprehensive-review` | MIT | `name` de-prefixed; `model: opus` → `sonnet` |
| `agents/performance-engineer.md` | reviewer | wshobson/agents `plugins/application-performance` | MIT | `name` de-prefixed |

Not vendored, and why:

- `theme-factory` (composio): no licence in its repo; it is an interactive
  slide-deck theme picker with 10 presets, which is the opposite of what
  `frontend-design` asks for. Palette and typography come from the brief.
- `canvas-design`, `artifacts-builder` (composio): PNG/PDF art and React/shadcn
  artifacts; the sites are vanilla Vite.
- `security-scanning` (wshobson): STRIDE/SAST tooling for applications; the
  output here is a static brochure site with no backend.
- `business-analytics`, `context-mode`, `paddo/claude-tools`: interactive-session
  tools with no role in a headless job.

To refresh a file, re-download it from the source path above and re-apply the
"Local changes" column.
