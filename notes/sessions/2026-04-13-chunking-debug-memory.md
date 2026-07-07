# Chunking Debug Memory — 2026-04-13

Purpose: preserve what was tried, what failed, and what now works so future sessions do not repeat dead ends.

## User-reported symptoms
- Right-click "Download with ChunkFlow" sometimes looked like it did nothing in popup.
- `Browser` / `Normal` badges were confusing.
- Some links showed no visible progress while work was happening.

## Evidence captured
- Service-worker logs confirmed context menu path triggered:
  - `Context menu download: ...`
  - `[ChunkFlow] downloadInChunks: 10 chunks ...`
  - `[ChunkFlow] HEAD response received`
- For `https://proof.ovh.net/files/100Mb.dat`, run stalled after `HEAD` in initial implementation.

## Approaches tried (chronological)

### 1) URL-key based mode attribution (older approach)
- Outcome: misclassification risk (`Browser`) when created URL differed from queued URL.
- Decision: replaced with storage-backed pending queue consumption.

### 2) Offscreen chunking implementation
- Why: MV3 service worker cannot reliably use `URL.createObjectURL`.
- Outcome: fixed chunking for thinkbroadband URLs in automated browser tests.

### 3) Offscreen hardening
- Added strict checks:
  - `206` required for range responses
  - `Content-Range` format/values validated
  - chunk byte-length validated
  - sender validation in offscreen message handler
- Outcome: correctness/security improved.

### 4) Reproduce with proof.ovh (100Mb.dat)
- Result: `HEAD` succeeds, then offscreen assembly can hang for a long time.
- Added offscreen watchdog timeout (3 minutes).
- New behavior: deterministic `fallback` instead of silent hanging.

### 5) UI clarity fixes
- Added help card in popup with trigger instructions and badge meanings.
- Added quick-start URL box (`Start with ChunkFlow`) to avoid right-click ambiguity.
- Added mode metadata (`downloadModeMeta`) and per-row reason text.
- Added pending chunk stage/progress visibility and elapsed seconds.
- Made badge styles visually distinct (`Normal (CF)` vs `Browser`).

### 6) Progress loop instrumentation + visibility
- Added offscreen -> background progress heartbeat every 2s (`OFFSCREEN_CHUNK_PROGRESS`).
- Added runtime banner in popup when ChunkFlow has active work.
- Moved pending chunk cards to top of download list to avoid being hidden by older rows.
- Added background logs for progress messages so service-worker console shows active movement.

### 7) Content-script click detection update
- Added `.dat` to auto-intercept extensions.
- Outcome: normal click interception improved for test links like `100Mb.dat`.

### 8) Range detection hardening
- Problem: some runs were classified as `Normal (CF)` with reason `Accept-Ranges missing`.
- Fix:
  - replaced strict `Accept-Ranges === 'bytes'` check with tolerant parsing
  - added active range probe (`GET bytes=0-0`) before deciding `normal`
- Outcome: avoids false negatives from inconsistent `HEAD` headers.

### 9) Slow-host chunking resilience
- Problem: `proof.ovh` was timing out around 260s and falling back.
- Fixes:
  - size/chunk-aware timeout calculation
  - retry attempts with lower chunk counts (10 -> 6 -> 4)
  - offscreen cancel message to stop stale work when timeout occurs
- Outcome:
  - `proof.ovh 100Mb.dat` can complete as `chunked` but may take ~5 minutes on slow runs.

## Test loop outcomes

### Reliable PASS path
- URL: `http://ipv4.download.thinkbroadband.com/20MB.zip`
- Expected/Observed: `chunked`.

### Expected normal path
- URL: `http://ipv4.download.thinkbroadband.com/1GB.zip`
- Expected/Observed: `normal` (500MB safety guard).

### Problematic host path
- URL: `https://proof.ovh.net/files/100Mb.dat`
- Earlier behavior:
  - starts at `0/10` chunks for a long period
  - reaches partial completion then timed out and fell back
- Current behavior after adaptive timeout/retry:
  - still slow and bursty, but can complete as `chunked`
  - observed completion around ~290s in automated run

## Commands used repeatedly
```bash
npm test
npm run test:e2e
CHUNKFLOW_TEST_URL_CHUNKED="https://proof.ovh.net/files/100Mb.dat" CHUNKFLOW_MODE_TIMEOUT_MS=250000 npm run test:e2e
```

## Do-not-repeat list
- Do not assume `HEAD` success implies chunk path will complete quickly.
- Do not rely on URL-string equality for mode attribution.
- Do not leave long offscreen assembly without timeout or user-visible progress.

## Current known constraints
- Forced debug chunk count is currently pinned to 10.
- `proof.ovh` 100Mb path currently times out in offscreen assembly and falls back.
- Thinkbroadband 20MB remains the best quick validation target for chunked PASS.

## Recommended next debugging step
1. Add integrity assertion to e2e (size/hash), not just mode badge assertion.
2. Re-enable user-configurable chunk count after stability is confirmed.
3. Optional: persist per-host telemetry (success/fallback/avg time) to tune chunk strategy.

## Current fix plan status
- [x] Add progress heartbeat loop and stage/status surfacing.
- [x] Make active chunk work visible at top of popup.
- [x] Document dead ends + working paths in memory file.
- [x] Implement adaptive timeout/concurrency for slow hosts like `proof.ovh`.
- [ ] Restore user chunk-count setting once stability is good.
