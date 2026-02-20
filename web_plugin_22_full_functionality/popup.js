let selectedFile = null;

// ---------------------------------------------------------------------------
// Download list rendering
// ---------------------------------------------------------------------------

/**
 * Render the downloads list.
 * modes — object from chrome.storage.local 'downloadModes', keyed by string download ID.
 *   Values: 'chunked' | 'normal' | 'fallback'
 */
const updateDownloadsList = (downloads, modes = {}) => {
  const downloadsListDiv = document.getElementById('downloads-list');
  downloadsListDiv.innerHTML = '';

  if (downloads.length === 0) {
    downloadsListDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No active downloads</p>';
    return;
  }

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

    // Download mode badge (chunked / normal / fallback) — only shown if mode is known
    const mode = modes[String(download.id)];
    if (mode) {
      const modeBadge = document.createElement('div');
      modeBadge.className = 'download-mode-badge ' + (
        mode === 'chunked'  ? 'badge-chunked'  :
        mode === 'fallback' ? 'badge-fallback' : 'badge-normal'
      );
      modeBadge.textContent =
        mode === 'chunked'  ? '⚡ Chunked'  :
        mode === 'fallback' ? '⚠ Fallback' : '↓ Normal';
      downloadDiv.appendChild(modeBadge);
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

/**
 * Fetch recent downloads (last hour) from Chrome's downloads API,
 * then read downloadModes from storage and render the list with mode badges.
 */
const fetchDownloads = () => {
  chrome.downloads.search({}, (downloads) => {
    const hourAgo = Date.now() - (60 * 60 * 1000);
    const recentDownloads = downloads.filter(d =>
      d.startTime && new Date(d.startTime).getTime() > hourAgo
    );
    chrome.storage.local.get({ downloadModes: {} }, (data) => {
      updateDownloadsList(recentDownloads, data.downloadModes);
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
          storeUploadedFile(selectedFile);
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

const storeUploadedFile = (file) => {
  chrome.storage.local.get('uploadedFiles', (data) => {
    const uploadedFiles = data.uploadedFiles || [];
    uploadedFiles.push({ name: file.name, size: file.size, type: file.type, timestamp: Date.now() });
    chrome.storage.local.set({ uploadedFiles }, () => {
      displayUploadedFiles();
    });
  });
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
      listItem.innerHTML = `
        <strong>${file.name}</strong><br>
        Size: ${formatFileSize(file.size)}<br>
        Type: ${file.type}<br>
        Uploaded: ${new Date(file.timestamp).toLocaleString()}
      `;
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
    const downloadLink = document.createElement('a');
    downloadLink.href = message.url;
    downloadLink.textContent = 'Download Merged File';
    downloadLink.download = message.filename || 'downloaded_file';
    downloadLink.style.cssText = 'display: block; margin: 10px 0; padding: 8px; background: #4caf50; color: white; text-decoration: none; border-radius: 4px; text-align: center;';

    const downloadsSection = document.getElementById('downloads-section');
    downloadsSection.insertBefore(downloadLink, downloadsSection.firstChild);

    if (message.isChunked) {
      const chunkedLabel = document.createElement('span');
      chunkedLabel.textContent = ' (Chunked Download)';
      chunkedLabel.style.color = 'blue';
      chunkedLabel.style.fontWeight = 'bold';
      downloadLink.appendChild(chunkedLabel);
    }

    setTimeout(() => {
      if (downloadLink.parentNode) downloadLink.parentNode.removeChild(downloadLink);
    }, 30000);
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
