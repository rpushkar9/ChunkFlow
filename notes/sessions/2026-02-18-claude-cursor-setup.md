# Session: 2026-02-18 — Claude + Cursor tooling setup

## Goal
Bootstrap a clean, resumable AI-assisted dev workflow for the ChunkFlow Chrome MV3 extension repo.

## What I set up
- Verified `uv` + `uvx` installation
- Configured Serena MCP server; fixed PATH and timeout issues; confirmed connection
- Enabled `ENABLE_TOOL_SEARCH=true` for tool-aware Claude sessions
- Created Claude global rules + skill definitions (`/primer`, `/tests`, `/ship`) and subagent configs
- Created repo-local `.claude/` directory with `CLAUDE.md` and skill/agent files
- Created Cursor project rules in `.cursor/rules/`
- Created this session logging system in `notes/sessions/`

## Files created / modified
- `CLAUDE.md` — project rules: MV3 gotchas, edit hot-paths, output format
- `.claude/skills/primer/SKILL.md` — /primer skill for fast context priming
- `.claude/skills/tests/SKILL.md` — /tests skill for validation (manual checklist + future infra)
- `.claude/skills/ship/SKILL.md` — /ship skill for pre-merge checklist
- `.claude/agents/codebase-scout.md` — read-only wiring detective agent
- `.claude/agents/test-validator.md` — validation + minimal-fix agent
- `.claude/agents/release-engineer.md` — packaging, versioning, release notes agent
- `.cursor/rules/00-foundation.mdc` — global Cursor rules (minimal diffs, output format)
- `.cursor/rules/10-mv3-extension.mdc` — MV3-scoped constraints (service worker, no build step)
- `notes/sessions/_TEMPLATE.md` — session log template
- `notes/sessions/2026-02-18-claude-cursor-setup.md` — this file

## Commands run
```bash
# Confirm repo root (always run first)
git rev-parse --show-toplevel
# → /Users/pushkar/Desktop/chunkflow/ChunkFlow

# Commit Claude setup
git add CLAUDE.md .claude/
git commit -m "chore: add project-scoped Claude Code setup"

# Commit Cursor rules
git add .cursor/
git commit -m "chore: add Cursor project rules"
```

## How to verify (quick checklist)
- [ ] `git log --oneline -5` shows the two setup commits (`cad65d7`, `013b11e`)
- [ ] `ls .claude/skills/` shows `primer/`, `tests/`, `ship/`
- [ ] `ls .claude/agents/` shows three `.md` files
- [ ] `ls .cursor/rules/` shows `00-foundation.mdc`, `10-mv3-extension.mdc`
- [ ] Running `/primer` inside a Claude session returns a working map for the extension
- [ ] Running `/ship` from `ChunkFlow/` (not `~/`) shows clean repo state

## Next steps
1. Decide on first feature to build or bug to fix in the extension
2. Optionally: add `.gitignore` to suppress `.DS_Store` from git status noise
3. Optionally: scaffold ESLint for `utils.js` (ask Claude to do it with `/tests` guidance)
4. Optionally: scaffold Jest unit tests for `Utils` object pure functions

## Open questions / TODO
- `/ship` git scope: must always be run from `ChunkFlow/` (not `~/Desktop/chunkflow`) to avoid home-dir git noise
- No test infrastructure yet — manual Chrome load is the only verification path
- Git user identity auto-configured from hostname; consider setting explicitly with `git config user.name/email`

---

## Resume next time

```
1. cd ~/Desktop/chunkflow/ChunkFlow
2. Open repo in Cursor (if using Cursor)
3. Open terminal in Cursor (or a new terminal tab)
4. Run: ENABLE_TOOL_SEARCH=true claude
5. Run /primer   (if you need to re-orient to the codebase)
6. Pick next feature from "Next steps" above and start working
7. End of session:
   - Update (or create) a new notes/sessions/YYYY-MM-DD-<title>.md
   - Run /ship to confirm clean state
   - git add + git commit
```
