const Utils = {
  formatFileSize: (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  validateUrl: (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },

  sanitizeFilename: (filename) => {
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
  },

  getFileExtension: (filename) => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot + 1).toLowerCase() : '';
  },

  isImageFile: (filename) => {
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    return imageExtensions.includes(Utils.getFileExtension(filename));
  },

  formatTimestamp: (timestamp) => {
    return new Date(timestamp).toLocaleString();
  },

  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  isHttpOrHttpsUrl: (url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },

  // Clamp chunk count to valid range. Returns def if value is missing/NaN.
  clampChunkCount: (val, min = 2, max = 32, def = 10) => {
    const n = Number(val);
    return isNaN(n) || n === 0 ? def : Math.min(max, Math.max(min, Math.round(n)));
  },

  // Select the pending-mode entry for a newly-created download from the FIFO
  // queue. Drops entries older than minTimestamp, then prefers an exact
  // sourceUrl match (so a specific ChunkFlow download claims its own badge);
  // if none matches, falls back to the oldest fresh entry (resilient when the
  // created URL differs from what we enqueued, e.g. after a redirect).
  // Returns { entry, remaining }.
  selectPendingMode: (queue, url, minTimestamp = 0) => {
    const fresh = (Array.isArray(queue) ? queue : []).filter((e) => e && e.at > minTimestamp);
    let idx = url ? fresh.findIndex((e) => e.sourceUrl && e.sourceUrl === url) : -1;
    if (idx === -1) idx = fresh.length ? 0 : -1;
    const entry = idx >= 0 ? fresh[idx] : null;
    const remaining = idx >= 0 ? fresh.filter((_, i) => i !== idx) : fresh;
    return { entry, remaining };
  },

  // Roll back a queued pending mode when its download failed to start. Removes
  // the newest entry matching sourceUrl (leaves others intact). Returns new queue.
  removePendingMode: (queue, sourceUrl) => {
    const arr = Array.isArray(queue) ? [...queue] : [];
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].sourceUrl === sourceUrl) {
        arr.splice(i, 1);
        break;
      }
    }
    return arr;
  },

  // Parse an HTTP Content-Range header value, e.g. "bytes 0-1023/4096".
  // Returns { start, end, total } (total null for "*") or null if malformed.
  parseContentRange: (value) => {
    const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value || '');
    if (!match) return null;
    return {
      start: Number(match[1]),
      end: Number(match[2]),
      total: match[3] === '*' ? null : Number(match[3])
    };
  },

  // True if a HEAD/GET response advertises byte-range support via Accept-Ranges.
  headAdvertisesByteRanges: (response) => {
    const raw = (response.headers.get('Accept-Ranges') || '').toLowerCase().trim();
    if (!raw || raw === 'none') return false;
    return raw.split(',').map((token) => token.trim()).includes('bytes') || raw.includes('bytes');
  },

  // Size-aware timeout for offscreen chunk assembly. Conservative ~0.5 MB/s
  // throughput assumption + fixed overhead + per-extra-chunk and per-retry bonuses,
  // clamped to [3 min, 15 min].
  computeOffscreenTimeoutMs: (fileSize, chunkCount = 10, attemptIndex = 0) => {
    const MIN_MS = 3 * 60 * 1000;
    const MAX_MS = 15 * 60 * 1000;
    const minThroughputBytesPerSec = 512 * 1024;
    const transferMs = Math.ceil((fileSize / minThroughputBytesPerSec) * 1000);
    const chunkOverheadMs = Math.max(0, (chunkCount - 4) * 8 * 1000);
    const retryBonusMs = Math.max(0, attemptIndex) * 60 * 1000;
    const estimated = transferMs + 60 * 1000 + chunkOverheadMs + retryBonusMs;
    return Math.min(MAX_MS, Math.max(MIN_MS, estimated));
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
