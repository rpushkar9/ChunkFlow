importScripts('utils.js');

// Files larger than this are sent straight to Chrome's native downloader to avoid
// assembling gigabytes of ArrayBuffers in service-worker memory (OOM risk).
const CHUNK_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
const DEFAULT_CHUNK_COUNT = 10; // used when the user hasn't set a chunk count yet
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

// Flip to true to surface the verbose [ChunkFlow] diagnostics in the
// service-worker console. Warnings/errors are always logged regardless.
const DEBUG = false;
function debugLog(...args) {
  if (DEBUG) console.log(...args);
}

let popupPort = null;

// Blob object URLs are created in the offscreen document and handed to
// chrome.downloads.download. Chrome copies the bytes while the download runs,
// so we must keep each URL alive until the item completes/fails, then revoke it
// in the offscreen context (the only place it can be revoked) to free memory.
// Best-effort: if the service worker unloads mid-download the map is lost and
// the blob is freed when the offscreen document is torn down instead.
const chunkedObjectUrls = new Map(); // downloadId -> objectURL

function revokeObjectUrlInOffscreen(objectUrl) {
  if (!objectUrl || !objectUrl.startsWith('blob:')) return;
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_REVOKE_URL', objectUrl }, () => {
    // Swallow "no receiver" errors if the offscreen document is already gone.
    void chrome.runtime.lastError;
  });
}

function createStorageQueue(defaults) {
  let chain = Promise.resolve();

  return (worker) => new Promise(resolve => {
    chain = chain
      .then(() => new Promise(done => {
        chrome.storage.local.get(defaults, (data) => {
          const result = worker(data) || {};
          const updates = result.updates || {};
          chrome.storage.local.set(updates, () => {
            resolve(result.value);
            done();
          });
        });
      }))
      .catch((error) => {
        console.error('[ChunkFlow] storage queue error:', error);
        resolve(undefined);
      });
  });
}

const withActiveFetchStorage = createStorageQueue({ activeChunkFetches: [] });
const withPendingModeStorage = createStorageQueue({ pendingModeQueue: [] });
const withDownloadModesStorage = createStorageQueue({ downloadModes: {}, downloadModeMeta: {}, downloadModesOrder: [] });

function isTrustedSender(sender) {
  return Boolean(sender && sender.id === chrome.runtime.id);
}

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

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    throw new Error('chrome.offscreen API is unavailable');
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['BLOBS'],
    justification: 'Chunked downloads require Blob URL creation in a document context.'
  });
}

async function buildObjectUrlInOffscreen(url, numberOfChunks, fileSize, mimeType, requestId, timeoutMs) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;

      chrome.runtime.sendMessage({
        type: 'OFFSCREEN_CANCEL_REQUEST',
        requestId
      }, () => {
        // Best-effort cancel only.
      });

      reject(new Error(`Chunk assembly timed out in offscreen context (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_BUILD_OBJECT_URL',
      payload: { url, numberOfChunks, fileSize, mimeType, requestId }
    }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || response.success !== true || !response.objectUrl) {
        reject(new Error(response?.error || 'Offscreen chunk builder failed'));
        return;
      }
      resolve(response.objectUrl);
    });
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

async function probeByteRangeSupport(url) {
  try {
    const probe = await fetchWithRetry(
      url,
      {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        credentials: 'include'
      },
      0
    );

    if (probe.status !== 206) {
      return {
        supported: false,
        reason: `Range probe returned HTTP ${probe.status} instead of 206.`
      };
    }

    const contentRange = probe.headers.get('Content-Range') || '';
    if (!/^bytes\s+0-0\//i.test(contentRange)) {
      return {
        supported: false,
        reason: 'Range probe missing valid Content-Range header.'
      };
    }

    return { supported: true, reason: 'Range probe succeeded.' };
  } catch (error) {
    return {
      supported: false,
      reason: `Range probe failed: ${error.message}`
    };
  }
}

/**
 * Persist a download's mode (chunked | normal | fallback) in chrome.storage.local
 * under the key 'downloadModes', keyed by string download ID.
 * Capped at 100 entries (oldest-first eviction) to avoid unbounded growth.
 * Notifies the popup AFTER the write so the badge is already in storage when
 * fetchDownloads reads it (fixes the race that caused missing mode badges).
 */
function storeDownloadMode(downloadId, mode, meta = {}) {
  const id = String(downloadId);
  withDownloadModesStorage((data) => {
    const modes = { ...(data.downloadModes || {}) };
    const modeMeta = { ...(data.downloadModeMeta || {}) };
    const order = Array.isArray(data.downloadModesOrder) ? [...data.downloadModesOrder] : [];

    modes[id] = mode;
    const existingIndex = order.indexOf(id);
    if (existingIndex !== -1) order.splice(existingIndex, 1);
    order.push(id);

    while (order.length > 100) {
      const evicted = order.shift();
      delete modes[evicted];
      delete modeMeta[evicted];
    }

    modeMeta[id] = {
      source: meta.source || 'chunkflow',
      reason: meta.reason || '',
      sourceUrl: meta.sourceUrl || '',
      recordedAt: Date.now()
    };

    return {
      updates: {
        downloadModes: modes,
        downloadModeMeta: modeMeta,
        downloadModesOrder: order
      }
    };
  }).then(() => {
    if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
  });
}

/**
 * Add a URL to the activeChunkFetches list so the popup can show a
 * "preparing" placeholder while chunks are being assembled (before Chrome
 * creates a download item).
 */
function addActiveChunkFetch(url, requestId) {
  return withActiveFetchStorage((data) => {
    const list = data.activeChunkFetches.filter(e => e.requestId !== requestId);
    list.push({
      requestId,
      url,
      startTime: Date.now(),
      stage: 'starting',
      progressPercent: 0,
      statusText: 'Starting ChunkFlow download...'
    });
    return { updates: { activeChunkFetches: list } };
  }).then(() => {
    if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
  });
}

/** Remove a URL from activeChunkFetches once its Chrome download item exists. */
function removeActiveChunkFetch(requestId) {
  return withActiveFetchStorage((data) => {
    const list = data.activeChunkFetches.filter(e => e.requestId !== requestId);
    return { updates: { activeChunkFetches: list } };
  });
}

function updateActiveChunkFetch(requestId, patch) {
  return withActiveFetchStorage((data) => {
    const list = (data.activeChunkFetches || []).map((entry) => {
      if (entry.requestId !== requestId) return entry;
      return { ...entry, ...patch, updatedAt: Date.now() };
    });
    return { updates: { activeChunkFetches: list } };
  }).then(() => {
    if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });
  });
}

/**
 * Persist pending mode assignments so mode assignment survives service-worker
 * suspension between chrome.downloads.download() and onCreated.
 * Value shape in storage:
 *   pendingModeQueue: [{ mode: 'chunked'|'normal'|'fallback', at: number, sourceUrl: string }, ...]
 */
function enqueuePendingMode(url, mode, details = {}) {
  return withPendingModeStorage((data) => {
    const queue = Array.isArray(data.pendingModeQueue) ? [...data.pendingModeQueue] : [];
    queue.push({
      mode,
      at: Date.now(),
      sourceUrl: url,
      source: details.source || 'chunkflow',
      reason: details.reason || ''
    });
    while (queue.length > 200) queue.shift();
    debugLog(`[ChunkFlow] enqueuePendingMode: mode=${mode} queueSize=${queue.length} url=${url}`);
    return {
      updates: { pendingModeQueue: queue }
    };
  });
}

function consumePendingMode(downloadItem) {
  return withPendingModeStorage((data) => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    let queue = (Array.isArray(data.pendingModeQueue) ? [...data.pendingModeQueue] : [])
      .filter((entry) => entry.at > cutoff);
    let pending = null;

    const queued = queue.shift();
    if (queued) {
      pending = {
        mode: queued.mode,
        source: queued.source || 'chunkflow',
        reason: queued.reason || '',
        sourceUrl: queued.sourceUrl || ''
      };
    }

    debugLog(
      `[ChunkFlow] consumePendingMode: resolvedMode=${pending?.mode || 'none'} queueRemaining=${queue.length} ` +
      `createdUrl=${downloadItem.url} sourceUrl=${pending?.sourceUrl || 'n/a'}`
    );

    return {
      updates: { pendingModeQueue: queue },
      value: pending
    };
  });
}

// ---------------------------------------------------------------------------
// Download engine
// ---------------------------------------------------------------------------

async function downloadInChunks(url, numberOfChunks = 10) {
  debugLog(`[ChunkFlow] downloadInChunks: ${numberOfChunks} chunks for ${url}`);
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Show a "preparing" placeholder in the popup immediately, before Chrome
  // creates a download item (which only happens after all chunks are assembled).
  await addActiveChunkFetch(url, requestId);

  try {
    const headResponse = await fetchWithRetry(url, { method: 'HEAD', credentials: 'include' });
    debugLog('[ChunkFlow] HEAD response received');
    await updateActiveChunkFetch(requestId, {
      stage: 'head-ok',
      statusText: 'Server check passed. Preparing chunk requests...'
    });

    // Capture the URL after redirects so all chunk GETs go to the same
    // CDN endpoint and use the same auth tokens (critical for Google Drive etc.)
    const finalUrl = headResponse.url || url;
    const filename  = getFilename(headResponse, url);

    let hasRangeSupport = Utils.headAdvertisesByteRanges(headResponse);
    let rangeReason = hasRangeSupport
      ? 'HEAD advertised byte range support.'
      : 'HEAD did not clearly advertise byte ranges.';

    if (!hasRangeSupport) {
      await updateActiveChunkFetch(requestId, {
        stage: 'range-probe',
        statusText: 'Checking range support with probe request...'
      });
      const probe = await probeByteRangeSupport(finalUrl);
      hasRangeSupport = probe.supported;
      rangeReason = probe.reason;
      debugLog(`[ChunkFlow] Range probe result: ${probe.reason}`);
    }

    if (!hasRangeSupport) {
      debugLog('[ChunkFlow] No range support — using normal download');
      await removeActiveChunkFetch(requestId);
      await enqueuePendingMode(url, 'normal', {
        reason: `ChunkFlow used native path because range support was unavailable. ${rangeReason}`
      });
      chrome.downloads.download({ url, filename });
      return;
    }

    const fileSize = parseInt(headResponse.headers.get('Content-Length'));
    const mimeType = headResponse.headers.get('Content-Type') || 'application/octet-stream';

    if (!fileSize || fileSize <= 0) {
      throw new Error('Invalid or missing Content-Length header');
    }

    // Skip in-memory chunking for large files to avoid OOM in the service worker.
    if (fileSize > CHUNK_MAX_BYTES) {
      debugLog(`[ChunkFlow] File too large for in-memory chunking ` +
        `(${Utils.formatFileSize(fileSize)} > ${Utils.formatFileSize(CHUNK_MAX_BYTES)}) — using normal download`);
      await removeActiveChunkFetch(requestId);
      await enqueuePendingMode(url, 'normal', {
        reason: `File exceeded 500 MB in-memory chunking safety limit (${Utils.formatFileSize(fileSize)}).`
      });
      chrome.downloads.download({ url, filename });
      return;
    }

    // Cap the chunk count by file size so every chunk is at least 1 byte. A user
    // can request up to 32 chunks, which would otherwise produce invalid ranges
    // (e.g. bytes=5-4) and force an avoidable fallback on tiny files.
    const effectiveChunkCount = Math.max(1, Math.min(numberOfChunks, fileSize));
    const attemptChunkCounts = [effectiveChunkCount]
      .concat(effectiveChunkCount > 6 ? [6] : [])
      .concat(effectiveChunkCount > 4 ? [4] : [])
      .filter((count, index, arr) => arr.indexOf(count) === index);

    let objectURL;
    let usedChunkCount = numberOfChunks;

    for (let attemptIndex = 0; attemptIndex < attemptChunkCounts.length; attemptIndex++) {
      const attemptChunkCount = attemptChunkCounts[attemptIndex];
      const timeoutMs = Utils.computeOffscreenTimeoutMs(fileSize, attemptChunkCount, attemptIndex);

      await updateActiveChunkFetch(requestId, {
        stage: attemptIndex === 0 ? 'chunking' : 'retrying',
        statusText:
          attemptIndex === 0
            ? `Downloading ${attemptChunkCount} chunks (timeout ${Math.round(timeoutMs / 1000)}s)...`
            : `Retry ${attemptIndex + 1}: ${attemptChunkCount} chunks (timeout ${Math.round(timeoutMs / 1000)}s)...`,
        progressPercent: 1
      });

      try {
        objectURL = await buildObjectUrlInOffscreen(
          finalUrl,
          attemptChunkCount,
          fileSize,
          mimeType,
          requestId,
          timeoutMs
        );
        usedChunkCount = attemptChunkCount;
        break;
      } catch (attemptError) {
        const hasAnotherAttempt = attemptIndex < attemptChunkCounts.length - 1;
        if (!hasAnotherAttempt) throw attemptError;

        console.warn(
          `[ChunkFlow] chunk attempt ${attemptIndex + 1} failed (${attemptChunkCount} chunks): ${attemptError.message}`
        );
        await updateActiveChunkFetch(requestId, {
          stage: 'retrying',
          statusText: `Retrying after failure: ${attemptError.message}`,
          progressPercent: 1
        });
      }
    }

    if (!objectURL) {
      throw new Error('Chunk assembly did not produce an object URL');
    }

    // Remove the placeholder BEFORE creating the Chrome item so the popup
    // never shows both the placeholder and the real item simultaneously.
    await removeActiveChunkFetch(requestId);

    await enqueuePendingMode(objectURL, 'chunked', {
      reason: `Range support confirmed. File assembled from ${usedChunkCount} parallel chunks in offscreen context.`
    });
    chrome.downloads.download({ url: objectURL, filename }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId == null) {
        // Download never started — revoke immediately so the blob isn't leaked.
        revokeObjectUrlInOffscreen(objectURL);
        return;
      }
      chunkedObjectUrls.set(downloadId, objectURL);
    });

    if (popupPort) {
      popupPort.postMessage({ type: 'DOWNLOAD_READY', url: objectURL, filename, isChunked: true });
    }

  } catch (error) {
    console.error('[ChunkFlow] Download error:', error);
    if (popupPort) {
      popupPort.postMessage({ type: 'ERROR', message: `Download failed: ${error.message}` });
    }

    // Best-effort fallback to Chrome's native downloader.
    debugLog('[ChunkFlow] Falling back to normal download');
    await removeActiveChunkFetch(requestId);
    await enqueuePendingMode(url, 'fallback', {
      reason: `Chunking failed and native Chrome download was used (${error.message}).`
    });
    try {
      const filename = new URL(url).pathname.split('/').pop() || 'downloaded_file';
      chrome.downloads.download({ url, filename });
    } catch {
      chrome.downloads.download({ url });
    }
  }
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
        debugLog(`Chunk ${start}-${end} progress: ${Math.round((event.loaded / event.total) * 100)}%`);
      }
    };

    xhr.send(chunkData);
  });
}

function handleUpload(fileData, fileName, uploadUrl, numberOfChunks = 10) {
  return checkServerSupport(uploadUrl).then(isSupported => {
    if (isSupported) {
      debugLog('Using chunked upload');
      return uploadInChunks(fileData, fileName, uploadUrl, numberOfChunks);
    } else {
      debugLog('Using normal upload');
      return uploadFileNormally(fileData, fileName, uploadUrl);
    }
  });
}

function storeUploadedFileDetails(fileName, fileSize, fileType) {
  chrome.storage.local.get('uploadedFiles', (data) => {
    const uploadedFiles = data.uploadedFiles || [];
    uploadedFiles.push({ name: fileName, size: fileSize, type: fileType, timestamp: Date.now() });
    chrome.storage.local.set({ uploadedFiles }, () => {
      debugLog('Uploaded file details stored successfully.');
    });
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getChunkCount(callback) {
  chrome.storage.local.get({ chunkCount: DEFAULT_CHUNK_COUNT }, (data) => {
    const count = Utils.clampChunkCount(data.chunkCount, 2, 32, DEFAULT_CHUNK_COUNT);
    debugLog(`[ChunkFlow] getChunkCount: using ${count} (saved: ${data.chunkCount})`);
    callback(count);
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OFFSCREEN_BUILD_OBJECT_URL') {
    // This message is intended for offscreen.js, not background.js.
    return false;
  }

  if (!isTrustedSender(sender)) {
    sendResponse({ success: false, error: 'Untrusted message sender' });
    return false;
  }

  switch (message.type) {
    case 'START_DOWNLOAD':
      if (!Utils.isHttpOrHttpsUrl(message.url)) {
        sendResponse({ success: false, error: 'Invalid download URL' });
        return false;
      }
      debugLog('Starting download for URL:', message.url);
      getChunkCount((count) => {
        downloadInChunks(message.url, count);
        sendResponse({ success: true });
      });
      return true;

    case 'DELETE_DOWNLOAD':
      chrome.downloads.search({ id: message.downloadId }, ([download]) => {
        if (!download) return;

        const eraseOnly = () => {
          chrome.downloads.erase({ id: message.downloadId }, () => {
            if (chrome.runtime.lastError) {
              console.warn(`Erase warning for ${message.downloadId}: ${chrome.runtime.lastError.message}`);
              return;
            }
            debugLog(`Deleted download with ID ${message.downloadId}`);
          });
        };

        if (download.state !== 'complete') {
          chrome.downloads.cancel(message.downloadId, () => {
            // Ignore cancel warnings for already-stopped items.
            eraseOnly();
          });
          return;
        }

        chrome.downloads.removeFile(message.downloadId, () => {
          if (chrome.runtime.lastError) {
            console.warn(`removeFile warning for ${message.downloadId}: ${chrome.runtime.lastError.message}`);
          }
          eraseOnly();
        });
      });
      break;

    case 'PAUSE_DOWNLOAD':
      chrome.downloads.pause(message.downloadId, () => {
        debugLog(`Paused download with ID ${message.downloadId}`);
      });
      break;

    case 'RESUME_DOWNLOAD':
      chrome.downloads.resume(message.downloadId, () => {
        debugLog(`Resumed download with ID ${message.downloadId}`);
      });
      break;

    case 'RESTART_DOWNLOAD':
      chrome.downloads.search({ id: message.downloadId }, ([download]) => {
        if (download) {
          const originalUrl = download.finalUrl || download.url;
          debugLog('Retrieving URL for restart. Download ID:', message.downloadId, 'URL:', originalUrl);
          if (originalUrl) {
            chrome.downloads.cancel(message.downloadId, () => {
              enqueuePendingMode(originalUrl, 'normal', {
                reason: 'Manual restart uses native Chrome download path.'
              }).then(() => {
                chrome.downloads.download({ url: originalUrl }, (newDownloadId) => {
                  debugLog('Restarted download with ID:', newDownloadId, 'URL:', originalUrl);
                });
              });
            });
          } else {
            debugLog('Could not restart download with ID', message.downloadId, ': URL not found.');
          }
        }
      });
      break;

    case 'UPLOAD_FILE':
      if (!message.fileData || !message.fileName || !message.uploadUrl) {
        sendResponse({ success: false, error: 'Missing required upload data' });
        return false;
      }
      if (!Utils.isHttpOrHttpsUrl(message.uploadUrl)) {
        sendResponse({ success: false, error: 'Invalid upload URL' });
        return false;
      }
      getChunkCount((count) => {
        handleUpload(message.fileData, message.fileName, message.uploadUrl, count)
          .then(response => {
            debugLog('Upload successful:', response);
            storeUploadedFileDetails(message.fileName, message.fileSize, message.fileType);
            sendResponse({ success: true, response });
          })
          .catch(error => {
            console.error('Upload failed:', error);
            sendResponse({ success: false, error: error.message });
          });
      });
      return true;

    case 'OFFSCREEN_CHUNK_PROGRESS':
      if (message.requestId) {
        debugLog(
          `[ChunkFlow] progress: request=${message.requestId} stage=${message.stage || 'chunking'} ` +
          `percent=${typeof message.progressPercent === 'number' ? message.progressPercent : 'n/a'} ` +
          `status=${message.statusText || ''}`
        );
        updateActiveChunkFetch(message.requestId, {
          stage: message.stage || 'chunking',
          progressPercent: typeof message.progressPercent === 'number' ? message.progressPercent : undefined,
          statusText: message.statusText || 'Downloading chunks...'
        });
      }
      return false;

    case 'GET_UPLOADED_FILES':
      chrome.storage.local.get('uploadedFiles', (data) => {
        sendResponse({ uploadedFiles: data.uploadedFiles || [] });
      });
      return true;

    default:
      debugLog('Unknown message type:', message.type);
      break;
  }
});

// ---------------------------------------------------------------------------
// Download event listeners → notify popup
// ---------------------------------------------------------------------------

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (popupPort) popupPort.postMessage({ type: 'DOWNLOAD_UPDATE' });

  // Once a chunked download reaches a terminal state, revoke its blob URL.
  const state = downloadDelta.state?.current;
  if ((state === 'complete' || state === 'interrupted') && chunkedObjectUrls.has(downloadDelta.id)) {
    const objectUrl = chunkedObjectUrls.get(downloadDelta.id);
    chunkedObjectUrls.delete(downloadDelta.id);
    revokeObjectUrlInOffscreen(objectUrl);
  }
});

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  debugLog('Download created:', downloadItem.id);

  const pending = await consumePendingMode(downloadItem);
  if (pending?.mode) {
    // Download initiated by ChunkFlow.
    // Doing this in onCreated guarantees the mode is in storage before the
    // popup's next render.
    storeDownloadMode(downloadItem.id, pending.mode, {
      source: pending.source,
      reason: pending.reason,
      sourceUrl: pending.sourceUrl
    });
    return; // storeDownloadMode sends DOWNLOAD_UPDATE after the write
  }

  // Download NOT initiated by ChunkFlow (e.g. Google Drive button, other
  // extensions, direct URL bar downloads).  Tag it so the popup can show a
  // "↓ Browser" badge instead of showing nothing.
  storeDownloadMode(downloadItem.id, 'browser', {
    source: 'browser',
    reason: 'Started outside ChunkFlow (address bar/default browser download or another extension).',
    sourceUrl: downloadItem.url || ''
  });
});

chrome.downloads.onErased.addListener((downloadId) => {
  debugLog('Download erased:', downloadId);
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
  if (info.menuItemId === 'download-with-chunks' && info.linkUrl && Utils.isHttpOrHttpsUrl(info.linkUrl)) {
    debugLog('Context menu download:', info.linkUrl);
    getChunkCount((count) => {
      downloadInChunks(info.linkUrl, count);
    });
  }
});
