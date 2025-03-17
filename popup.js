document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI with saved settings
  chrome.storage.local.get(['excludeGoogle', 'customDomains'], (data) => {
    document.getElementById('excludeGoogle').checked = data.excludeGoogle !== false;
    document.getElementById('customDomains').value = data.customDomains || '';
  });
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  const resultsDiv = document.getElementById('results');
  const loading = document.getElementById('loading');
  const actionButtons = document.getElementById('actionButtons');
  const resultCount = document.getElementById('resultCount');
  
  // Reset UI state
  resultsDiv.style.display = 'none';
  actionButtons.style.display = 'none';
  loading.style.display = 'block';
  resultCount.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('No active tab found');

    const currentUrl = new URL(tab.url);
    const filters = {
      excludeGoogle: document.getElementById('excludeGoogle').checked,
      excludeInternal: document.getElementById('excludeInternal').checked,
      onlySearch: document.getElementById('onlySearch').checked,
      customDomains: document.getElementById('customDomains').value
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(d => d)
    };

    // Save settings with error handling
    try {
      await chrome.storage.local.set({
        excludeGoogle: filters.excludeGoogle,
        customDomains: document.getElementById('customDomains').value
      });
    } catch (storageError) {
      console.error('Settings save failed:', storageError);
    }

    // Execute content script with error handling
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractUrls,
      args: [filters, currentUrl.hostname]
    });

    if (!result?.result) throw new Error('No URLs found matching criteria');
    
    const urls = result.result;
    displayResults(urls);
    resultCount.textContent = `${urls.length} URLs found`;
    setupActionButtons(urls);
  } catch (error) {
    showStatusMessage(error.message || 'An error occurred', true);
  } finally {
    loading.style.display = 'none';
  }
});

/**
 * Display results in the UI with virtualization
 * @param {string[]} urls - Array of filtered URLs
 */
function displayResults(urls) {
  const resultsDiv = document.getElementById('results');
  resultsDiv.innerHTML = urls.length > 0 
    ? urls.map(url => `
      <div class="url-item">
        <span class="url-text">${url}</span>
      </div>
    `).join('')
    : '<div class="loading">No matching URLs found</div>';
  
  resultsDiv.style.display = 'block';
}

/**
 * Set up action buttons with click handlers
 * @param {string[]} urls - Array of URLs to handle
 */
function setupActionButtons(urls) {
  const actionButtons = document.getElementById('actionButtons');
  if (urls.length === 0) return;

  actionButtons.style.display = 'flex';
  
  // Copy button handler
  document.getElementById('copyBtn').onclick = async () => {
    try {
      await copyToClipboard(urls.join('\n'));
      showStatusMessage(`${urls.length} URLs copied to clipboard!`);
    } catch (error) {
      showStatusMessage('Failed to copy URLs', true);
    }
  };

  // Save button handler
  document.getElementById('saveBtn').onclick = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const blob = new Blob([urls.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url,
        filename: `urls-${timestamp}.txt`,
        saveAs: true
      });

      // Revoke object URL after delay
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      showStatusMessage('Failed to save URLs', true);
    }
  };
}

/**
 * Copy text to clipboard using modern API
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Show status message to user
 * @param {string} message - Message to display
 * @param {boolean} isError - Whether it's an error message
 */
function showStatusMessage(message, isError = false) {
  const status = document.createElement('div');
  status.className = `status-message ${isError ? 'error' : 'success'}`;
  status.textContent = message;
  
  document.body.appendChild(status);
  setTimeout(() => status.remove(), 3000);
}

/**
 * URL extraction logic with improved filtering
 * @param {Object} filters - Active filters
 * @param {string} currentHostname - Current page hostname
 */
function extractUrls(filters, currentHostname) {
  const links = Array.from(document.links);
  const seen = new Set();
  const filteredUrls = [];

  // Pre-compiled regex patterns
  const googlePattern = /\.?google\.(com|co\.[a-z]{2}|ca|com\.[a-z]{2,3}|[a-z]{2,3})$/i;
  const searchParamPattern = /([?&])(q|query|search|s|k)=/i;

  // Filter checks
  const isGoogleUrl = url => googlePattern.test(url.hostname);
  const isSearchUrl = url => searchParamPattern.test(url.search);
  const isCustomDomain = url => filters.customDomains.some(domain => 
    url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );

  // Main processing loop
  for (const link of links) {
    try {
      const url = new URL(link.href, document.baseURI);
      if (seen.has(url.href)) continue;
      seen.add(url.href);

      // Apply filters
      if (filters.excludeGoogle && isGoogleUrl(url)) continue;
      if (filters.excludeInternal && url.hostname === currentHostname) continue;
      if (filters.onlySearch && !isSearchUrl(url)) continue;
      if (filters.customDomains.length && isCustomDomain(url)) continue;

      filteredUrls.push(url.href);
    } catch (e) {
      // Skip invalid URLs
    }
  }

  return filteredUrls.sort((a, b) => a.localeCompare(b));
}