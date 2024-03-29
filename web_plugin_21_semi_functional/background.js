function downloadInChunks(url, numberOfChunks = 10) {
  // Step 1: Fetch file size
  return fetch(url, { method: 'HEAD' })
    .then(response => {
      console.log('Checking for range header support');
      if (response.headers.get('Accept-Ranges') !== 'bytes') {
        
// If the server does not support range requests, initiate a regular download.
chrome.downloads.download({ url: url, filename: new URL(url).pathname.split("/").pop() || "downloaded_file" });
return;

      }
        const fileSize = response.headers.get('Content-Length');
        const mimeType = response.headers.get('Content-Type');
        return { fileSize, mimeType };
    })
    .then(({fileSize, mimeType }) => {
      // Step 2: Download chunks in parallel
      const chunkSize = Math.ceil(fileSize / numberOfChunks);
      const chunkPromises = [];
      for (let i = 0; i < numberOfChunks; i++) {
        const start = i * chunkSize;
        const end = i === numberOfChunks - 1 ? '' : (start + chunkSize - 1);
        chunkPromises.push(
          fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
            .then(response => response.arrayBuffer())
        );
      }
      return Promise.all(chunkPromises);
    })
    .then(chunks => {
      // Step 3: Merge chunks
      const mergedChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0));
      let offset = 0;
      chunks.forEach(chunk => {
        mergedChunks.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      });
      return mergedChunks;
    })
    .then(mergedFile => {
      // Step 4: Provide the file to the user (modify this part as needed)
      const mergedBlob = new Blob([mergedFile], { type: mimeType });
      const objectURL = URL.createObjectURL(mergedBlob);
      chrome.downloads.download({
          url: objectURL,
          filename: new URL(url).pathname.split("/").pop() || "downloaded_file" // Modify this as needed
    });

    
    })
    
    
.catch(error => {
    console.error('An error occurred:', error);
    if (popupPort) {
        popupPort.postMessage({ type: 'ERROR', message: error.message });
    }


        console.error('An error occurred:', error);
        if (popupPort) {
        // Logic for chunked downloads
        let downloadedChunks = 0;
        let numberOfChunks = Math.ceil(fileSize / chunkSize);

        // Create an array to hold the fetched chunks
        let chunksArray = new Array(numberOfChunks);

        // Download each chunk
        for (let i = 0; i < numberOfChunks; i++) {
          const startRange = i * chunkSize;
          const endRange = Math.min(fileSize, (i + 1) * chunkSize) - 1;

          fetch(url, { headers: { 'Range': `bytes=${startRange}-${endRange}` } })
            .then(response => response.arrayBuffer())
            .then(chunk => {
              chunksArray[i] = chunk;
              downloadedChunks++;

              // Update download progress
              const progress = (downloadedChunks / numberOfChunks) * 100;
              if (popupPort) {
                console.log('Sending message to popup');
                popupPort.postMessage({
                  type: 'UPDATE_PROGRESS',
                  progress: progress
                });
              }

              // If all chunks are downloaded, merge and create a Blob
              if (downloadedChunks === numberOfChunks) {
                const mergedFile = new Uint8Array(fileSize);
                let offset = 0;

                for (const chunk of chunksArray) {
                  mergedFile.set(new Uint8Array(chunk), offset);
                  offset += chunk.byteLength;
                }

                const mergedBlob = new Blob([mergedFile], { type: mimeType });
                const objectURL = URL.createObjectURL(mergedBlob);

                // Notify the popup that the download is ready
                if (popupPort) {
                  console.log('Sending message to popup');
                  popupPort.postMessage({
                    type: 'DOWNLOAD_READY',
                    url: objectURL,
                    isChunked: true
                  });
                }
              }
            });
        }

        console.log('Sending message to popup');
        popupPort.postMessage({
          type: 'DOWNLOAD_READY',
          url: objectURL,
          isChunked: true
        });

            console.log('Sending message to popup');
            popupPort.postMessage({
                type: 'ERROR',
                message: 'Failed to download the file in chunks.'
            });
         }
    });
  }
   

const downloadUrls = {}; // Object to store download URLs

let popupPort = null;

chrome.runtime.onConnect.addListener((port) => {
  popupPort = port;
  port.onDisconnect.addListener(() => {
    popupPort = null;
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case "START_DOWNLOAD":
      console.log("Starting parallel download for URL:", message.url);
      downloadInChunks(message.url); // Call the downloadInChunks function
      break;

    case "DELETE_DOWNLOAD":
      chrome.downloads.removeFile(message.downloadId, () => {
        chrome.downloads.erase({ id: message.downloadId }, () => {
          console.log('Deleted download with ID ${message.downloadId}');
        });
      });
      break;

    case "PAUSE_DOWNLOAD":
      const pauseDownloadId = message.downloadId;
      chrome.downloads.pause(pauseDownloadId, () => {
        console.log('Paused download with ID ${pauseDownloadId}');
      });
      break;

    case "RESUME_DOWNLOAD":
      const resumeDownloadId = message.downloadId;
      chrome.downloads.resume(resumeDownloadId, () => {
        console.log('Resumed download with ID ${resumeDownloadId}');
      });
      break;

    case "RESTART_DOWNLOAD":
      const downloadId = message.downloadId;
      chrome.downloads.search({ id: downloadId }, ([download]) => {
        if (download) {
          const originalUrl = download.finalUrl || download.url;
          console.log("Retrieving URL for restart. Download ID:", downloadId, "URL:", originalUrl);
          if (originalUrl) {
            chrome.downloads.cancel(downloadId, () => {
              chrome.downloads.download({ url: originalUrl }, (newDownloadId) => {
                console.log("Restarted download with ID:", newDownloadId, "URL:", originalUrl);
              });
            });
          } else {
            console.log("Could not restart download with ID", downloadId, ": URL not found.");
          }
        }
      });
      break;

    default:
      console.log("Unknown message type:", message.type);
      break;
  }
});


function checkServerSupport(uploadUrl) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', uploadUrl, true);
        
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (xhr.getResponseHeader('Accept-Ranges') === 'bytes') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            } else {
                reject(new Error('Failed to check server support: ' + xhr.status));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Failed to check server support due to a network error.'));
        };
        
        xhr.send();
    });
}

function handleUpload(file, uploadUrl, numberOfChunks = 10) {
    return checkServerSupport(uploadUrl).then(isSupported => {
        if (isSupported) {
            return uploadInChunks(file, uploadUrl, numberOfChunks);
        } else {
            return uploadFileNormally(file, uploadUrl);
        }
    });
}

function uploadFileNormally(file, uploadUrl) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
            } else {
                reject(new Error('Failed to upload file: ' + xhr.status));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Failed to upload file due to a network error.'));
        };
        
        xhr.upload.onprogress = function(event) {
            if (event.lengthComputable) {
                const progress = (event.loaded / event.total) * 100;
                console.log('Upload progress:', progress + '%');
            }
        };
        
        xhr.send(file);
    });
}



function uploadInChunks(file, uploadUrl, numberOfChunks = 10) {
    const fileSize = file.size;
    const chunkSize = Math.ceil(fileSize / numberOfChunks);
    const chunkPromises = [];
    
    for (let i = 0; i < numberOfChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);
        const blobChunk = file.slice(start, end);

        chunkPromises.push(uploadChunk(blobChunk, uploadUrl, start, end));
    }
    
    return Promise.all(chunkPromises);
}

function uploadChunk(blobChunk, uploadUrl, start, end) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        xhr.setRequestHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + blobChunk.size);
        
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
            } else {
                reject(new Error('Failed to upload chunk: ' + xhr.status));
            }
        };
        
        xhr.onerror = function() {
            reject(new Error('Failed to upload chunk due to a network error.'));
        };
        
        xhr.upload.onprogress = function(event) {
            if (event.lengthComputable) {
                const progress = (event.loaded / event.total) * 100;
                console.log('Chunk progress:', progress + '%');
            }
        };
        
        xhr.send(blobChunk);
    });
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "UPLOAD_FILE") {
        const file = message.file;  // This assumes the file object can be sent as a message, which might not be possible due to limitations in the messaging API. A workaround might be needed.
        const uploadUrl = message.uploadUrl;
        handleUpload(file, uploadUrl)
            .then(response => {
                console.log('Upload successful:', response);
                storeUploadedFileDetails(file);  // Store the uploaded file details
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('Upload failed:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;  // Indicates the response will be sent asynchronously.
    }
});



 // Store details of the uploaded file into chrome.storage.local
 function storeUploadedFileDetails(file) {
  chrome.storage.local.get("uploadedFiles", function(data) {
      const uploadedFiles = data.uploadedFiles || [];
      uploadedFiles.push({ name: file.name, size: file.size, type: file.type });
      chrome.storage.local.set({ "uploadedFiles": uploadedFiles });
      chrome.storage.local.set({ "uploadedFiles": uploadedFiles }, function() {
        if (chrome.runtime.lastError) {
            console.error("Error storing uploaded files:", chrome.runtime.lastError);
        } else {
            console.log("Uploaded file details stored successfully.");
        }
    });
    
  });
}