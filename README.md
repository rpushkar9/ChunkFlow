# ChunkFlow - Parallel Download & Upload Chrome Extension

**Version:** 2.3.0  
**Manifest version:** 3

## 🚀 Overview
ChunkFlow is a powerful Chrome extension that **accelerates downloads and uploads** by splitting files into chunks and processing them in parallel. When servers support HTTP range requests, ChunkFlow can significantly speed up file transfers by downloading/uploading multiple chunks simultaneously, then seamlessly merging them back together.

## ⚡ Key Features

### 🔽 Smart Download Management
- **Parallel chunked downloads** - Automatically detects server support for range requests and downloads files in chunks for faster speeds
- **Intelligent fallback** - Seamlessly falls back to regular downloads when chunking isn't supported
- **Universal link detection** - Works with any download link (not just those with `download` attribute)
- **Real-time progress tracking** - Live progress bars with file size information
- **Download controls** - Pause, resume, restart, and delete downloads
- **Context menu integration** - Right-click any link to download with ChunkFlow

### 📤 Advanced Upload Capabilities  
- **Chunked uploads** - Split large files into chunks for parallel upload to compatible servers
- **Upload testing** - Test server chunked upload capabilities
- **File preview** - Image preview before uploading
- **Upload history** - Track previously uploaded files with metadata
- **Progress monitoring** - Real-time upload progress for each chunk

### 🎨 Modern Interface
- **Clean, responsive UI** - Modern design with smooth animations
- **Tabbed interface** - Separate Downloads and Uploads sections
- **Real-time updates** - Dynamic refresh rates based on activity
- **Status indicators** - Clear visual feedback for all operations
- **File size formatting** - Human-readable file sizes and timestamps

## 🏗️ Architecture

> For the full end-to-end wiring (message flow diagram, storage keys, mode-attribution state machine, MV3 constraints), see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Background Service Worker (`background.js`)
- **Download orchestrator**: `downloadInChunks()` runs the HEAD/range-support checks, applies the size guard, then delegates the actual chunk fetching + merging to the offscreen document and hands the resulting blob URL to Chrome's downloader
- **Chunk count**: `getChunkCount()` reads the user's saved value from `chrome.storage.local` (clamped 2–32, default 10)
- **Mode attribution**: tags every download as `chunked` / `normal` / `fallback` / `browser` via a storage-backed pending-mode queue that survives service-worker suspension (see `enqueuePendingMode` / `consumePendingMode`)
- **Blob lifecycle**: revokes each offscreen blob URL once its download reaches a terminal state (`OFFSCREEN_REVOKE_URL`) to avoid leaking memory across repeated downloads
- **Upload engine**: Handles both normal and chunked uploads with server compatibility detection
- **Chrome Downloads API integration**: Manages pause/resume/restart/delete operations
- **Storage management**: Persists upload history to `chrome.storage.local`
- **Event-driven updates**: Real-time communication with popup via ports

### Offscreen Document (`offscreen.html`, `offscreen.js`)
- **Why it exists**: `URL.createObjectURL` is unavailable inside an MV3 service worker, so chunk assembly runs in an offscreen document instead
- **Chunk fetching**: `buildObjectUrl()` issues parallel `Range` requests, validates each `206`/`Content-Range` response, merges the buffers into one `Uint8Array`, and returns a `blob:` URL
- **Progress + cancel**: streams `OFFSCREEN_CHUNK_PROGRESS` heartbeats back to the popup and supports `OFFSCREEN_CANCEL_REQUEST` via `AbortController`
- **Trusted sender gate**: only accepts messages originating from `background.js`

### Content Script (`contentScript.js`)
- **Smart link detection**: Identifies download links by file extension and `download` attribute
- **Dynamic handler attachment**: Uses MutationObserver to handle dynamically added links
- **URL validation**: Prevents invalid download attempts
- **Context menu support**: Enables right-click download functionality

### Popup Interface (`popup.html`, `popup.css`, `popup.js`)
- **Dual-tab layout**: Downloads management and Upload testing
- **Live progress tracking**: Real-time download progress with adaptive update frequency
- **File management**: Upload file selection, preview, and history
- **Error handling**: User-friendly error messages and validation
- **Responsive design**: Modern, mobile-friendly interface

### Utilities (`utils.js`)
- **File size formatting**: Human-readable byte conversion
- **URL validation**: Robust URL checking
- **Filename sanitization**: Safe filename handling
- **File type detection**: Smart file extension and MIME type handling
- **Utility functions**: Debouncing, timestamps, and helper methods

## 🔧 Technical Implementation

### Chunked Download Process
1. **HEAD request** to check `Accept-Ranges: bytes` (falls back to a live range probe if the header is ambiguous)
2. **Size guard**: files larger than 500 MB skip in-memory chunking and use the native downloader (avoids OOM in the worker)
3. **Parallel fetching** of byte ranges in the offscreen document (user-configured count, default 10, with automatic retry at fewer chunks on failure)
4. **Chunk validation** per segment (expects `206` + matching `Content-Range` + exact byte length)
5. **Memory-efficient merging** into a single `Uint8Array`, then **blob creation** and automatic download trigger
6. **Blob revocation** once the download completes or is interrupted

### Chunked Upload Process  
1. **Server compatibility check** via HEAD request
2. **File chunking** with configurable chunk count
3. **Parallel upload** using `XMLHttpRequest` with `Content-Range` headers
4. **Progress tracking** per chunk with aggregated reporting
5. **Fallback to normal upload** if chunking unsupported

### Performance Optimizations
- **Adaptive polling**: Faster updates during active downloads (500ms), slower when idle (2s)
- **Event-driven updates**: Chrome Downloads API events trigger immediate UI refreshes
- **Memory management**: Efficient chunk assembly with proper cleanup
- **Error resilience**: Robust fallback mechanisms for network issues

## 📋 Permissions & Security
- **`downloads`**: Manage Chrome downloads
- **`storage`**: Persist upload history, chunk-count setting, and download-mode metadata
- **`contextMenus`**: Right-click "Download with ChunkFlow" option
- **`offscreen`**: Create the offscreen document that assembles chunks into a blob
- **Host permissions `http://*/*`, `https://*/*`**: Detect download links and fetch chunks on any site
- **Sender validation**: background ↔ offscreen messages are gated on the trusted sender URL

## 🚀 Installation & Usage

### Installation
1. Download the extension files
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `extension/` folder
5. The ChunkFlow icon will appear in your browser toolbar

### Using Downloads
- **Method 1**: Click any download link - ChunkFlow automatically intercepts and accelerates it
- **Method 2**: Right-click any link → "Download with ChunkFlow"
- **Monitor progress**: Click the ChunkFlow icon to see real-time download progress
- **Manage downloads**: Use pause/resume/restart/delete controls in the popup

### Using Uploads (Testing)
1. Click the ChunkFlow icon → Switch to "Uploads" tab
2. Enter a server URL that accepts file uploads
3. Select a file using "Select File" button
4. Click "Upload File" to start chunked upload
5. View upload history and progress

## 🔍 Server Requirements

### For Chunked Downloads
- Server must return `Accept-Ranges: bytes` header
- Must support HTTP Range requests (`Range: bytes=start-end`)
- Must return proper `Content-Length` header

### For Chunked Uploads  
- Server must accept `Content-Range` headers
- Must support partial content uploads
- Should handle multiple concurrent POST requests

## 🎯 Performance Benefits

### Download Speed Improvements
- **2-5x faster** on supported servers with good bandwidth
- **Better reliability** on unstable connections (chunk-level retry)
- **Resume capability** for interrupted downloads
- **Memory efficient** chunk processing

### Upload Speed Improvements
- **Parallel upload streams** for faster large file transfers
- **Progress granularity** with per-chunk reporting
- **Automatic fallback** for unsupported servers
- **Error isolation** per chunk

## 🔧 Configuration
- **Default chunks**: 10 parallel streams (configurable via the popup UI, 2–32, persisted in `chrome.storage.local`)
- **Update frequency**: 500ms active, 2s idle
- **File detection**: Automatic by extension
- **Memory usage**: Optimized for large files

## 🧪 Validation commands
- `npm test` - unit tests for shared utilities
- `npm run test:e2e` - Playwright smoke test that loads the unpacked extension and verifies:
  - `20MB` URL is tagged `chunked`
  - `1GB` URL is tagged `normal` (500MB in-memory guard)

## 📝 Technical Notes
- **Chunk merging**: Uses `Uint8Array` for efficient memory handling
- **URL validation**: Prevents malformed download attempts  
- **Dynamic link handling**: Automatically detects new download links on pages
- **Cross-platform**: Works on all Chrome-supported operating systems
- **Extension API**: Full Chrome Downloads API integration

## 🐛 Known Limitations
- **Server dependency**: Chunking requires server-side range request support
- **Memory usage**: Large files are assembled in memory during merge
- **File messaging**: Upload files converted to ArrayBuffer for background processing
- **Update polling**: Some UI updates still use polling vs pure event-driven
- **Filename parsing**: Parses `Content-Disposition` (RFC 5987 + quoted) with a URL-path fallback

## 🔮 Future Roadmap
- **Stream processing**: Reduce memory usage for very large files  
- **Smart chunk sizing**: Dynamic chunk count based on file size and connection speed
- **Upload progress UI**: Real-time chunk-level upload progress visualization
- ~~**Configuration panel**: User-configurable chunk settings~~ ✅ Done in v2.3.0
- **Download queue**: Batch download management with priority controls
- **Bandwidth throttling**: Optional speed limiting for chunked transfers
