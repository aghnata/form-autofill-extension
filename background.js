/**
 * background.js
 * -------------
 * Service worker for the Chrome extension (Manifest V3).
 * Handles:
 *   1. Keyboard shortcut command (Alt+Shift+F) to trigger form filling
 *   2. Ensuring content scripts are injected into the active tab
 *   3. Storing captured API payloads in chrome.storage.session
 *   4. Serving payload download requests from the popup
 *   5. Injecting the payload interceptor into the MAIN world
 */

// ─── Fill keyboard shortcut ───────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'fill-fields') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
        return;
      }

      const storage = await chrome.storage.local.get({ requiredOnly: true });

      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'fill-fields',
          requiredOnly: storage.requiredOnly,
        });
      } catch (_) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['utils/angular-helper.js', 'content.js'],
        });

        await chrome.tabs.sendMessage(tab.id, {
          action: 'fill-fields',
          requiredOnly: storage.requiredOnly,
        });
      }
    } catch (err) {
      console.error('[AutoFill Background] Error handling command:', err);
    }
  }
});

// ─── Payload capture storage ──────────────────────────────────────────────
// We use chrome.storage.session to store captured payloads. This is scoped
// to the browser session and clears on browser close — no persistent footprint.

// Track live request count per tab so popup can show progress
const liveRequestCounts = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  // ── Full capture complete — store in session storage ──────────────────
  if (message.action === 'payload-captured' && message.data) {
    const key = `payload_${tabId || 'unknown'}`;
    chrome.storage.session.set({ [key]: message.data }).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      console.error('[AutoFill Background] Error storing payload:', err);
      sendResponse({ ok: false, error: err.message });
    });
    return true; // async sendResponse
  }

  // ── Live request count update ─────────────────────────────────────────
  if (message.action === 'payload-request-count') {
    if (tabId) {
      liveRequestCounts[tabId] = message.count;
    }
    return false;
  }

  // ── Popup asks for captured payload ───────────────────────────────────
  if (message.action === 'get-captured-payload') {
    const targetTabId = message.tabId;
    const key = `payload_${targetTabId || 'unknown'}`;
    chrome.storage.session.get(key).then(result => {
      sendResponse({ data: result[key] || null });
    }).catch(err => {
      sendResponse({ data: null, error: err.message });
    });
    return true;
  }

  // ── Popup asks for live request count ─────────────────────────────────
  if (message.action === 'get-request-count') {
    const targetTabId = message.tabId;
    sendResponse({ count: liveRequestCounts[targetTabId] || 0 });
    return false;
  }

  // ── Clear stored payload for a tab ────────────────────────────────────
  if (message.action === 'clear-captured-payload') {
    const targetTabId = message.tabId;
    const key = `payload_${targetTabId || 'unknown'}`;
    if (targetTabId) {
      delete liveRequestCounts[targetTabId];
    }
    chrome.storage.session.remove(key).then(() => {
      sendResponse({ ok: true });
    }).catch(() => {
      sendResponse({ ok: false });
    });
    return true;
  }

  // ── Inject payload interceptor into MAIN world ────────────────────────
  if (message.action === 'inject-payload-interceptor') {
    const targetTabId = message.tabId;
    if (!targetTabId) {
      sendResponse({ ok: false, error: 'No tabId' });
      return false;
    }

    chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      files: ['utils/payload-interceptor.js'],
      world: 'MAIN',
    }).then(() => {
      sendResponse({ ok: true });
    }).catch(err => {
      console.error('[AutoFill Background] Error injecting interceptor:', err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
});

// Clean up live counts when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  delete liveRequestCounts[tabId];
});

console.log('[Angular Form AutoFill] Background service worker started.');
