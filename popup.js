/**
 * popup.js
 * --------
 * Controls the extension popup UI:
 *   Feature 1: Toggle between "required only" and "all fields" modes,
 *              "Fill Fields" button triggers content.js
 *   Feature 2: "Record Payload on Submit" toggle, download/clear buttons
 */

(function () {
  'use strict';

  // ─── DOM refs ─────────────────────────────────────────────────────────
  const fillBtn = document.getElementById('fill-btn');
  const statusEl = document.getElementById('status');
  const requiredToggle = document.getElementById('required-toggle');

  const recordToggle = document.getElementById('record-toggle');
  const payloadStatus = document.getElementById('payload-status');
  const payloadActions = document.getElementById('payload-actions');
  const downloadBtn = document.getElementById('download-btn');
  const clearBtn = document.getElementById('clear-btn');

  let activeTabId = null;
  let pollInterval = null;

  // ─── Helpers ──────────────────────────────────────────────────────────

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function isRestrictedUrl(url) {
    return url && (url.startsWith('chrome://') || url.startsWith('chrome-extension://'));
  }

  function showStatus(el, message, type) {
    el.textContent = message;
    el.className = type || '';
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 1 — Auto-fill
  // ═══════════════════════════════════════════════════════════════════════

  // Load saved preference
  chrome.storage.local.get({ requiredOnly: true }, (data) => {
    requiredToggle.checked = !data.requiredOnly;
    updateButtonLabel(!data.requiredOnly);
  });

  requiredToggle.addEventListener('change', () => {
    const fillAll = requiredToggle.checked;
    chrome.storage.local.set({ requiredOnly: !fillAll });
    updateButtonLabel(fillAll);
  });

  function updateButtonLabel(fillAll) {
    fillBtn.textContent = fillAll ? 'Fill All Fields' : 'Fill Required Fields';
  }

  fillBtn.addEventListener('click', async () => {
    fillBtn.disabled = true;
    showStatus(statusEl, 'Filling...', '');

    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id) { showStatus(statusEl, 'No active tab found.', 'error'); return; }
      if (isRestrictedUrl(tab.url)) { showStatus(statusEl, 'Cannot fill on this page.', 'error'); return; }

      const requiredOnly = !requiredToggle.checked;
      let response;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { action: 'fill-fields', requiredOnly });
      } catch (_) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['utils/angular-helper.js', 'content.js'] });
        response = await chrome.tabs.sendMessage(tab.id, { action: 'fill-fields', requiredOnly });
      }

      if (response && response.error) {
        showStatus(statusEl, 'Error: ' + response.error, 'error');
      } else if (response) {
        showStatus(statusEl, `Filled ${response.filled} of ${response.total} field(s).`, response.filled > 0 ? 'success' : 'error');
      } else {
        showStatus(statusEl, 'No response from page.', 'error');
      }
    } catch (err) {
      showStatus(statusEl, 'Error: ' + err.message, 'error');
    } finally {
      fillBtn.disabled = false;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FEATURE 2 — Record Payload on Submit
  // ═══════════════════════════════════════════════════════════════════════

  // Load saved recording preference & restore UI state
  async function initPayloadUI() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    activeTabId = tab.id;

    const data = await chrome.storage.local.get({ recordPayload: false });
    recordToggle.checked = data.recordPayload;

    if (data.recordPayload) {
      await startRecording();
    }

    // Check if there's already a captured payload for this tab
    await refreshPayloadState();
  }

  recordToggle.addEventListener('change', async () => {
    const enabled = recordToggle.checked;
    chrome.storage.local.set({ recordPayload: enabled });

    if (enabled) {
      await startRecording();
    } else {
      await stopRecording();
    }
  });

  async function startRecording() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    activeTabId = tab.id;

    if (isRestrictedUrl(tab.url)) {
      showStatus(payloadStatus, 'Cannot record on this page.', 'error');
      return;
    }

    // 1. Inject the payload interceptor into MAIN world
    try {
      await chrome.runtime.sendMessage({ action: 'inject-payload-interceptor', tabId: tab.id });
    } catch (err) {
      showStatus(payloadStatus, 'Failed to inject interceptor: ' + err.message, 'error');
      return;
    }

    // 2. Ensure content script is present, then tell it to start listening
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'start-payload-recording' });
    } catch (_) {
      // Content script not injected yet — inject it
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['utils/angular-helper.js', 'content.js'] });
      await chrome.tabs.sendMessage(tab.id, { action: 'start-payload-recording' });
    }

    showStatus(payloadStatus, 'Listening for submit...', 'listening');
    payloadActions.classList.remove('visible');

    // Start polling for captured data
    startPolling();
  }

  async function stopRecording() {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'stop-payload-recording' });
      } catch (_) { /* content script may not be present */ }
    }

    stopPolling();
    showStatus(payloadStatus, '', '');
    payloadActions.classList.remove('visible');
  }

  // ── Polling for capture state ─────────────────────────────────────────

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(async () => {
      await refreshPayloadState();
    }, 500);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function refreshPayloadState() {
    if (!activeTabId) return;

    // Check for completed capture
    try {
      const result = await chrome.runtime.sendMessage({ action: 'get-captured-payload', tabId: activeTabId });
      if (result && result.data) {
        const reqCount = result.data.requests ? result.data.requests.length : 0;
        if (reqCount > 0) {
          showStatus(payloadStatus, `${reqCount} request(s) captured`, 'captured');
          payloadActions.classList.add('visible');
          stopPolling();
          return;
        } else {
          showStatus(payloadStatus, 'No requests detected. Check if the form uses a non-standard submission.', 'warning');
          payloadActions.classList.add('visible');
          stopPolling();
          return;
        }
      }
    } catch (_) { }

    // Check live count
    try {
      const countResult = await chrome.runtime.sendMessage({ action: 'get-request-count', tabId: activeTabId });
      if (countResult && countResult.count > 0) {
        showStatus(payloadStatus, `Capturing... ${countResult.count} request(s) so far`, 'listening');
      }
    } catch (_) { }
  }

  // ── Download button ───────────────────────────────────────────────────

  downloadBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: 'get-captured-payload', tabId: activeTabId });
      if (!result || !result.data) {
        showStatus(payloadStatus, 'No payload data to download.', 'error');
        return;
      }

      const json = JSON.stringify(result.data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `payload_${timestamp}.json`;

      // Use a temporary <a> link to trigger download
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showStatus(payloadStatus, `Downloaded: ${filename}`, 'captured');
    } catch (err) {
      showStatus(payloadStatus, 'Download error: ' + err.message, 'error');
    }
  });

  // ── Clear button ──────────────────────────────────────────────────────

  clearBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'clear-captured-payload', tabId: activeTabId });
    } catch (_) { }

    payloadActions.classList.remove('visible');

    // If toggle is still ON, restart listening
    if (recordToggle.checked) {
      await startRecording();
    } else {
      showStatus(payloadStatus, '', '');
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────
  initPayloadUI();

  // Clean up polling when popup closes
  window.addEventListener('unload', () => {
    stopPolling();
  });
})();
