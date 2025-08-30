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

### Background Service Worker (`background.js`)
- **Download engine**: Implements `downloadInChunks()` with HEAD request validation, parallel fetch operations, and chunk merging
- **Upload engine**: Handles both normal and chunked uploads with server compatibility detection
- **Chrome Downloads API integration**: Manages pause/resume/restart/delete operations
- **Storage management**: Persists upload history to `chrome.storage.local`
- **Event-driven updates**: Real-time communication with popup via ports

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
1. **HEAD request** to check `Accept-Ranges: bytes` header
2. **Parallel fetching** of byte ranges (default: 10 chunks)
3. **Chunk validation** and error handling per segment  
4. **Memory-efficient merging** into single `Uint8Array`
5. **Blob creation** and automatic download trigger

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
- **`storage`**: Persist upload history  
- **`contextMenus`**: Right-click download options
- **`<all_urls>`**: Detect download links on any website
- **Optional `management`**: Extension management features

## 🚀 Installation & Usage

### Installation
1. Download the extension files
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder
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
- **Default chunks**: 10 parallel streams (configurable in code)
- **Update frequency**: 500ms active, 2s idle
- **File detection**: Automatic by extension
- **Memory usage**: Optimized for large files

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
- **Filename parsing**: Uses URL path, doesn't parse `Content-Disposition` headers

## 🔮 Future Roadmap
- **Stream processing**: Reduce memory usage for very large files  
- **Smart chunk sizing**: Dynamic chunk count based on file size and connection speed
- **Content-Disposition parsing**: Better filename detection from HTTP headers
- **Upload progress UI**: Real-time chunk-level upload progress visualization
- **Configuration panel**: User-configurable chunk settings
- **Download queue**: Batch download management with priority controls
- **Bandwidth throttling**: Optional speed limiting for chunked transfers