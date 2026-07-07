let selectedFile = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a concise human-readable string for a download's startTime ISO string.
 * Examples: "Just now", "5m ago", "Today 2:30 PM", "Yesterday 9:14 AM", "Feb 3 11:00 AM"
 */
const formatDownloadTime = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now  = new Date();
  const diffMin = Math.floor((now - date) / 60000);

  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const todayStr     = now.toDateString();
  const yesterdayStr = new Date(now - 86400000).toDateString();

  if (date.toDateString() === todayStr)     return `Today ${time}`;
  if (date.toDateString() === yesterdayStr) return `Yesterday ${time}`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${time}`;
};

// ---------------------------------------------------------------------------
// Download list rendering
// ---------------------------------------------------------------------------

/**
 * Render the downloads list.
 * modes — object from chrome.storage.local 'downloadModes', keyed by string download ID.
 *   Values: 'chunked' | 'normal' | 'fallback' | 'browser'
 * modeMeta — object from chrome.storage.local 'downloadModeMeta', keyed by string download ID.
 *   Values: { source, reason, sourceUrl, recordedAt }
 * activeFetches — array of { url, startTime } for chunk fetches still assembling
 *   (no Chrome download item exists yet for these).
 */
const getModeBadgeText = (mode) => (
  mode === 'chunked'  ? '⚡ Chunked'  :
  mode === 'fallback' ? '⚠ Fallback' :
  mode === 'browser'  ? '🌐 Browser'  : '⬇ Normal (CF)'
);

const getModeDetailText = (mode, meta) => {
  const sourceLabel = meta?.source === 'browser' ? 'Path: Browser' : 'Path: ChunkFlow';
  const reason = meta?.reason;

  if (reason) return `${sourceLabel} - ${reason}`;

  if (mode === 'chunked') return `${sourceLabel} - Parallel chunk path succeeded.`;
  if (mode === 'normal') return `${sourceLabel} - Native Chrome path used by design.`;
  if (mode === 'fallback') return `${sourceLabel} - Chunking failed, then switched to native path.`;
  if (mode === 'browser') return 'Path: Browser - Download started outside ChunkFlow.';
  return '';
};

const updateDownloadsList = (downloads, modes = {}, activeFetches = [], modeMeta = {}) => {
  const downloadsListDiv = document.getElementById('downloads-list');
  const runtimeBanner = document.getElementById('chunkflow-runtime-banner');
  downloadsListDiv.innerHTML = '';

  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  const pendingFetches = activeFetches.filter(e => e.startTime > fiveMinutesAgo);

  if (runtimeBanner) {
    if (pendingFetches.length > 0) {
      const first = pendingFetches[0];
      const elapsedSec = Math.max(0, Math.round((Date.now() - (first.startTime || Date.now())) / 1000));
      runtimeBanner.style.display = 'block';
      runtimeBanner.textContent = `ChunkFlow is working (${pendingFetches.length} active). ` +
        `${first.statusText || 'Downloading chunks...'} (${elapsedSec}s)`;
    } else {
      runtimeBanner.style.display = 'none';
      runtimeBanner.textContent = '';
    }
  }

  if (downloads.length === 0 && pendingFetches.length === 0) {
    downloadsListDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No downloads yet</p>';
    return;
  }

  // Show "preparing" placeholders for chunk fetches first so active work is
  // always visible at the top.
  pendingFetches.forEach(e => {
    let displayName;
    try {
      displayName = new URL(e.url).pathname.split('/').pop() || e.url;
    } catch {
      displayName = e.url;
    }

    const pendingDiv = document.createElement('div');
    pendingDiv.className = 'download-item pending-chunk';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'download-name';
    nameDiv.textContent = displayName;
    pendingDiv.appendChild(nameDiv);

    const statusDiv = document.createElement('div');
    statusDiv.className = 'download-status';
    statusDiv.textContent = `Status: ${e.statusText || 'Fetching chunks...'}`;
    pendingDiv.appendChild(statusDiv);

    const stageDiv = document.createElement('div');
    stageDiv.className = 'download-mode-detail';
    stageDiv.textContent = `Path: ChunkFlow - Stage: ${e.stage || 'chunking'}`;
    pendingDiv.appendChild(stageDiv);

    const badgeDiv = document.createElement('div');
    badgeDiv.className = 'download-mode-badge badge-chunked';
    badgeDiv.textContent = '⚡ Chunked (preparing)';
    pendingDiv.appendChild(badgeDiv);

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    const progress = document.createElement('div');
    progress.className = 'progress';
    const elapsedSec = Math.max(0, Math.round((Date.now() - (e.startTime || Date.now())) / 1000));
    const hasNumericProgress = typeof e.progressPercent === 'number';
    const pendingPercent = hasNumericProgress
      ? Math.max(1, Math.min(100, Math.round(e.progressPercent)))
      : 100;

    progress.style.width = `${pendingPercent}%`;
    progress.style.opacity = hasNumericProgress ? '0.85' : '0.45';
    if (!hasNumericProgress) progress.classList.add('progress-indeterminate');
    progress.textContent = hasNumericProgress
      ? `${pendingPercent}% (${elapsedSec}s)`
      : `Working... (${elapsedSec}s)`;
    progressBar.appendChild(progress);

    pendingDiv.appendChild(progressBar);
    downloadsListDiv.appendChild(pendingDiv);
  });

  downloads.forEach((download) => {
    const downloadDiv = document.createElement('div');
    downloadDiv.className = 'download-item';

    // File name
    const nameDiv = document.createElement('div');
    nameDiv.className = 'download-name';
    const fileName = download.filename
      ? download.filename.split('/').pop().split('\\').pop()
      : 'Unknown file';
    nameDiv.textContent = fileName;
    downloadDiv.appendChild(nameDiv);

    // Status
    const statusDiv = document.createElement('div');
    statusDiv.className = 'download-status';
    statusDiv.textContent = `Status: ${getDownloadStateText(download.state, download.paused)}`;
    downloadDiv.appendChild(statusDiv);

    // Timestamp
    const timeDiv = document.createElement('div');
    timeDiv.className = 'download-time';
    timeDiv.textContent = formatDownloadTime(download.startTime);
    downloadDiv.appendChild(timeDiv);

    // Download mode badge — shown for every download once mode is known
    const mode = modes[String(download.id)];
    if (mode) {
      const modeBadge = document.createElement('div');
      modeBadge.className = 'download-mode-badge ' + (
        mode === 'chunked'  ? 'badge-chunked'  :
        mode === 'fallback' ? 'badge-fallback' :
        mode === 'browser'  ? 'badge-browser'  : 'badge-normal'
      );
      modeBadge.textContent = getModeBadgeText(mode);
      downloadDiv.appendChild(modeBadge);

      const modeDetail = document.createElement('div');
      modeDetail.className = 'download-mode-detail';
      modeDetail.textContent = getModeDetailText(mode, modeMeta[String(download.id)]);
      downloadDiv.appendChild(modeDetail);
    }

    // Size
    const sizeDiv = document.createElement('div');
    sizeDiv.className = 'download-size';
    const receivedSize = formatFileSize(download.bytesReceived || 0);
    const totalSize = download.totalBytes > 0 ? formatFileSize(download.totalBytes) : 'Unknown';
    sizeDiv.textContent = `${receivedSize} / ${totalSize}`;
    downloadDiv.appendChild(sizeDiv);

    // Progress bar
    const progressPercentage = download.totalBytes > 0
      ? (download.bytesReceived / download.totalBytes) * 100
      : 0;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.style.width = `${progressPercentage}%`;
    progress.textContent = `${Math.round(progressPercentage)}%`;
    progressBar.appendChild(progress);
    downloadDiv.appendChild(progressBar);

    // Controls
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'controls';

    if (download.state === 'in_progress') {
      const pauseResumeButton = document.createElement('button');
      pauseResumeButton.textContent = download.paused ? 'Resume' : 'Pause';
      pauseResumeButton.addEventListener('click', () => {
        if (download.paused) {
          resumeDownload(download.id);
        } else {
          pauseDownload(download.id);
        }
      });
      controlsDiv.appendChild(pauseResumeButton);
    }

    if (download.state !== 'complete') {
      const restartButton = document.createElement('button');
      restartButton.textContent = 'Restart';
      restartButton.addEventListener('click', () => restartDownload(download.id));
      controlsDiv.appendChild(restartButton);
    }

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => deleteDownload(download.id));
    controlsDiv.appendChild(deleteButton);

    if (download.state === 'complete') {
      const openButton = document.createElement('button');
      openButton.textContent = 'Open';
      openButton.style.backgroundColor = '#4caf50';
      openButton.addEventListener('click', () => {
        chrome.downloads.open(download.id);
      });
      controlsDiv.appendChild(openButton);
    }

    downloadDiv.appendChild(controlsDiv);
    downloadsListDiv.appendChild(downloadDiv);
  });

};

// ---------------------------------------------------------------------------
// Download state helpers
// ---------------------------------------------------------------------------

const getDownloadStateText = (state, paused) => {
  if (paused) return 'Paused';
  switch (state) {
    case 'in_progress': return 'Downloading';
    case 'complete':    return 'Complete';
    case 'interrupted': return 'Failed';
    default:            return state || 'Unknown';
  }
};

const pauseDownload = (downloadId) => {
  chrome.downloads.search({ id: downloadId }, ([download]) => {
    if (download && download.state === 'in_progress' && !download.paused) {
      chrome.downloads.pause(downloadId, () => { fetchDownloads(); });
    }
  });
};

const resumeDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: 'RESUME_DOWNLOAD', downloadId }, () => {
    fetchDownloads();
  });
};

const restartDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: 'RESTART_DOWNLOAD', downloadId });
};

const deleteDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: 'DELETE_DOWNLOAD', downloadId });
  setTimeout(fetchDownloads, 500);
};

const startQuickDownload = () => {
  const input = document.getElementById('quick-download-url');
  if (!input) return;

  const url = input.value.trim();
  if (!Utils.isHttpOrHttpsUrl(url)) {
    showMessage('Enter a valid http(s) file URL.', 'error');
    return;
  }

  chrome.runtime.sendMessage({ type: 'START_DOWNLOAD', url }, (response) => {
    if (response && response.success) {
      showMessage('Started download through ChunkFlow.', 'success');
      input.value = '';
      fetchDownloads();
    } else {
      showMessage(`Could not start: ${response?.error || 'Unknown error'}`, 'error');
    }
  });
};

/**
 * Fetch the 50 most-recent downloads from Chrome's downloads API (all time,
 * not just the last hour), then read downloadModes + activeChunkFetches from
 * storage and render the full list — active, paused, completed, and failed.
 *
 * A generation counter discards results from superseded calls so that
 * rapid-fire DOWNLOAD_UPDATE messages never overwrite a fresher render.
 */
let fetchGeneration = 0;

const fetchDownloads = () => {
  const gen = ++fetchGeneration;

  chrome.downloads.search({ orderBy: ['-startTime'], limit: 50 }, (downloads) => {
    if (gen !== fetchGeneration) return; // superseded

    chrome.storage.local.get({ downloadModes: {}, downloadModeMeta: {}, activeChunkFetches: [] }, (data) => {
      if (gen !== fetchGeneration) return; // superseded
      updateDownloadsList(downloads, data.downloadModes, data.activeChunkFetches, data.downloadModeMeta);
    });
  });
};

// ---------------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------------

const handleFileUpload = async () => {
  const serverUrl = document.getElementById('server-url').value.trim();

  if (!selectedFile) {
    showMessage('Please select a file before uploading.', 'error');
    return;
  }
  if (!serverUrl) {
    showMessage('Please enter a server URL.', 'error');
    return;
  }

  try {
    const reader = new FileReader();
    reader.onload = function (e) {
      chrome.runtime.sendMessage({
        type: 'UPLOAD_FILE',
        fileData:  e.target.result,
        fileName:  selectedFile.name,
        fileSize:  selectedFile.size,
        fileType:  selectedFile.type,
        uploadUrl: serverUrl
      }, response => {
        if (response && response.success) {
          showMessage('Upload successful!', 'success');
          displayUploadedFiles();
          clearFileSelection();
        } else {
          showMessage(`Upload failed: ${response?.error || 'Unknown error'}`, 'error');
        }
      });
    };
    reader.readAsArrayBuffer(selectedFile);
  } catch (error) {
    showMessage(`Upload failed: ${error.message}`, 'error');
  }
};

const clearFileSelection = () => {
  selectedFile = null;
  document.getElementById('file-input').value = '';
  document.getElementById('selected-file-name').textContent = '';
  document.getElementById('file-name').textContent = '';
  document.getElementById('file-preview').style.display = 'none';
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const showMessage = (text, type) => {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = text;
  messageDiv.style.cssText = `
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    ${type === 'error'
      ? 'background-color: #ffe6e6; color: #d00; border: 1px solid #ffb3b3;'
      : 'background-color: #e6ffe6; color: #0a0; border: 1px solid #b3ffb3;'}
  `;
  const container = document.querySelector('.tab-content.active');
  container.insertBefore(messageDiv, container.firstChild);
  setTimeout(() => {
    if (messageDiv.parentNode) messageDiv.parentNode.removeChild(messageDiv);
  }, 5000);
};

const displayUploadedFiles = () => {
  chrome.storage.local.get('uploadedFiles', (data) => {
    const uploadedFiles = data.uploadedFiles || [];
    const uploadedFilesList = document.getElementById('uploaded-files-list');
    uploadedFilesList.innerHTML = '';

    if (uploadedFiles.length === 0) {
      uploadedFilesList.innerHTML = '<p>No uploaded files yet.</p>';
      return;
    }

    uploadedFiles.forEach(file => {
      const listItem = document.createElement('div');
      listItem.className = 'uploaded-file-item';

      const name = document.createElement('strong');
      name.textContent = file.name;

      const size = document.createElement('div');
      size.textContent = `Size: ${formatFileSize(file.size)}`;

      const type = document.createElement('div');
      type.textContent = `Type: ${file.type}`;

      const uploaded = document.createElement('div');
      uploaded.textContent = `Uploaded: ${new Date(file.timestamp).toLocaleString()}`;

      listItem.appendChild(name);
      listItem.appendChild(size);
      listItem.appendChild(type);
      listItem.appendChild(uploaded);
      uploadedFilesList.appendChild(listItem);
    });
  });
};

const formatFileSize = Utils.formatFileSize;

// ---------------------------------------------------------------------------
// Chunk count setting
// ---------------------------------------------------------------------------

const loadChunkCount = () => {
  chrome.storage.local.get({ chunkCount: 10 }, (data) => {
    const val = Utils.clampChunkCount(data.chunkCount);
    const input = document.getElementById('chunk-count');
    if (input) input.value = val;
  });
};

const saveChunkCount = (value) => {
  const val = Utils.clampChunkCount(value);
  chrome.storage.local.set({ chunkCount: val }, () => {
    const input = document.getElementById('chunk-count');
    if (input) input.value = val;
  });
};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  loadChunkCount();

  const chunkCountInput = document.getElementById('chunk-count');
  if (chunkCountInput) {
    chunkCountInput.addEventListener('change', () => {
      saveChunkCount(chunkCountInput.value);
    });
  }

  document.getElementById('downloads-tab').addEventListener('click', () => {
    document.getElementById('downloads-section').classList.add('active');
    document.getElementById('uploads-section').classList.remove('active');
    document.getElementById('downloads-tab').classList.add('active');
    document.getElementById('uploads-tab').classList.remove('active');
  });

  document.getElementById('uploads-tab').addEventListener('click', () => {
    document.getElementById('uploads-section').classList.add('active');
    document.getElementById('downloads-section').classList.remove('active');
    document.getElementById('uploads-tab').classList.add('active');
    document.getElementById('downloads-tab').classList.remove('active');
    displayUploadedFiles();
  });

  document.getElementById('select-file-button').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  document.getElementById('file-input').addEventListener('change', (event) => {
    selectedFile = event.target.files[0];
    if (selectedFile) {
      document.getElementById('selected-file-name').textContent = selectedFile.name;
      document.getElementById('file-name').textContent = `Selected File: ${selectedFile.name}`;

      const filePreview = document.getElementById('file-preview');
      if (selectedFile.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          filePreview.src = e.target.result;
          filePreview.style.display = 'block';
        };
        reader.readAsDataURL(selectedFile);
      } else {
        filePreview.style.display = 'none';
      }
    }
  });

  document.getElementById('upload-button').addEventListener('click', handleFileUpload);

  const quickStartButton = document.getElementById('quick-start-button');
  if (quickStartButton) {
    quickStartButton.addEventListener('click', startQuickDownload);
  }

  const quickUrlInput = document.getElementById('quick-download-url');
  if (quickUrlInput) {
    quickUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') startQuickDownload();
    });
  }

  chrome.runtime.sendMessage({ type: 'GET_UPLOADED_FILES' }, response => {
    if (response && response.uploadedFiles) displayUploadedFiles();
  });

  fetchDownloads();
});

// ---------------------------------------------------------------------------
// Port connection to background service worker
// ---------------------------------------------------------------------------

const port = chrome.runtime.connect();

port.onMessage.addListener((message) => {
  if (message.type === 'DOWNLOAD_UPDATE') {
    fetchDownloads();
  } else if (message.type === 'DOWNLOAD_READY') {
    if (message.isChunked) {
      showMessage('Chunked download prepared and handed to Chrome.', 'success');
    }
  } else if (message.type === 'ERROR') {
    showMessage(message.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Adaptive polling — speeds up during active downloads, slows down when idle.
// Both intervals are stored so they can be cleared on popup unload.
// ---------------------------------------------------------------------------

// Start slow (2 s); adjustUpdateFrequency will speed up to 500 ms when needed.
let updateInterval = setInterval(fetchDownloads, 2000);

const adjustUpdateFrequency = () => {
  chrome.downloads.search({ state: 'in_progress' }, (downloads) => {
    clearInterval(updateInterval);
    const frequency = downloads.length > 0 ? 500 : 2000;
    updateInterval = setInterval(fetchDownloads, frequency);
  });
};

const adjustInterval = setInterval(adjustUpdateFrequency, 5000);

window.addEventListener('beforeunload', () => {
  clearInterval(updateInterval);
  clearInterval(adjustInterval);
});
