---
name: primer
description: Prime context fast for this MV3 extension repo and produce a working map for edits.
context: fork
agent: Explore
argument-hint: "[optional focus: downloads|uploads|ui|permissions|performance]"
---

Prime this repository (Chrome MV3 extension) quickly and practically:

1) Confirm structure:
- Identify the loadable extension directory (the folder containing manifest.json)
- Map directory tree to depth ~3

2) Entrypoints & wiring:
- manifest.json: permissions, background/service worker, content scripts, web accessible resources
- background.js: key handlers + message passing + download/upload functions
- contentScript.js: DOM hooks, link detection logic, messaging
- popup.js/popup.html: UI interactions + state refresh logic
- utils.js: reusable helpers

3) Produce "working map" output:
- Where to edit for common tasks (downloads, uploads, UI, permissions)
- How to run/load in Chrome
- How to reload after changes
- "Gotchas" specific to MV3 service worker + message passing

Return: concise map + recommended reading order (5–10 items).
