
console.log("Content script loaded.");

const handleDownloadClick = (event) => {
  const downloadUrl = event.target.href;
  
  if (!downloadUrl || !Utils.validateUrl(downloadUrl)) {
    console.warn("Invalid download URL:", downloadUrl);
    return;
  }
  
  console.log("Download link clicked:", downloadUrl);
  
  event.preventDefault();
  chrome.runtime.sendMessage({ type: "START_DOWNLOAD", url: downloadUrl }, (response) => {
    console.log("Download initiated via extension");
  });
};

const isDownloadLink = (element) => {
  if (!element.href) return false;
  
  if (element.hasAttribute('download')) return true;
  
  const url = element.href.toLowerCase();
  const downloadExtensions = [
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.wmv',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg',
    '.exe', '.msi', '.deb', '.rpm', '.dmg', '.pkg',
    '.iso', '.img', '.bin'
  ];
  
  return downloadExtensions.some(ext => url.includes(ext));
};

const attachDownloadHandlers = () => {
  const allLinks = document.querySelectorAll('a:not([data-handler-attached])');
  const downloadLinks = Array.from(allLinks).filter(isDownloadLink);
  
  console.log("Found new download links:", downloadLinks.length);
  
  downloadLinks.forEach(link => {
    link.addEventListener('click', handleDownloadClick);
    link.setAttribute('data-handler-attached', 'true');
  });
};

attachDownloadHandlers();

const observer = new MutationObserver((mutations) => {
  let shouldCheck = false;
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches('a') || node.querySelector('a')) {
            shouldCheck = true;
          }
        }
      });
    }
  });
  
  if (shouldCheck) {
    setTimeout(attachDownloadHandlers, 100);
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTEXT_MENU_DOWNLOAD') {
    const downloadUrl = message.url;
    if (Utils.validateUrl(downloadUrl)) {
      chrome.runtime.sendMessage({ type: "START_DOWNLOAD", url: downloadUrl });
    } else {
      console.error("Invalid URL for context menu download:", downloadUrl);
    }
  }
});
