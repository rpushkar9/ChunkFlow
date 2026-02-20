importScripts('utils.js');

let uploadedFiles = [];
let popupPort = null;

chrome.runtime.onConnect.addListener((port) => {
  popupPort = port;
  port.onDisconnect.addListener(() => {
    popupPort = null;
  });
});

function downloadInChunks(url, numberOfChunks = 10) {
  console.log(`[ChunkFlow] downloadInChunks: ${numberOfChunks} chunks for ${url}`);
  return fetch(url, { method: 'HEAD' })
    .then(response => {
      console.log('Checking for range header support');
      
      if (response.headers.get('Accept-Ranges') !== 'bytes') {
        console.log('Server does not support range requests, falling back to normal download');
        chrome.downloads.download({ 
          url: url, 
          filename: new URL(url).pathname.split("/").pop() || "downloaded_file" 
        });
        return null;
      }

      const fileSize = parseInt(response.headers.get('Content-Length'));
      const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';
      
      if (!fileSize || fileSize <= 0) {
        throw new Error('Invalid or missing Content-Length header');
      }
      
      return { fileSize, mimeType };
    })
    .then((result) => {
      if (!result) return null;
      
      const { fileSize, mimeType } = result;
      const chunkSize = Math.ceil(fileSize / numberOfChunks);
      const chunkPromises = [];
      
      for (let i = 0; i < numberOfChunks; i++) {
        const start = i * chunkSize;
        const end = i === numberOfChunks - 1 ? fileSize - 1 : (start + chunkSize - 1);
        
        chunkPromises.push(
          fetch(url, { 
            headers: { Range: `bytes=${start}-${end}` } 
          })
          .then(response => {
            if (!response.ok) {
              throw new Error(`Failed to fetch chunk ${i}: ${response.status}`);
            }
            return response.arrayBuffer();
          })
        );
      }
      
      return Promise.all(chunkPromises)
        .then(chunks => {
          const mergedChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0));
          let offset = 0;
          chunks.forEach(chunk => {
            mergedChunks.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          });
          
          const mergedBlob = new Blob([mergedChunks], { type: mimeType });
          const objectURL = URL.createObjectURL(mergedBlob);
          const filename = new URL(url).pathname.split("/").pop() || "downloaded_file";
          
          chrome.downloads.download({
            url: objectURL,
            filename: filename
          });

          if (popupPort) {
            popupPort.postMessage({
              type: 'DOWNLOAD_READY',
              url: objectURL,
              filename: filename,
              isChunked: true
            });
          }
          
          return mergedBlob;
        });
    })
    .catch(error => {
      console.error('Download error:', error);
      if (popupPort) {
        popupPort.postMessage({ 
          type: 'ERROR', 
          message: `Download failed: ${error.message}` 
        });
      }
      
      console.log('Falling back to normal download due to error');
      chrome.downloads.download({ 
        url: url, 
        filename: new URL(url).pathname.split("/").pop() || "downloaded_file" 
      });
    });
}

function checkServerSupport(uploadUrl) {
  return fetch(uploadUrl, { method: 'HEAD' })
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

  return fetch(uploadUrl, {
    method: 'POST',
    body: formData
  })
  .then(response => {
    if (response.ok) {
      return response.text();
    } else {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }
  });
}

function uploadInChunks(fileData, fileName, uploadUrl, numberOfChunks = 10) {
  const fileSize = fileData.byteLength;
  const chunkSize = Math.ceil(fileSize / numberOfChunks);
  const chunkPromises = [];
  
  for (let i = 0; i < numberOfChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
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
    
    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Failed to upload chunk: ${xhr.status} ${xhr.statusText}`));
      }
    };
    
    xhr.onerror = function() {
      reject(new Error('Network error during chunk upload'));
    };
    
    xhr.upload.onprogress = function(event) {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        console.log(`Chunk ${start}-${end} progress: ${Math.round(progress)}%`);
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
  chrome.storage.local.get("uploadedFiles", (data) => {
    const uploadedFiles = data.uploadedFiles || [];
    uploadedFiles.push({ 
      name: fileName, 
      size: fileSize, 
      type: fileType,
      timestamp: Date.now()
    });
    chrome.storage.local.set({ uploadedFiles }, () => {
      console.log("Uploaded file details stored successfully.");
    });
  });
}

function getChunkCount(callback) {
  chrome.storage.local.get({ chunkCount: 10 }, (data) => {
    const count = Utils.clampChunkCount(data.chunkCount);
    console.log(`[ChunkFlow] getChunkCount: resolved to ${count}`);
    callback(count);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "START_DOWNLOAD":
      console.log("Starting download for URL:", message.url);
      getChunkCount((count) => {
        downloadInChunks(message.url, count);
        sendResponse({ success: true });
      });
      return true;

    case "DELETE_DOWNLOAD":
      chrome.downloads.removeFile(message.downloadId, () => {
        chrome.downloads.erase({ id: message.downloadId }, () => {
          console.log(`Deleted download with ID ${message.downloadId}`);
        });
      });
      break;

    case "PAUSE_DOWNLOAD":
      chrome.downloads.pause(message.downloadId, () => {
        console.log(`Paused download with ID ${message.downloadId}`);
      });
      break;

    case "RESUME_DOWNLOAD":
      chrome.downloads.resume(message.downloadId, () => {
        console.log(`Resumed download with ID ${message.downloadId}`);
      });
      break;

    case "RESTART_DOWNLOAD":
      chrome.downloads.search({ id: message.downloadId }, ([download]) => {
        if (download) {
          const originalUrl = download.finalUrl || download.url;
          console.log("Retrieving URL for restart. Download ID:", message.downloadId, "URL:", originalUrl);
          if (originalUrl) {
            chrome.downloads.cancel(message.downloadId, () => {
              chrome.downloads.download({ url: originalUrl }, (newDownloadId) => {
                console.log("Restarted download with ID:", newDownloadId, "URL:", originalUrl);
              });
            });
          } else {
            console.log("Could not restart download with ID", message.downloadId, ": URL not found.");
          }
        }
      });
      break;

    case "UPLOAD_FILE":
      if (!message.fileData || !message.fileName || !message.uploadUrl) {
        sendResponse({ success: false, error: "Missing required upload data" });
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
      console.log("Unknown message type:", message.type);
      break;
  }
});

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (popupPort) {
    popupPort.postMessage({ type: "DOWNLOAD_UPDATE" });
  }
});

chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log("Download created:", downloadItem.id);
  if (popupPort) {
    popupPort.postMessage({ type: "DOWNLOAD_UPDATE" });
  }
});

chrome.downloads.onErased.addListener((downloadId) => {
  console.log("Download erased:", downloadId);
  if (popupPort) {
    popupPort.postMessage({ type: "DOWNLOAD_UPDATE" });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "download-with-chunks",
    title: "Download with ChunkFlow",
    contexts: ["link"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "download-with-chunks" && info.linkUrl) {
    console.log("Context menu download:", info.linkUrl);
    getChunkCount((count) => {
      downloadInChunks(info.linkUrl, count);
    });
  }
});