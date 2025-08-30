# My Easy Downloader (Chrome Extension)

**Version:** 2.2.0  
**Manifest version:** 3

## Overview
This extension provides a popup UI with **Downloads** and **Uploads** tabs. It can intercept clicks on links that use the HTML `download` attribute and start a download, and it exposes controls to pause, resume, restart, and delete downloads from the popup. When the remote server supports HTTP range requests (`Accept-Ranges: bytes`), the background script attempts **parallel, chunked downloads** and merges the chunks into a single file for saving. If range requests aren’t supported, it falls back to a normal download. The popup shows progress bars and status for active items. The **Uploads** tab lets you input a server URL, choose a file, upload it, preview images, and display a list of previously uploaded files stored locally.

## Key Features
- Intercept download links (`<a download>…`) on pages and start downloads via the extension.  
- Chunked download path: performs a HEAD request to verify range support and, if supported, fetches byte ranges in parallel, merges them, and saves the combined file; otherwise initiates a normal download.  
- Download controls: pause, resume, restart, and delete items; progress UI and labels indicating whether a download was chunked.  
- Uploads tab: enter a server URL, pick a file with the file input, and upload. Image files display a preview; uploaded file metadata is stored and shown in the UI.  
- Popup UI with tabs and progress bars for active downloads.

## Architecture
- **Background (service worker):** `background.js`  
  - Listens for messages: `START_DOWNLOAD`, `DELETE_DOWNLOAD`, `PAUSE_DOWNLOAD`, `RESUME_DOWNLOAD`, `RESTART_DOWNLOAD`, `UPLOAD_FILE`, and responds to `GET_UPLOADED_FILES`.  
  - Implements `downloadInChunks(url, numberOfChunks=10)`: performs a HEAD request to read headers (e.g., `Accept-Ranges`, `Content-Length`, `Content-Type`), fetches byte ranges in parallel, merges `ArrayBuffer` chunks into a `Uint8Array`, builds a `Blob`, creates an object URL, and triggers `chrome.downloads.download` for the merged file.  
  - Falls back to a normal `chrome.downloads.download` if range requests aren’t supported.  
  - Upload helpers: checks range support for uploads, can POST a file normally, or attempt chunked uploads using `Content-Range` headers; stores a simple `uploadedFiles` list.
- **Content Script:** `contentScript.js`  
  - Selects all anchors with a `download` attribute and attaches a click handler to send `START_DOWNLOAD` to the background. Also handles a `CONTEXT_MENU_DOWNLOAD` message type.
- **Popup:** `popup.html`, `popup.css`, `popup.js`  
  - Two tabs: **Downloads** (list with progress bars and controls) and **Uploads** (server URL input, file picker, upload button, image preview, and an uploaded files list).  
  - Periodically refreshes the downloads list via `chrome.downloads.search`.  
  - Receives background messages to render merged-file links and error messages.

## Permissions & Assets (from `manifest.json`)
- Permissions: `downloads`, `storage`  
- Optional permissions: `management`  
- Action: default popup `popup.html`, title “My Easy Downloader”, and icons at `assets/downloadicon.png` (16, 48, 128).  
- Content script match: `<all_urls>`  
- Background: service worker `background.js`

## Files
- `manifest.json` — extension metadata, permissions, action, background worker, and content script configuration.  
- `background.js` — message handlers; chunked/normal download logic; upload helpers; stores basic uploaded file details.  
- `contentScript.js` — intercepts `<a download>` link clicks and routes them to the background.  
- `popup.html` — markup for tabs (Downloads/Uploads) and controls.  
- `popup.css` — styles for lists, buttons, progress bars, tabs, and the uploaded files list.  
- `popup.js` — renders downloads with progress; wires pause/resume/restart/delete; handles upload UI (server URL, file picker, preview, list); communicates with the background.

## Notes
- The background script only uses the chunked download path when a HEAD request indicates `Accept-Ranges: bytes`.  
- A code comment in the upload handler notes that sending a `File` object through `chrome.runtime.sendMessage` may not be possible and that a workaround may be required in practice.


## Known Limitations
- **Chunked downloads require server support**: The chunked path is only used when a HEAD request returns `Accept-Ranges: bytes`. If not present, the extension falls back to a normal download (see `downloadInChunks` in `background.js`).  
- **Full file kept in memory during merge**: The background worker merges chunks into a single `Uint8Array` and then into a `Blob` before saving. Very large files may increase memory usage.  
- **Upload file messaging caveat**: A comment in `background.js` notes that sending a `File` object via `chrome.runtime.sendMessage` may not be possible; a practical workaround may be required.  
- **Downloads list updates via polling**: The popup refreshes downloads with `chrome.downloads.search` on an interval; updates are not purely event-driven.  
- **Filename derivation**: The saved name is taken from the URL path; `Content-Disposition` filenames aren’t parsed.  
- **Content script scope**: Only anchors with the `download` attribute present at the time the script runs receive a click handler; dynamically inserted links aren’t automatically handled.  
- **Uploaded files list is in-memory**: Uploaded file metadata is kept in an in-memory array; it is not persisted across extension restarts.

## Roadmap
- **Persist uploaded file metadata** using `chrome.storage.local` in the background worker and load it on popup open.  
- **Harden chunk logic**: handle missing/partial `Content-Length`, tolerate case variants of `Accept-Ranges`, handle HTTP 206 vs 200 responses explicitly, and add retry/backoff per chunk.  
- **Reduce memory footprint** by streaming chunk assembly or writing incrementally where possible (still subject to extension APIs).  
- **Improve filenames** by parsing `Content-Disposition` when available.  
- **Dynamic link handling** via a MutationObserver in the content script to attach to `<a download>` elements added after initial load.  
- **Event-driven UI updates** by listening to `chrome.downloads.onChanged` and `onCreated` where feasible to reduce polling.  
- **Single source of truth for uploads**: keep one `handleFileUpload` implementation and one set of listeners in `popup.js`; remove duplicates.  
- **Optional configuration UI** for number of chunks and concurrency limits.
