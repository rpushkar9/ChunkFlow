---
name: ship
description: Pre-ship checklist for this MV3 extension: repo state + validation + PR-ready summary.
argument-hint: "[optional context: what changed]"
---

Goal: ensure changes are mergeable and manually verifiable.

1) Verify repo scope:
- Print repo root: git rev-parse --show-toplevel
- Run git status and summarize cleanly (ignore OS/home noise if any)

2) Run available automation:
- If lint/tests exist, run them (repo-standard)
- If none exist, run the manual validation checklist (from /tests)

3) Produce PR-ready summary:
- What changed
- Files touched
- Validation performed (commands or manual checklist)
- Risks / follow-ups
- Suggested next improvement (ONE) if missing rails (e.g., ESLint)
