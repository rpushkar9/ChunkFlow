const activeChunkRequests = new Map();

async function fetchWithRetry(url, options, maxRetries = 1) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    if (maxRetries > 0) {
      return fetchWithRetry(url, options, maxRetries - 1);
    }
    throw error;
  }
}

function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value || '');
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3])
  };
}

async function buildObjectUrl(url, numberOfChunks, fileSize, mimeType, requestId) {
  const controller = new AbortController();
  if (requestId) {
    const existing = activeChunkRequests.get(requestId);
    if (existing) existing.abort();
    activeChunkRequests.set(requestId, controller);
  }

  const chunkSize = Math.ceil(fileSize / numberOfChunks);
  const chunkPromises = [];
  let completed = 0;
  const startedAt = Date.now();

  const sendProgress = (progressPercent, statusText, stage = 'chunking') => {
    if (!requestId) return;
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CHUNK_PROGRESS',
      requestId,
      stage,
      progressPercent,
      statusText
    });
  };

  sendProgress(1, `Downloading ${numberOfChunks} chunks...`, 'chunking');

  const heartbeat = setInterval(() => {
    const elapsedSec = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const percent = Math.max(1, Math.round((completed / numberOfChunks) * 90));
    sendProgress(percent, `Still working: ${completed}/${numberOfChunks} chunks (${elapsedSec}s)`, 'chunking');
  }, 2000);

  try {
    for (let i = 0; i < numberOfChunks; i++) {
      const start = i * chunkSize;
      const end = i === numberOfChunks - 1 ? fileSize - 1 : (start + chunkSize - 1);

      chunkPromises.push(
        fetchWithRetry(
          url,
          {
            headers: { Range: `bytes=${start}-${end}` },
            credentials: 'include',
            signal: controller.signal
          }
        ).then(async (res) => {
          if (res.status !== 206) {
            throw new Error(`Invalid range response for chunk ${i}: expected 206, got ${res.status}`);
          }

          const contentRange = parseContentRange(res.headers.get('Content-Range'));
          if (!contentRange) {
            throw new Error(`Missing/invalid Content-Range for chunk ${i}`);
          }
          if (contentRange.start !== start || contentRange.end !== end) {
            throw new Error(`Unexpected Content-Range for chunk ${i}: ${contentRange.start}-${contentRange.end}`);
          }
          if (contentRange.total !== null && contentRange.total !== fileSize) {
            throw new Error(`Unexpected total size for chunk ${i}: ${contentRange.total}`);
          }

          const buffer = await res.arrayBuffer();
          const expectedBytes = end - start + 1;
          if (buffer.byteLength !== expectedBytes) {
            throw new Error(
              `Unexpected chunk byte length for chunk ${i}: expected ${expectedBytes}, got ${buffer.byteLength}`
            );
          }

          completed += 1;
          sendProgress(
            Math.max(2, Math.round((completed / numberOfChunks) * 90)),
            `Fetched chunk ${completed}/${numberOfChunks}`,
            'chunking'
          );

          return buffer;
        })
      );
    }

    const chunks = await Promise.all(chunkPromises);
    const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    sendProgress(95, 'Assembling merged file...', 'assembling');
    const merged = new Uint8Array(totalBytes);
    let offset = 0;

    chunks.forEach((chunk) => {
      merged.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    });

    const blob = new Blob([merged], { type: mimeType || 'application/octet-stream' });
    sendProgress(100, 'Chunk merge complete. Handing off to Chrome...', 'complete');
    return URL.createObjectURL(blob);
  } finally {
    clearInterval(heartbeat);
    if (requestId) activeChunkRequests.delete(requestId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'OFFSCREEN_BUILD_OBJECT_URL' && message?.type !== 'OFFSCREEN_CANCEL_REQUEST') {
    return false;
  }

  const expectedSenderUrl = chrome.runtime.getURL('background.js');
  if (sender?.id !== chrome.runtime.id || sender?.url !== expectedSenderUrl) {
    sendResponse({ success: false, error: 'Untrusted OFFSCREEN_BUILD_OBJECT_URL sender' });
    return false;
  }

  if (message.type === 'OFFSCREEN_CANCEL_REQUEST') {
    const requestId = message.requestId;
    if (requestId && activeChunkRequests.has(requestId)) {
      activeChunkRequests.get(requestId).abort();
      activeChunkRequests.delete(requestId);
      sendResponse({ success: true, cancelled: true });
      return false;
    }
    sendResponse({ success: true, cancelled: false });
    return false;
  }

  const payload = message.payload || {};
  const url = payload.url;
  const numberOfChunks = Number(payload.numberOfChunks || 10);
  const fileSize = Number(payload.fileSize || 0);
  const mimeType = payload.mimeType || 'application/octet-stream';

  if (!Utils.isHttpOrHttpsUrl(url)) {
    sendResponse({ success: false, error: 'Invalid URL for offscreen chunking' });
    return false;
  }

  if (!fileSize || fileSize <= 0) {
    sendResponse({ success: false, error: 'Invalid file size for offscreen chunking' });
    return false;
  }

  buildObjectUrl(url, numberOfChunks, fileSize, mimeType, payload.requestId)
    .then((objectUrl) => {
      sendResponse({ success: true, objectUrl });
    })
    .catch((error) => {
      sendResponse({ success: false, error: error.message || String(error) });
    });

  return true;
});
