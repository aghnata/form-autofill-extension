/**
 * payload-interceptor.js
 * ----------------------
 * XHR and Fetch wrapping logic. Designed to run in the MAIN page context
 * (injected via world: "MAIN") so it shares the same JS context as Angular's
 * HttpClient.
 *
 * How it works:
 *   1. Wraps XMLHttpRequest.prototype.open/send to capture XHR payloads
 *   2. Wraps window.fetch to capture Fetch payloads
 *   3. Only captures requests fired within a short "capture window" after
 *      a submit button click, to avoid capturing unrelated background requests
 *   4. Sends captured data to the content script via window.postMessage
 */

(function () {
  'use strict';

  // Unique message key to avoid collision with other postMessage users
  const MSG_KEY = '__autofill_ext_payload__';

  // ─── State ────────────────────────────────────────────────────────────
  let capturing = false;
  let captureWindowTimeout = null;
  let capturedRequests = [];
  let submitTrigger = null;

  // ─── Submit button detection ──────────────────────────────────────────
  // Listen for clicks on submit-like buttons. When one is clicked, open
  // a 2-second capture window during which all XHR/fetch requests are recorded.

  function isSubmitButton(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();

    // <button type="submit"> or <input type="submit">
    if (el.getAttribute('type') === 'submit') return true;

    // Angular Material raised buttons that act as submit
    if (el.hasAttribute('mat-raised-button') || el.hasAttribute('mat-flat-button') ||
        el.hasAttribute('mat-button')) {
      // Only if inside a form or commonly named
      const text = (el.textContent || '').trim().toLowerCase();
      if (/submit|save|send|create|update|confirm|register|sign\s?up|log\s?in/i.test(text)) {
        return true;
      }
    }

    // Generic button/a with submit-like text
    if (tag === 'button' || tag === 'a' || tag === 'input') {
      const text = (el.textContent || el.value || '').trim().toLowerCase();
      if (/submit|save|send|create|update|confirm|register|sign\s?up|log\s?in/i.test(text)) {
        return true;
      }
    }

    return false;
  }

  function getButtonSelector(el) {
    if (!el) return '';
    try {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      return `${tag}${id}${type ? '[type="' + type + '"]' : ''}${cls}`;
    } catch (_) {
      return '';
    }
  }

  // Capture click events on submit buttons (use capture phase to catch early)
  document.addEventListener('click', (e) => {
    if (!listening) return;

    // Walk up from the click target to find if a submit button was clicked
    let el = e.target;
    for (let i = 0; i < 5 && el; i++) {
      if (isSubmitButton(el)) {
        startCaptureWindow(el);
        return;
      }
      el = el.parentElement;
    }
  }, true);

  // Also intercept form submit events directly
  document.addEventListener('submit', (e) => {
    if (!listening) return;
    // Find the submit button if possible
    const form = e.target;
    const submitBtn = form ? form.querySelector('[type="submit"], button:not([type="button"]):not([type="reset"])') : null;
    startCaptureWindow(submitBtn || form);
  }, true);

  function startCaptureWindow(triggerEl) {
    capturing = true;
    capturedRequests = [];
    submitTrigger = {
      buttonText: (triggerEl.textContent || triggerEl.value || '').trim().substring(0, 100),
      buttonSelector: getButtonSelector(triggerEl),
    };

    // Clear any previous capture window
    if (captureWindowTimeout) clearTimeout(captureWindowTimeout);

    // Keep capture window open for 2 seconds
    captureWindowTimeout = setTimeout(() => {
      finishCapture();
    }, 2000);
  }

  function finishCapture() {
    capturing = false;

    // Send captured data to content script via postMessage
    window.postMessage({
      type: MSG_KEY,
      action: 'capture-complete',
      data: {
        capturedAt: new Date().toISOString(),
        pageUrl: window.location.href,
        submitTrigger: submitTrigger,
        requests: capturedRequests,
      },
    }, '*');

    capturedRequests = [];
    submitTrigger = null;
  }

  function addCapturedRequest(method, url, headers, body, bodyRaw) {
    if (!capturing) return;

    capturedRequests.push({
      index: capturedRequests.length + 1,
      method: method || 'UNKNOWN',
      url: url || '',
      headers: headers || {},
      body: body,
      bodyRaw: bodyRaw || '',
      timestamp: new Date().toISOString(),
    });

    // Notify content script immediately about each captured request
    // so the popup can show live count
    window.postMessage({
      type: MSG_KEY,
      action: 'request-captured',
      count: capturedRequests.length,
    }, '*');
  }

  // ─── Parse body safely ────────────────────────────────────────────────

  function parseBody(raw) {
    if (!raw) return { parsed: null, rawStr: '' };
    if (typeof raw === 'string') {
      try {
        return { parsed: JSON.parse(raw), rawStr: raw };
      } catch (_) {
        return { parsed: raw, rawStr: raw };
      }
    }
    if (raw instanceof FormData) {
      const obj = {};
      raw.forEach((val, key) => { obj[key] = val instanceof File ? `[File: ${val.name}]` : val; });
      return { parsed: obj, rawStr: JSON.stringify(obj) };
    }
    if (raw instanceof URLSearchParams) {
      const obj = {};
      raw.forEach((val, key) => { obj[key] = val; });
      return { parsed: obj, rawStr: raw.toString() };
    }
    if (raw instanceof ArrayBuffer || raw instanceof Blob) {
      return { parsed: '[Binary Data]', rawStr: '[Binary Data]' };
    }
    if (typeof raw === 'object') {
      try {
        const str = JSON.stringify(raw);
        return { parsed: raw, rawStr: str };
      } catch (_) {
        return { parsed: String(raw), rawStr: String(raw) };
      }
    }
    return { parsed: String(raw), rawStr: String(raw) };
  }

  // ─── XHR interception ────────────────────────────────────────────────
  // Wrap XMLHttpRequest.prototype.open and .send to capture request details.
  // We store the method/url on the XHR instance in .open, then capture the
  // body in .send.

  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;
  const origXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    // Store method and url on the instance for later retrieval in .send
    this.__af_method = method;
    this.__af_url = url;
    this.__af_headers = {};
    return origXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__af_headers) {
      this.__af_headers[name] = value;
    }
    return origXHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (capturing && this.__af_method) {
      const { parsed, rawStr } = parseBody(body);
      addCapturedRequest(
        this.__af_method,
        this.__af_url,
        { ...this.__af_headers },
        parsed,
        rawStr
      );
    }
    return origXHRSend.apply(this, arguments);
  };

  // ─── Fetch interception ───────────────────────────────────────────────
  // Wrap window.fetch to capture request details from the Request init object.

  const origFetch = window.fetch;

  window.fetch = function (input, init) {
    if (capturing) {
      let method = 'GET';
      let url = '';
      let headers = {};
      let bodyRaw = null;

      if (input instanceof Request) {
        method = input.method || 'GET';
        url = input.url || '';
        try {
          input.headers.forEach((val, key) => { headers[key] = val; });
        } catch (_) { }
        // Body from Request object is a ReadableStream — hard to clone sync.
        // If init also has a body, prefer that.
        bodyRaw = (init && init.body) || null;
      } else {
        url = typeof input === 'string' ? input : String(input);
        if (init) {
          method = init.method || 'GET';
          if (init.headers) {
            if (init.headers instanceof Headers) {
              init.headers.forEach((val, key) => { headers[key] = val; });
            } else if (typeof init.headers === 'object') {
              headers = { ...init.headers };
            }
          }
          bodyRaw = init.body || null;
        }
      }

      const { parsed, rawStr } = parseBody(bodyRaw);
      addCapturedRequest(method, url, headers, parsed, rawStr);
    }
    return origFetch.apply(this, arguments);
  };

  // ─── Listening state ──────────────────────────────────────────────────
  // The content script tells us when to start/stop listening via postMessage.

  let listening = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== MSG_KEY) return;

    if (event.data.action === 'start-listening') {
      listening = true;
      capturing = false;
      capturedRequests = [];
    } else if (event.data.action === 'stop-listening') {
      listening = false;
      capturing = false;
      capturedRequests = [];
      if (captureWindowTimeout) {
        clearTimeout(captureWindowTimeout);
        captureWindowTimeout = null;
      }
    }
  });

  console.log('[Angular Form AutoFill] Payload interceptor loaded in page context.');
})();
