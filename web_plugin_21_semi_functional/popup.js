

    document.addEventListener("DOMContentLoaded", function() {
    displayUploadedFiles();
    
// Functions and Logic from the new popup.js
const updateDownloadsList = (downloads) => {
  const downloadsListDiv = document.getElementById('downloads-list');
  downloadsListDiv.innerHTML = '';

  downloads.forEach((download) => {
    const downloadDiv = document.createElement('div');
    downloadDiv.className = 'download-item';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'download-name';
    const fileName = download.filename.split('/').pop().split('\\').pop();
    nameDiv.textContent = fileName;
    downloadDiv.appendChild(nameDiv);

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'controls';

    const pauseResumeButton = document.createElement('button');
    pauseResumeButton.textContent = download.paused ? "Resume" : "Pause";
    pauseResumeButton.addEventListener('click', () => {
      if (download.paused) {
        resumeDownload(download.id);
      } else {
        pauseDownload(download.id);
      }
      pauseResumeButton.textContent = download.paused ? "Pause" : "Resume";
    });
    controlsDiv.appendChild(pauseResumeButton);

    // ... other controls ...

    const deleteButton = document.createElement('button');
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener('click', () => deleteDownload(download.id));
    controlsDiv.appendChild(deleteButton);

    
    const restartButton = document.createElement('button');
    restartButton.textContent = "Restart";
    restartButton.addEventListener('click', () => restartDownload(download.id));
    controlsDiv.appendChild(restartButton);

    downloadDiv.appendChild(controlsDiv);

    // Calculate the progress percentage
    const progressPercentage = download.totalBytes > 0 ? (download.bytesReceived / download.totalBytes) * 100 : 0;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';

    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.style.width = `${progressPercentage}%`;
    progress.textContent = `${Math.round(progressPercentage)}%`;
    progressBar.appendChild(progress);

    downloadDiv.appendChild(progressBar);

    downloadsListDiv.appendChild(downloadDiv);
    // Additional features from modified popup.js
    const progressDiv = document.createElement('div');
    progressDiv.className = 'download-progress';
    progressDiv.textContent = `Progress: ${download.progress}%`;

    const chunkedDiv = document.createElement('div');
    chunkedDiv.className = 'download-chunked';
    chunkedDiv.textContent = `Chunked: ${download.isChunked ? 'Yes' : 'No'}`;

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'download-actions';

    const pauseButton = document.createElement('button');
    pauseButton.textContent = 'Pause';
    pauseButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "PAUSE_DOWNLOAD", downloadId: download.id });
    });

    const resumeButton = document.createElement('button');
    resumeButton.textContent = 'Resume';
    resumeButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "RESUME_DOWNLOAD", downloadId: download.id });
    });

    actionsDiv.appendChild(pauseButton);
    actionsDiv.appendChild(resumeButton);
    actionsDiv.appendChild(restartButton);
    actionsDiv.appendChild(deleteButton);

    downloadDiv.appendChild(progressDiv);
    downloadDiv.appendChild(chunkedDiv);
    downloadDiv.appendChild(actionsDiv);


    // ... rest of the code ...
  });
};


// Function to pause a download
const pauseDownload = (downloadId) => {
  chrome.downloads.search({ id: downloadId }, ([download]) => {
    if (download.state === 'in_progress' && !download.paused) {
      chrome.downloads.pause(downloadId, fetchDownloads);
    }
  });
};


// Function to restart a download
const restartDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: "RESTART_DOWNLOAD", downloadId });
};


// Function to delete a download
const deleteDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: "DELETE_DOWNLOAD", downloadId });
  fetchDownloads();
};

// Function to resume a download
const resumeDownload = (downloadId) => {
  chrome.runtime.sendMessage({ type: "RESUME_DOWNLOAD", downloadId }, fetchDownloads);
};



// Function to fetch current downloads from Chrome's download manager
const fetchDownloads = () => {
  chrome.downloads.search({}, (downloads) => {
    updateDownloadsList(downloads);
    //updateDownloadsList(downloads.filter(download => download.state !== 'complete'));
  });
};

// Connect to the background script
const port = chrome.runtime.connect();

// Listen for download updates from the background script
port.onMessage.addListener((message) => {
  if (message.type === "DOWNLOAD_UPDATE") {
    fetchDownloads();
  }
});


// Fetch current downloads on popup load
fetchDownloads();
//<all_urls>
        //https://file-examples.com/*

// Function to continuously update the downloads list
const updateInterval = setInterval(fetchDownloads, 1000);


port.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_READY') {
        const downloadLink = document.createElement('a');
        downloadLink.href = message.url;
        downloadLink.textContent = 'Download Merged File';
        downloadLink.download = 'downloaded_file';  // You can provide a better name based on the file's original name
        document.body.appendChild(downloadLink);

        // Add visual indication for chunked downloads
        if (message.isChunked) {
          const chunkedLabel = document.createElement('span');
          chunkedLabel.textContent = " (Chunked)";
          chunkedLabel.style.color = 'blue'; // Optional: Style the label as you prefer
          document.body.appendChild(chunkedLabel);
        }
    } else if (message.type === 'ERROR') {
        const errorMessage = document.createElement('p');
        errorMessage.textContent = message.message;
        errorMessage.style.color = 'red';
        document.body.appendChild(errorMessage);
    }
});

// Upload functionality
document.getElementById("upload-button").addEventListener("click", () => {
  //document.getElementById("file-input").click();
});

document.getElementById("file-input").addEventListener("change", (event) => {
  const selectedFile = event.target.files[0];
  if (selectedFile) {
    console.log("Selected file:", selectedFile.name);
    // TODO: Add more logic here to handle the selected file
  }
});

// Function to handle the file upload
let handleFileUpload = async () => {
    const fileInput = document.getElementById("file-input");
    const serverUrl = document.getElementById("server-url").value;
    const selectedFile = fileInput.files[0];

    if (selectedFile && serverUrl) {
        const formData = new FormData();
        formData.append("file", selectedFile);

        try {
            const response = await fetch(serverUrl, {
                method: "POST",
                body: formData
            });

            const result = await response.json();

            // Handle the server's response (e.g., show a success message)
            console.log(result);

        } catch (error) {
            // Handle errors (e.g., show an error message)
            console.error("File upload failed:", error);
        }
    } else {
        console.error("Please select a file and enter a valid server URL.");
    }
};

document.getElementById("upload-button").addEventListener("click", handleFileUpload);
document.getElementById("file-input").addEventListener("change", function() {
    const fileInput = this;
    const selectedFile = fileInput.files[0];

    if (selectedFile) {
        // Displaying the file name
        document.getElementById("file-name").textContent = "Selected File: " + selectedFile.name;

        // Checking if the file is an image and displaying a preview
        if (selectedFile.type && selectedFile.type.startsWith("image/")) {
            const filePreview = document.getElementById("file-preview");
            filePreview.style.display = "block";
            filePreview.src = URL.createObjectURL(selectedFile);
        } else {
            document.getElementById("file-preview").style.display = "none";
        }
    }
});

document.getElementById("upload-button").addEventListener("click", handleFileUpload);

// Logic for file preview and metadata display
document.getElementById("file-input").addEventListener("change", function() {
    const fileInput = this;
    const selectedFile = fileInput.files[0];

    if (selectedFile) {
        // Displaying the file name
        document.getElementById("file-name").textContent = "Selected File: " + selectedFile.name;

        // Checking if the file is an image and displaying a preview
        if (selectedFile.type && selectedFile.type.startsWith("image/")) {
            const filePreview = document.getElementById("file-preview");
            filePreview.style.display = "block";
            filePreview.src = URL.createObjectURL(selectedFile);
        } else {
            document.getElementById("file-preview").style.display = "none";
        }
    }
});

// Functions and Logic from the earlier modifications
document.getElementById("downloads-tab").addEventListener("click", function() {
    document.getElementById("downloads-section").classList.add("active");
    document.getElementById("uploads-section").classList.remove("active");
    this.classList.add("active");
    document.getElementById("uploads-tab").classList.remove("active");
});

document.getElementById("uploads-tab").addEventListener("click", function() {
    document.getElementById("uploads-section").classList.add("active");
    document.getElementById("downloads-section").classList.remove("active");
    this.classList.add("active");
    document.getElementById("downloads-tab").classList.remove("active");
    displayUploadedFiles();
});

// Existing logic for updating the downloads list, handling file upload, and file preview and metadata display...
// ... (this part remains unchanged)

function displayUploadedFiles() {
    chrome.storage.local.get("uploadedFiles", function(data) {
        const uploadedFiles = data.uploadedFiles || [];
        const uploadedFilesList = document.getElementById("uploaded-files-list");
        uploadedFilesList.innerHTML = '';  // Clear the list before populating
        
        uploadedFiles.forEach(file => {
            const listItem = document.createElement("li");
            listItem.textContent = file.name;
            uploadedFilesList.appendChild(listItem);
        });
    });
}

        uploadsSection.appendChild(uploadedFilesDiv);
    
//to save the uploaded file details to storage after a successful upload
let originalHandleFileUpload = handleFileUpload;
handleFileUpload = async function() {
    const result = await originalHandleFileUpload();
    if (result && result.success) {
        const fileInput = document.getElementById("file-input");
        const selectedFile = fileInput.files[0];
        chrome.storage.local.get("uploadedFiles", function(data) {
            const uploadedFiles = data.uploadedFiles || [];
            uploadedFiles.push({ name: selectedFile.name, size: selectedFile.size, type: selectedFile.type });
            chrome.storage.local.set({ uploadedFiles: uploadedFiles });
        });
    }
}




// Modified handleFileUpload function to just handle the upload
let selectedFile;
document.getElementById("file-input").addEventListener("change", function() {
    selectedFile = this.files[0];
    // You can add additional logic here if needed, like displaying the selected file name
});

// Adjusting the handleFileUpload function

handleFileUpload = async function() {
    if (!selectedFile) {
        alert("Please select a file before uploading.");
        return;
    }
    // Rest of the upload logic remains unchanged
    originalHandleFileUpload();
};

});

document.getElementById('upload-button').addEventListener('click', function() {
    const selectedFile = document.getElementById('file-input').files[0];
    const uploadUrl = document.getElementById('server-url').value;
    if (selectedFile && uploadUrl) {
        chrome.runtime.sendMessage({
            type: "UPLOAD_FILE",
            file: selectedFile,  // This assumes the file object can be sent as a message, which might not be possible due to limitations in the messaging API. A workaround might be needed.
            uploadUrl: uploadUrl
        }, response => {
            if (response.success) {
                console.log('Upload successful');
            } else {
                console.error('Upload failed:', response.error);
            }
        });
    } else {
        console.error('File not selected or upload URL not provided');
    }
});

// File selection logic
document.getElementById('select-file-button').addEventListener('click', function() {
    document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', function() {
    const selectedFile = document.getElementById('file-input').files[0];
    if (selectedFile) {
        document.getElementById('selected-file-name').textContent = selectedFile.name;

        // Display a preview if the selected file is an image
        const filePreview = document.getElementById('file-preview');
        if (selectedFile.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                filePreview.src = e.target.result;
                filePreview.style.display = 'block';
            }
            reader.readAsDataURL(selectedFile);
        } else {
            filePreview.style.display = 'none';
        }
    }
});

