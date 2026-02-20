
console.log("Content script loaded.");

const handleDownloadClick = (event) => {
  // Use currentTarget (the <a> the handler is on), not target (which may be a child element).
  const downloadUrl = event.currentTarget.href;
  
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

// Debounce so rapid DOM mutations on heavy SPAs (e.g. Google Drive) don't
// queue hundreds of back-to-back attachDownloadHandlers calls.
const debouncedAttachHandlers = Utils.debounce(attachDownloadHandlers, 200);

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
    debouncedAttachHandlers();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

