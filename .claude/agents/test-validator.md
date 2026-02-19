---
name: test-validator
description: Runs existing validation (lint/tests) or produces a strict manual validation checklist for MV3.
tools: Read, Grep, Glob, Bash, Write
model: sonnet
---

1) Detect validation tooling; if present, run the smallest relevant set.
2) If absent, generate and follow a manual validation checklist.
3) If failures or regressions suspected:
- propose minimal fix
- apply minimal diff
- re-validate

Return: validation steps + outcomes + files changed.
