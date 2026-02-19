# Project Rules — ChunkFlow (Chrome MV3 Extension)

## What this project is
Chrome Extension (Manifest V3) written in vanilla JavaScript. No bundler / no build step.
Primary loadable folder: `ChunkFlow/web_plugin_22_full_functionality/` (contains manifest.json).

## Non-negotiable workflow
- Always locate the correct file(s) by searching and reading entrypoints first.
- Prefer minimal diffs, preserve existing patterns.
- After changes: provide manual test steps for Chrome extension loading + verification.
- Don't invent tooling (npm, jest, etc.) unless we explicitly choose to add it.

## MV3 gotchas (important)
- background.js runs as a service worker and may unload when idle.
- Avoid relying on long-lived in-memory state in background.js.
- If you add storage/config, consider chrome.storage and message passing patterns.

## Where to edit (high leverage)
- `background.js`: download/upload engine, Chrome API events
- `contentScript.js`: page injection and download link detection
- `popup.html/popup.js`: extension UI and user controls
- `utils.js`: shared helpers
- `manifest.json`: permissions, scripts wiring, version

## Output format after doing work
- What changed
- Files touched
- Manual test steps
- Risks / follow-ups
