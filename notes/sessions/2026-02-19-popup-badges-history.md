# Session: 2026-02-19 (afternoon) — Popup badges, full history, race-condition fixes

## Goal
Fix two user-reported bugs (download not showing in popup, mode badge always
missing), expand the popup to show the full download history instead of just
the last hour, and ensure every download in the list gets a badge indicating
how it was handled.

---

## What was done

### Bug 1 — First download invisible during chunk assembly
**Symptom:** popup showed "No active downloads" even while a download was
in progress.  Starting a second download would suddenly make the first appear.

**Root cause:** For chunked downloads, `downloadInChunks` fetches all chunks
in parallel before calling `chrome.downloads.download()`.  Until that call is
made, Chrome has no download item — `chrome.downloads.search` returns nothing.

**Fix:**
- Added `addActiveChunkFetch(url)` / `removeActiveChunkFetch(url)` helpers
  that write a pending entry to `chrome.storage.local` under
  `activeChunkFetches`.
- `downloadInChunks` (converted to `async/await`) now awaits
  `addActiveChunkFetch` at the very start and awaits `removeActiveChunkFetch`
  just before calling `chrome.downloads.download`.
- `fetchDownloads` in the popup reads `activeChunkFetches` alongside
  `downloadModes` and passes them to `updateDownloadsList`.
- `updateDownloadsList` renders an "⚡ Chunked (preparing)" placeholder for
  each active fetch entry (entries older than 5 min are treated as orphaned
  and skipped).
- **Mistake caught:** `updateDownloadsList` had an early `return` when
  `downloads.length === 0`, which skipped the `activeFetches` rendering block
  entirely.  Fixed by computing `pendingFetches` before the guard and
  combining the empty-state check: only show "No downloads yet" when BOTH
  arrays are empty.

### Bug 2 — Mode badge race condition (badge never showed)
**Symptom:** popup showed the download item but with no ⚡/↓/⚠ badge.

**Root cause (first layer):** `chrome.downloads.onCreated` fires before the
`chrome.downloads.download()` callback fires.  So the popup received
`DOWNLOAD_UPDATE` (from `onCreated`) and called `fetchDownloads` before
`storeDownloadMode` had written the mode to `chrome.storage.local`.  First
render: no badge.  `storeDownloadMode` then wrote the mode but wasn't
sending another `DOWNLOAD_UPDATE`, so the badge never appeared.

**Fix (first pass):** Changed `storeDownloadMode` to send `DOWNLOAD_UPDATE`
*inside* the `chrome.storage.local.set()` callback so the mode is guaranteed
to be in storage before the popup reads it.

**Root cause (second layer):** Rapid-fire `fetchDownloads` calls (polling +
badge-write notification + `onCreated` notification all happening within
~50 ms) meant an older async callback could overwrite a fresher render, losing
the badge again.

**Fix:** Added a `fetchGeneration` counter to `fetchDownloads`.  Every call
increments the counter; callbacks from superseded calls bail out with
`if (gen !== fetchGeneration) return`.

### Bug 3 — Badge never showed for native Chrome downloads
**Symptom:** downloads started via Google Drive's download button, the address
bar, or other non-ChunkFlow paths showed no badge at all — `storeDownloadMode`
was never called for them.

**Root cause:** `storeDownloadMode` was only called from inside
`downloadInChunks`, which is only invoked for downloads ChunkFlow explicitly
intercepts (content-script link click or context-menu).  Downloads that
bypass ChunkFlow entirely have no entry in `downloadModes`.

**Fix (final, correct approach):**
- Switched mode assignment from `chrome.downloads.download()` callbacks to
  `chrome.downloads.onCreated`, which fires reliably for every download.
- Before each `chrome.downloads.download()` call in `downloadInChunks`, the
  URL and intended mode are pre-registered in two in-memory maps:
  `pendingChunkFlowUrls` (Set) and `pendingModeByUrl` (plain object).
- `onCreated` checks whether `downloadItem.url` is in `pendingChunkFlowUrls`.
  - **Yes** → ChunkFlow download; look up mode, call `storeDownloadMode`,
    remove from both maps.  `storeDownloadMode` sends `DOWNLOAD_UPDATE` after
    the write.  Return early (no duplicate notification).
  - **No** → Native Chrome download; call `storeDownloadMode(id, 'browser')`.
- All `chrome.downloads.download()` callbacks that previously called
  `storeDownloadMode` were removed (redundant now, and were the source of the
  timing bug).

**New badge: ↓ Browser** — grey badge shown for downloads not initiated by
ChunkFlow (native Chrome, other extensions, Google Drive UI, etc.).

### Feature — Full download history
**Previously:** `fetchDownloads` filtered results to `startTime > 1 hour ago`.

**Fix:** Replaced the time filter with
`chrome.downloads.search({ orderBy: ['-startTime'], limit: 50 })`, which
returns the 50 most-recent downloads (newest first) regardless of age.

Also added a human-readable timestamp to each download card (`formatDownloadTime`
helper: "Just now", "5m ago", "Today 2:30 PM", "Yesterday …", "Feb 3 …").

Empty-state message updated from "No active downloads" → "No downloads yet".

---

## What went wrong / mistakes

| # | Mistake | How it was caught | Fix |
|---|---------|-------------------|-----|
| 1 | Early `return` in `updateDownloadsList` for empty downloads list skipped `activeFetches` rendering entirely | Code review after writing it | Moved `fiveMinutesAgo` / `pendingFetches` calc before the guard; combined condition |
| 2 | `storeDownloadMode` sent `DOWNLOAD_UPDATE` from `chrome.downloads.download()` callback, which fires AFTER `onCreated` → popup rendered without badge on first try | User reported badge still missing after first fix | Moved notification into the `chrome.storage.local.set()` callback |
| 3 | Rapid concurrent `fetchDownloads` calls could overwrite fresh renders with stale data | User still reported missing badge intermittently | Added `fetchGeneration` counter |
| 4 | Mode badge fix still left native Chrome downloads (e.g. Google Drive button) with no badge ever | User reported "still no badge" with screenshot showing 2.83 GB + 1.59 GB files | Switched to `onCreated`-based assignment with `pendingChunkFlowUrls` pre-registration; added `'browser'` mode |
| 5 | Duplicate `fiveMinutesAgo` variable computed twice in `updateDownloadsList` | Code review | Unified into one `pendingFetches` variable reused in both places |

---

## Files created / modified

- `web_plugin_22_full_functionality/background.js`
  - Added `pendingChunkFlowUrls` (Set) and `pendingModeByUrl` (object) at
    module top
  - `storeDownloadMode` — callback added to `set()` to send `DOWNLOAD_UPDATE`
    after write
  - Added `addActiveChunkFetch(url)` and `removeActiveChunkFetch(url)` helpers
  - `downloadInChunks` — rewritten as `async/await`; `activeChunkFetch`
    tracking at every exit point; pre-registers mode in `pendingModeByUrl` /
    `pendingChunkFlowUrls` before each `chrome.downloads.download()` call;
    removed all callbacks from `chrome.downloads.download()`
  - `chrome.downloads.onCreated` — rewritten to assign mode from
    `pendingModeByUrl` for ChunkFlow downloads or `'browser'` for all others

- `web_plugin_22_full_functionality/popup.js`
  - `fetchGeneration` counter added to `fetchDownloads`
  - `fetchDownloads` reads `activeChunkFetches` from storage alongside
    `downloadModes`; removed 1-hour filter; uses `orderBy + limit`
  - `updateDownloadsList` — accepts `activeFetches` param; renders
    "preparing" placeholders; restructured empty-state guard; 'browser' mode
    branch added to badge switch
  - `formatDownloadTime` helper added (relative/absolute timestamp)
  - Timestamp `<div class="download-time">` added to each download card

- `web_plugin_22_full_functionality/popup.css`
  - Added `.download-time` style
  - Added `.badge-browser` style

---

## Commits shipped this session (on `feat/chunk-count-config`)

```
1feac31  fix(badges): guarantee every download gets a mode badge
47e05ca  feat(popup): show full download history, not just last hour
bd90114  fix(popup+background): fix missing mode badge and invisible first download
```

(Earlier commits from the previous session in this branch also included
`host_permissions` fix, contentScript fixes, background code health, etc.)

---

## Branch / test status
- Branch: `feat/chunk-count-config` — pushed to `origin`
- Tests: 26/26 Jest passing (`npm test`)
- Manually verified: badges show for chunked, normal, fallback, and browser
  downloads; full history visible; timestamp on each card

---

## How to verify (quick checklist)
- [ ] Reload extension at `chrome://extensions`
- [ ] Open popup → shows up to 50 most-recent downloads (not just last hour)
- [ ] Each download card shows a timestamp ("Just now", "5m ago", etc.)
- [ ] Start a download via right-click → "Download with ChunkFlow":
  - [ ] Popup immediately shows "⚡ Chunked (preparing)" placeholder
  - [ ] Placeholder disappears, real item appears with ⚡/↓/⚠ badge
- [ ] Start a download normally in Chrome (address bar, Google Drive button):
  - [ ] Item appears in popup with grey "↓ Browser" badge
- [ ] Empty popup shows "No downloads yet" (not "No active downloads")

---

## Current limitations / known issues
- `pendingChunkFlowUrls` and `pendingModeByUrl` are in-memory.  If the
  service worker is terminated between calling `chrome.downloads.download()`
  and when `onCreated` fires (very unlikely but theoretically possible in
  MV3), a ChunkFlow download would be tagged as `'browser'` instead of its
  correct mode.  Mitigation: use `chrome.storage.local` for these maps if
  this becomes a real problem.
- Files > 500 MB bypass in-memory chunking (OOM guard) and are always
  `'normal'` mode even when initiated through ChunkFlow.
- Blob URL downloads (chunked path) are only valid while the service worker
  is alive.  If the SW is terminated after creating the blob but before
  Chrome finishes reading it, the download fails.  Currently mitigated by the
  popup's open port keeping the SW alive during the download.

---

## Next steps
1. Open PR: `feat/chunk-count-config` → `main`
2. Consider a `.github/workflows/test.yml` CI step to run `npm test` on push
3. For chunked downloads > 500 MB: explore streaming directly to OPFS (Origin
   Private File System) instead of in-memory Uint8Array to lift the OOM limit
4. Upload progress visualisation in popup (currently console-only)
