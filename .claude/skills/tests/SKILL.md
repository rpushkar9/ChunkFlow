---
name: tests
description: Detect test/lint infrastructure for this extension and provide the best available validation steps.
argument-hint: "[optional: unit|lint|e2e|manual]"
---

1) Detect whether any of the following exist (do not guess):
- package.json / eslint config / prettier config
- jest/vitest config or any *.test.*/*.spec.* files
- playwright/puppeteer setup

2) If none exist:
- Provide a crisp manual validation checklist for extension behavior:
  - load unpacked
  - verify popup UI loads
  - verify contentScript injection behaviors
  - verify download/upload path on a sample page
  - verify background service worker messages/events
- Suggest ONE minimal next step for quality rails (either ESLint OR Jest for utils.js), but do not implement unless asked.

3) If infra exists:
- run the smallest relevant command(s)
- report results and failures, propose minimal fixes

Always report: commands run (if any) + validation steps + findings.
