
console.log("Content script loaded.");

const handleDownloadClick = (event) => {
  event.preventDefault(); // Prevent the default action
  const downloadUrl = event.target.href;
  console.log("Download link clicked:", downloadUrl);
  chrome.runtime.sendMessage({ type: "START_DOWNLOAD", url: downloadUrl });
};

// Select all download links with 'download' attribute to make it more generic
const downloadLinks = document.querySelectorAll('a[download]');

console.log("Found download links:", downloadLinks.length);

// Add click event listener to all found download links
downloadLinks.forEach(link => {
  link.addEventListener('click', handleDownloadClick);
});

// Optional: Adding context menu support for starting downloads
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTEXT_MENU_DOWNLOAD') {
    const downloadUrl = message.url;
    chrome.runtime.sendMessage({ type: "START_DOWNLOAD", url: downloadUrl });
  }
});
