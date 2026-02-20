importScripts('utils.js');

// Files larger than this are sent straight to Chrome's native downloader to avoid
// assembling gigabytes of ArrayBuffers in service-worker memory (OOM risk).
const CHUNK_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

let popupPort = null;

chrome.runtime.onConnect.addListener((port) => {
  popupPort = port;
  port.onDisconnect.addListener(() => {
    popupPort = null;
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch with automatic retry on network failure.
 * maxRetries=1 means one retry after the initial attempt (2 total tries).
 */
function fetchWithRetry(url, options, maxRetries = 1) {
  return fetch(url, options).catch((err) => {
    if (maxRetries > 0) {
      console.warn(`[ChunkFlow] fetch failed, retrying (${maxRetries} left): ${err.message}`);
      return fetchWithRetry(url, options, maxRetries - 1);
    }
    throw err;
  });
}

/**
 * Extract a filename from the Content-Disposition response header.
 * Tries RFC 5987 percent-encoded form first, then quoted, then bare.
 * Falls back to the last path segment of fallbackUrl.
 */
function getFilename(response, fallbackUrl) {
  const cd = response.headers.get('Content-Disposition');
  if (cd) {
    // RFC 5987: filename*=UTF-8''percent-encoded-name
    let m = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
    if (m) {
      try { return Utils.sanitizeFilename(decodeURIComponent(m[1])); } catch {}
    }
    // Quoted: filename="name"
    m = cd.match(/filename="([^"]+)"/i);
    if (m) return Utils.sanitizeFilename(m[1]);
    // Bare: filename=name
    m = cd.match(/filename=([^;\s]+)/i);
    if (m) return Utils.sanitizeFilename(m[1]);
  }
  try {
    const seg = new URL(fallbackUrl).pathname.split('/').pop();
    return Utils.sanitizeFilename(seg || 'downloaded_file');
  } catch {
    return 'downloaded_file';
  }
}

/**
 * Persist a download's mode (chunked | normal | fallback) in chrome.storage.local
 * under the key 'downloadModes', keyed by string download ID.
 * Capped at 100 entries (oldest-first eviction) to avoid unbounded growth.
 */
function storeDownloadMode(downloadId, mode) {
  chrome.storage.local.get({ downloadModes: {} }, (data) => {
    const modes = data.downloadModes;
    modes[String(downloadId)] = mode;
    const keys = Object.keys(modes);
    if (keys.length > 100) delete modes[keys[0]];
    chrome.storage.local.set({ downloadModes: modes });
  });
}

// ---------------------------------------------------------------------------
// Download engine
// ---------------------------------------------------------------------------

function downloadInChunks(url, numberOfChunks = 10) {
  console.log(`[ChunkFlow] downloadInChunks: ${numberOfChunks} chunks for ${url}`);

  return fetch(url, { method: 'HEAD', credentials: 'include' })
    .then(response => {
      console.log('[ChunkFlow] HEAD response received');

      // Capture the URL after redirects so all chunk GETs go to the same
      // CDN endpoint and use the same auth tokens (critical for Google Drive etc.)
      const finalUrl = response.url || url;
      const filename  = getFilename(response, url);

      if (response.headers.get('Accept-Ranges') !== 'bytes') {
        console.log('[ChunkFlow] No range support — using normal download');
        chrome.downloads.download({ url, filename }, (id) => {
          if (id) storeDownloadMode(id, 'normal');
        });
        return null;
      }

      const fileSize = parseInt(response.headers.get('Content-Length'));
      const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';

      if (!fileSize || fileSize <= 0) {
        throw new Error('Invalid or missing Content-Length header');
      }

      // Skip in-memory chunking for large files to avoid OOM in the service worker.
      if (fileSize > CHUNK_MAX_BYTES) {
        console.log(`[ChunkFlow] File too large for in-memory chunking ` +
          `(${Utils.formatFileSize(fileSize)} > ${Utils.formatFileSize(CHUNK_MAX_BYTES)}) — using normal download`);
        chrome.downloads.download({ url, filename }, (id) => {
          if (id) storeDownloadMode(id, 'normal');
        });
        return null;
      }

      return { fileSize, mimeType, finalUrl, filename };
    })
    .then((result) => {
      if (!result) return null;

      const { fileSize, mimeType, finalUrl, filename } = result;
      const chunkSize = Math.ceil(fileSize / numberOfChunks);
      const chunkPromises = [];

      for (let i = 0; i < numberOfChunks; i++) {
        const start = i * chunkSize;
        const end = i === numberOfChunks - 1 ? fileSize - 1 : (start + chunkSize - 1);

        chunkPromises.push(
          fetchWithRetry(
            finalUrl,
            { headers: { Range: `bytes=${start}-${end}` }, credentials: 'include' }
          ).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch chunk ${i}: ${res.status}`);
            return res.arrayBuffer();
          })
        );
      }

      return Promise.all(chunkPromises)
        .then(chunks => {
          const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
          const merged = new Uint8Array(totalBytes);
          let offset = 0;
          chunks.forEach(c => {
            merged.set(new Uint8Array(c), offset);
            offset += c.byteLength;
          });

          const blob      = new Blob([merged], { type: mimeType });
          const objectURL = URL.createObjectURL(blob);

          chrome.downloads.download({ url: objectURL, filename }, (id) => {
            if (id) storeDownloadMode(id, 'chunked');
          });

          if (popupPort) {
            popupPort.postMessage({ type: 'DOWNLOAD_READY', url: objectURL, filename, isChunked: true });
          }

          return blob;
        });
    })
    .catch(error => {
      console.error('[ChunkFlow] Download error:', error);
      if (popupPort) {
        popupPort.postMessage({ type: 'ERROR', message: `Download failed: ${error.message}` });
      }

      // Best-effort fallback to Chrome's native downloader.
      console.log('[ChunkFlow] Falling back to normal download');
      try {
        const filename = new URL(url).pathname.split('/').pop() || 'downloaded_file';
        chrome.downloads.download({ url, filename }, (id) => {
          if (id) storeDownloadMode(id, 'fallback');
        });
      } catch {
        chrome.downloads.download({ url }, (id) => {
          if (id) storeDownloadMode(id, 'fallback');
        });
      }
    });
}

// ---------------------------------------------------------------------------
// Upload engine (unchanged logic; credentials added to server check)
// ---------------------------------------------------------------------------

function checkServerSupport(uploadUrl) {
  return fetch(uploadUrl, { method: 'HEAD', credentials: 'include' })
    .then(response => {
      if (response.ok) {
        return response.headers.get('Accept-Ranges') === 'bytes';
      } else {
        throw new Error(`Server check failed: ${response.status}`);
      }
    })
    .catch(error => {
      console.warn('Server support check failed:', error);
      return false;
    });
}

function uploadFileNormally(fileData, fileName, uploadUrl) {
  const formData = new FormData();
  const blob = new Blob([fileData]);
  formData.append('file', blob, fileName);

  return fetch(uploadUrl, { method: 'POST', body: formData })
    .then(response => {
      if (response.ok) {
        return response.text();
      } else {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }
    });
}

function uploadInChunks(fileData, fileName, uploadUrl, numberOfChunks = 10) {
  const fileSize  = fileData.byteLength;
  const chunkSize = Math.ceil(fileSize / numberOfChunks);
  const chunkPromises = [];

  for (let i = 0; i < numberOfChunks; i++) {
    const start     = i * chunkSize;
    const end       = Math.min(start + chunkSize, fileSize);
    const chunkData = fileData.slice(start, end);
    chunkPromises.push(uploadChunk(chunkData, uploadUrl, start, end - 1, fileSize));
  }

  return Promise.all(chunkPromises);
}

function uploadChunk(chunkData, uploadUrl, start, end, totalSize) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl, true);
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Failed to upload chunk: ${xhr.status} ${xhr.statusText}`));
      }
    };
    xhr.onerror = function () {
      reject(new Error('Network error during chunk upload'));
    };
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        console.log(`Chunk ${start}-${end} progress: ${Math.round((event.loaded / event.total) * 100)}%`);
      }
    };

    xhr.send(chunkData);
  });
}

function handleUpload(fileData, fileName, uploadUrl, numberOfChunks = 10) {
  return checkServerSupport(uploadUrl).then(isSupported => {
    if (isSupported) {
      console.log('Using chunked upload');
      return uploadInChunks(fileData, fileName, uploadUrl, numberOfChunks);
    } else {
      console.log('Using normal upload');
      return uploadFileNormally(fileData, fileName, uploadUrl);
    }
  });
}

function storeUploadedFileDetails(fileName, fileSize, fileType) {
  chrome.storage.local.get('uploadedFiles', (data) => {
    const uploadedFiles = data.uploadedFiles || [];
    uploadedFiles.push({ name: fileName, size: fileSize, type: fileType, timestamp: Date.now() });
    chrome.storage.local.set({ uploadedFiles }, () => {
      console.log('Uploaded file details stored successfully.');
    });
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getChunkCount(callback) {
  chrome.storage.local.get({ chunkCount: 10 }, (data) => {
    const count = Utils.clampChunkCount(data.chunkCount);
    console.log(`[ChunkFlow] getChunkCount: resolved to ${count}`);
    callback(count);
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_DOWNLOAD':
      console.log('Starting download for URL:', message.url);
      getChunkCount((count) => {
        downloadInChunks(message.url, count);
        sendResponse({ success: true });
      });
      return true;

    case 'DELETE_DOWNLOAD':
      chrome.downloads.removeFile(message.downloadId, () => {
        chrome.downloads.erase({ id: message.downloadId }, () => {
          console.log(`Deleted download with ID ${message.downloadId}`);
        });
      });
      break;

    case 'PAUSE_DOWNLOAD':
      chrome.downloads.pause(message.downloadId, () => {
        console.log(`Paused download with ID ${message.downloadId}`);
      });
      break;

    case 'RESUME_DOWNLOAD':
      chrome.downloads.resume(message.downloadId, () => {
        console.log(`Resumed download with ID ${message.downloadId}`);
      });
      break;

    case 'RESTART_DOWNLOAD':
      chrome.downloads.search({ id: message.downloadId }, ([download]) => {
        if (download) {
          const originalUrl = download.finalUrl || download.url;
          console.log('Retrieving URL for restart. Download ID:', message.downloadId, 'URL:', originalUrl);
          if (originalUrl) {
            chrome.downloads.cancel(message.downloadId, () => {
              chrome.downloads.download({ url: originalUrl }, (newDownloadId) => {
                console.log('Restarted download with ID:', newDownloadId, 'URL:', originalUrl);
              });
            });
          } else {
            console.log('Could not restart download with ID', message.downloadId, ': URL not found.');
          }
        }
      });
      break;

    case 'UPLOAD_FILE':
      if (!message.fileData || !message.fileName || !message.uploadUrl) {
        sendResponse({ success: false, error: 'Missing required upload data' });
        return;
      }
      getChunkCount((count) => {
        handleUpload(message.fileData, message.fileName, message.uploadUrl, count)
          .then(response => {
            console.log('Upload successful:', response);
            storeUploadedFileDetails(message.fileName, message.fileSize, message.fileType);
            sendResponse({ success: true, response });
          })
          .catch(error => {
            console.error('Upload failed:', error);
            sendResponse({ success: false, error: error.message });
          });
      });
      return true;

    case 'GET_UPLOADED_FILES':
      chrome.storage.local.get('uploadedFiles', (data) => {
        sendResponse({ uploadedFiles: data.uploadedFiles || [] });
      });
      return true;

    default:
      console.log('Unknown message type:', message.type);
      break;
  }
});

// ---------------------------------------------------------------------------
// Download event listeners → notify popup
// ---------------------------------------------------------------------------

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
});

chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('Download created:', downloadItem.id);
  if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
});

chrome.downloads.onErased.addListener((downloadId) => {
  console.log('Download erased:', downloadId);
  if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
});

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'download-with-chunks',
    title: 'Download with ChunkFlow',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-with-chunks' && info.linkUrl) {
    console.log('Context menu download:', info.linkUrl);
    getChunkCount((count) => {
      downloadInChunks(info.linkUrl, count);
    });
  }
});
