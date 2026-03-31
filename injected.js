/**
 * injected.js
 * -----------
 * Thin loader injected into the PAGE context (world: "MAIN") via
 * chrome.scripting.executeScript. This file bootstraps the payload
 * interceptor by loading utils/payload-interceptor.js into a <script> tag.
 *
 * WHY a separate file?
 *   chrome.scripting.executeScript with world: "MAIN" runs code in the
 *   page's own JS context (not the isolated content script context).
 *   This is required because Angular's HttpClient uses the page's native
 *   XHR/Fetch — wrapping them from the content script's isolated world
 *   would not intercept Angular's requests.
 *
 * The payload-interceptor.js code is bundled inline here to avoid needing
 * web_accessible_resources (which would expose files to any page).
 */

// This file is executed directly via chrome.scripting.executeScript({ world: "MAIN" })
// The actual interception logic is in utils/payload-interceptor.js which is
// injected separately. This file serves as the entry point.

(function () {
  'use strict';
  // Nothing to do here — payload-interceptor.js is injected as a separate
  // script via chrome.scripting.executeScript with world: "MAIN".
  // This file exists as a placeholder entry point / documentation marker.
  console.log('[Angular Form AutoFill] injected.js loaded in MAIN world.');
})();
