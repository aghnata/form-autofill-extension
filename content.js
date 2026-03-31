/**
 * content.js
 * ----------
 * Injected into every page. Handles:
 *   1. Detecting required form fields (HTML5 required, aria-required, Angular
 *      validation classes, asterisk labels, formControlName attributes)
 *   2. Determining contextually appropriate fill data based on field type,
 *      name, id, placeholder, label, and formControlName
 *   3. Filling fields and notifying Angular via angular-helper.js
 *   4. Visual feedback: green border on success, red on failure
 *   5. MutationObserver for dynamically rendered Angular components
 */

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────

  const HIGHLIGHT_DURATION_MS = 2000;
  const HIGHLIGHT_SUCCESS = '2px solid #4CAF50';
  const HIGHLIGHT_FAILURE = '2px solid #F44336';

  // ─── Field value inference ──────────────────────────────────────────────

  /**
   * Build a single "hint" string from all the context we can gather about a
   * field: its name, id, placeholder, aria-label, associated <label>, and
   * Angular's formControlName attribute.
   */
  function getFieldHint(element) {
    const parts = [
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('placeholder'),
      element.getAttribute('aria-label'),
      element.getAttribute('formcontrolname'),
      element.getAttribute('ng-model'),
      element.getAttribute('data-ng-model'),
      getLabelText(element),
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  /** Get text of the <label> associated with this element. */
  function getLabelText(element) {
    // Explicit label via `for` attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // Implicit label (element nested inside <label>)
    const parentLabel = element.closest('label');
    if (parentLabel) return parentLabel.textContent.trim();

    // mat-form-field label (Angular Material)
    const matField = element.closest('mat-form-field');
    if (matField) {
      const matLabel = matField.querySelector('mat-label, label, .mat-mdc-floating-label');
      if (matLabel) return matLabel.textContent.trim();
    }
    return '';
  }

  /**
   * Infer the best fill value for a text-like input based on the hint string.
   */
  function inferTextValue(hint) {
    if (/first[\s_-]?name/i.test(hint)) return 'John';
    if (/last[\s_-]?name|surname|family/i.test(hint)) return 'Doe';
    if (/full[\s_-]?name|display[\s_-]?name|^name$|user[\s_-]?name/i.test(hint)) return 'JohnDoe';
    if (/name/i.test(hint)) return 'JohnDoe';
    if (/e[\s_-]?mail/i.test(hint)) return 'test@example.com';
    if (/phone|mobile|tel|fax/i.test(hint)) return '+1234567890';
    if (/address|street/i.test(hint)) return '123 Main Street';
    if (/city|town/i.test(hint)) return 'New York';
    if (/state|province|region/i.test(hint)) return 'NY';
    if (/zip|postal|postcode/i.test(hint)) return '10001';
    if (/country/i.test(hint)) return 'United States';
    if (/company|org|business/i.test(hint)) return 'Acme Corp';
    if (/website|url|link|homepage/i.test(hint)) return 'https://example.com';
    if (/age/i.test(hint)) return '25';
    if (/title|subject/i.test(hint)) return 'Test Title';
    if (/message|comment|description|note|bio|about/i.test(hint)) return 'This is a test value for automated form filling.';
    if (/search|query|keyword/i.test(hint)) return 'test search';
    if (/ssn|social/i.test(hint)) return '000-00-0000';
    if (/card|credit/i.test(hint)) return '4111111111111111';
    if (/cvv|cvc/i.test(hint)) return '123';
    if (/expir/i.test(hint)) return '12/28';
    // Numeric-context patterns: fields whose name/label implies a number
    if (/days?|count|amount|quantity|number|buffer|limit|max|min|size|length|duration|period|rate|price|cost|fee|total|balance|score|weight|height|width|year|month|age|percent|ratio|threshold|capacity|budget|salary|income|hour|minute|second|interval|timeout|retry|attempt|step|level|order|rank|priority|code|pin/i.test(hint)) return '1';
    return 'Test Value';
  }

  /** Get today's date in YYYY-MM-DD format (for type="date" inputs). */
  function getTodayISO() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /** Get today's date in MM/DD/YYYY format (compat for some date pickers). */
  function getTodaySlash() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }

  /**
   * Detect if a text input is actually expecting a numeric value.
   * Checks HTML attributes (inputmode, pattern) and contextual hints
   * (field name, placeholder, label containing number-related words).
   */
  function isNumericField(element, hint) {
    // inputmode="numeric" or inputmode="decimal" — strong signal
    const inputmode = element.getAttribute('inputmode');
    if (inputmode === 'numeric' || inputmode === 'decimal') return true;

    // pattern attribute suggesting digits only
    const pattern = element.getAttribute('pattern');
    if (pattern && /^\[?0-9/.test(pattern)) return true;

    // ng-reflect-type="number" (Angular debug attribute)
    if (element.getAttribute('ng-reflect-type') === 'number') return true;

    // Contextual: hint contains number-implying words
    if (/days?|count|amount|quantity|number|buffer|limit|size|length|duration|period|rate|price|cost|fee|total|balance|score|weight|height|width|percent|ratio|threshold|capacity|budget|salary|income|hours?|minutes?|seconds?|interval|timeout|retry|attempts?|step|level|order|rank|priority|pin/i.test(hint)) {
      return true;
    }

    return false;
  }

  // ─── Required field detection ───────────────────────────────────────────

  /**
   * Returns true if the element should be considered "required" for our
   * purposes. Covers:
   *   - HTML5 `required` attribute
   *   - `aria-required="true"`
   *   - Angular validation classes: ng-invalid combined with ng-untouched/ng-pristine
   *   - Parent mat-form-field with required class
   *   - Asterisk (*) in the associated label text
   */
  function isFieldRequired(element) {
    // HTML5 required
    if (element.required || element.hasAttribute('required')) return true;

    // aria-required
    if (element.getAttribute('aria-required') === 'true') return true;

    // Angular invalid + untouched/pristine — likely required but not yet filled
    const cls = element.classList;
    if (cls.contains('ng-invalid') && (cls.contains('ng-untouched') || cls.contains('ng-pristine'))) {
      return true;
    }

    // Mat-form-field with required
    const matField = element.closest('mat-form-field');
    if (matField) {
      if (matField.classList.contains('mat-form-field-required') ||
        matField.querySelector('.mat-mdc-form-field-required-marker, .mat-form-field-required-marker')) {
        return true;
      }
    }

    // Asterisk in label text
    const labelText = getLabelText(element);
    if (labelText && /\*/.test(labelText)) return true;

    return false;
  }

  /**
   * Check if a field already has a meaningful value.
   * Only skips fields that were previously filled BY THIS EXTENSION
   * (marked with a data attribute). Browser-autofilled values are
   * always overwritten so the extension's defaults take priority.
   */
  function hasExistingValue(element) {
    // If this extension already filled the field, skip it
    if (element.dataset.autofillExtFilled === 'true') return true;
    // Otherwise, always fill — even if browser autofill populated it
    return false;
  }

  // ─── Visual feedback ────────────────────────────────────────────────────

  /**
   * Check if an element is truly visible on the current page view.
   * Uses multiple checks to avoid filling fields in hidden tabs, collapsed
   * sections, off-screen areas, or display:none containers.
   *
   * offsetParent alone is unreliable — it returns null for position:fixed
   * elements and doesn't catch visibility:hidden or elements scrolled into
   * a hidden overflow container (like Angular router-outlet pages).
   */
  function isElementVisible(element) {
    // Quick reject: zero dimensions means it's not rendered
    if (element.offsetWidth === 0 && element.offsetHeight === 0) return false;

    // Check computed style — catches display:none, visibility:hidden, opacity:0
    const style = window.getComputedStyle(element);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    // Check if any ancestor is hidden (display:none, hidden attribute, etc.)
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      const pStyle = window.getComputedStyle(parent);
      if (pStyle.display === 'none') return false;
      if (pStyle.visibility === 'hidden') return false;
      // Check for Angular's [hidden] or hidden attribute on containers
      if (parent.hasAttribute('hidden')) return false;
      // Check for common Angular route hiding patterns (aria-hidden on inactive views)
      if (parent.getAttribute('aria-hidden') === 'true') return false;
      parent = parent.parentElement;
    }

    // Final check: is the element within the document's visible area?
    // getBoundingClientRect returns all zeros for elements in a detached/hidden subtree
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  function highlightField(element, success) {
    const prev = element.style.outline;
    element.style.outline = success ? HIGHLIGHT_SUCCESS : HIGHLIGHT_FAILURE;
    setTimeout(() => {
      element.style.outline = prev;
    }, HIGHLIGHT_DURATION_MS);
  }

  // ─── Individual field fillers ───────────────────────────────────────────

  function fillInput(element) {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    const hint = getFieldHint(element);
    let value;

    switch (type) {
      case 'email':
        value = 'test@example.com';
        break;
      case 'tel':
        value = '+1234567890';
        break;
      case 'number':
        value = element.getAttribute('min') || '1';
        break;
      case 'password':
        value = 'Password123!';
        break;
      case 'date':
        value = getTodayISO();
        break;
      case 'datetime-local':
        value = getTodayISO() + 'T12:00';
        break;
      case 'time':
        value = '12:00';
        break;
      case 'url':
        value = 'https://example.com';
        break;
      case 'search':
        value = 'test search';
        break;
      case 'color':
        value = '#4CAF50';
        break;
      case 'range':
        value = element.getAttribute('min') || '50';
        break;
      case 'month':
        value = new Date().getFullYear() + '-01';
        break;
      case 'week':
        value = new Date().getFullYear() + '-W01';
        break;
      case 'checkbox':
        if (!element.checked) {
          element.checked = true;
          AngularHelper.dispatchAngularEvents(element);
          AngularHelper.triggerAngularChangeDetection(element);
        }
        return true;
      case 'radio':
        return fillRadioGroup(element);
      case 'hidden':
        return false; // never fill hidden inputs
      case 'text':
      default:
        // Check if this text field is actually an email/phone/number by context
        if (/e[\s_-]?mail/i.test(hint)) {
          value = 'test@example.com';
        } else if (/phone|mobile|tel/i.test(hint)) {
          value = '+1234567890';
        } else if (/date|birth|dob/i.test(hint)) {
          value = getTodaySlash();
        } else if (isNumericField(element, hint)) {
          // Field is contextually numeric (inputmode, pattern, or name implies number)
          value = element.getAttribute('min') || '1';
        } else {
          value = inferTextValue(hint);
        }
        break;
    }

    AngularHelper.setValueAndNotify(element, value);
    return true;
  }

  function fillSelect(element) {
    const options = element.options;
    if (!options || options.length === 0) return false;

    // Find first non-placeholder option
    for (let i = 0; i < options.length; i++) {
      const text = options[i].textContent.trim().toLowerCase();
      const val = options[i].value;
      if (
        val &&
        val !== '' &&
        !text.includes('select') &&
        !text.includes('choose') &&
        !text.includes('--') &&
        !text.includes('please')
      ) {
        element.selectedIndex = i;
        AngularHelper.setNativeValue(element, val);
        AngularHelper.dispatchAngularEvents(element);
        AngularHelper.triggerAngularChangeDetection(element);
        return true;
      }
    }

    // Fallback: select index 1 if exists, else 0
    if (options.length > 1) {
      element.selectedIndex = 1;
    }
    AngularHelper.dispatchAngularEvents(element);
    AngularHelper.triggerAngularChangeDetection(element);
    return true;
  }

  function fillTextarea(element) {
    const hint = getFieldHint(element);
    const value = inferTextValue(hint);
    AngularHelper.setValueAndNotify(element, value);
    return true;
  }

  function fillRadioGroup(element) {
    const name = element.getAttribute('name');
    if (!name) {
      // No name → try to just check this one
      if (!element.checked) {
        element.checked = true;
        AngularHelper.dispatchAngularEvents(element);
        AngularHelper.triggerAngularChangeDetection(element);
      }
      return true;
    }

    // Check if any in the group is already selected
    const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
    for (const radio of group) {
      if (radio.checked) return false; // already selected
    }

    // Select the first one
    if (group.length > 0) {
      group[0].checked = true;
      AngularHelper.dispatchAngularEvents(group[0]);
      AngularHelper.triggerAngularChangeDetection(group[0]);
      return true;
    }
    return false;
  }

  // ─── Angular Material component fillers ─────────────────────────────────

  async function fillMatSelectElement(matSelect) {
    return AngularHelper.fillMatSelect(matSelect);
  }

  function fillMatCheckbox(matCheckbox) {
    return AngularHelper.toggleMatCheckbox(matCheckbox);
  }

  function fillMatRadioGroup(matRadioGroup) {
    return AngularHelper.selectMatRadio(matRadioGroup);
  }

  function fillMatSlideToggle(matToggle) {
    const inner = matToggle.querySelector('input[type="checkbox"]');
    if (inner && inner.checked) return false;

    const button = matToggle.querySelector('button, .mdc-switch, .mat-mdc-slide-toggle-switch');
    if (button) {
      button.click();
    } else {
      matToggle.click();
    }

    if (inner) {
      inner.checked = true;
      AngularHelper.dispatchAngularEvents(inner);
    }
    AngularHelper.triggerAngularChangeDetection(matToggle);
    return true;
  }

  /**
   * Handle mat-datepicker fields: they usually wrap a regular text/input
   * inside a mat-form-field with a matDatepicker directive.
   */
  function fillMatDatepicker(inputElement) {
    const value = getTodaySlash();
    AngularHelper.setValueAndNotify(inputElement, value);
    return true;
  }

  // ─── Main fill logic ───────────────────────────────────────────────────

  /**
   * Gather all fillable form elements from the page.
   * @param {boolean} requiredOnly — if true, only returns elements detected as required
   */
  function gatherFields(requiredOnly) {
    const results = [];

    // Standard HTML form elements
    const standardElements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea'
    );

    for (const el of standardElements) {
      // Skip disabled or readonly fields
      if (el.disabled || el.readOnly) continue;
      // Skip fields not actually visible on the current page/view
      if (!isElementVisible(el)) continue;
      // If required-only mode, check if required
      if (requiredOnly && !isFieldRequired(el)) continue;
      // Skip if already filled by this extension
      if (hasExistingValue(el)) continue;

      results.push({ element: el, type: 'standard' });
    }

    // Angular Material components (these are custom elements, not standard inputs)
    const matSelects = document.querySelectorAll('mat-select');
    for (const el of matSelects) {
      if (!isElementVisible(el)) continue;
      if (requiredOnly && !isFieldRequired(el) && !isMatFieldRequired(el)) continue;
      // Skip if already filled by this extension
      if (el.dataset.autofillExtFilled === 'true') continue;
      results.push({ element: el, type: 'mat-select' });
    }

    const matCheckboxes = document.querySelectorAll('mat-checkbox');
    for (const el of matCheckboxes) {
      if (!isElementVisible(el)) continue;
      if (requiredOnly && !isFieldRequired(el) && !isMatFieldRequired(el)) continue;
      if (el.dataset.autofillExtFilled === 'true') continue;
      results.push({ element: el, type: 'mat-checkbox' });
    }

    const matRadioGroups = document.querySelectorAll('mat-radio-group');
    for (const el of matRadioGroups) {
      if (!isElementVisible(el)) continue;
      if (requiredOnly && !isFieldRequired(el) && !isMatFieldRequired(el)) continue;
      if (el.dataset.autofillExtFilled === 'true') continue;
      results.push({ element: el, type: 'mat-radio-group' });
    }

    const matToggles = document.querySelectorAll('mat-slide-toggle');
    for (const el of matToggles) {
      if (!isElementVisible(el)) continue;
      if (requiredOnly && !isFieldRequired(el) && !isMatFieldRequired(el)) continue;
      if (el.dataset.autofillExtFilled === 'true') continue;
      results.push({ element: el, type: 'mat-slide-toggle' });
    }

    return results;
  }

  /** Check if an Angular Material wrapper has required marker. */
  function isMatFieldRequired(element) {
    const matField = element.closest('mat-form-field');
    if (matField) {
      if (matField.querySelector('.mat-mdc-form-field-required-marker, .mat-form-field-required-marker')) {
        return true;
      }
    }
    // Check for required attribute on the element itself
    if (element.hasAttribute('required') || element.getAttribute('aria-required') === 'true') {
      return true;
    }
    // Check ng-reflect-required (Angular template binding debug attribute)
    if (element.getAttribute('ng-reflect-required') === 'true') return true;
    return false;
  }

  /**
   * Fill a single detected field. Returns true on success.
   */
  async function fillField(fieldInfo) {
    const { element, type } = fieldInfo;
    try {
      let success = false;
      switch (type) {
        case 'mat-select':
          success = await fillMatSelectElement(element);
          break;
        case 'mat-checkbox':
          success = fillMatCheckbox(element);
          break;
        case 'mat-radio-group':
          success = fillMatRadioGroup(element);
          break;
        case 'mat-slide-toggle':
          success = fillMatSlideToggle(element);
          break;
        case 'standard': {
          const tag = element.tagName.toLowerCase();
          if (tag === 'select') {
            success = fillSelect(element);
          } else if (tag === 'textarea') {
            success = fillTextarea(element);
          } else if (tag === 'input') {
            // Check for mat-datepicker association
            if (element.hasAttribute('matDatepicker') ||
              element.hasAttribute('matdatepicker') ||
              element.closest('mat-form-field')?.querySelector('mat-datepicker-toggle')) {
              success = fillMatDatepicker(element);
            } else {
              success = fillInput(element);
            }
          }
          break;
        }
        default:
          break;
      }

      highlightField(element, success);
      // Mark the element so we don't overwrite it on repeated clicks
      if (success) {
        element.dataset.autofillExtFilled = 'true';
      }
      return success;
    } catch (err) {
      console.warn('[AutoFill] Error filling field:', err, element);
      highlightField(element, false);
      return false;
    }
  }

  /**
   * Main entry point — called by popup or keyboard shortcut via chrome.runtime message.
   * @param {boolean} requiredOnly — whether to fill only required fields
   * @returns {{ filled: number, total: number }}
   */
  async function fillAllFields(requiredOnly) {
    // ── Multi-pass strategy for cascading/dependent dropdowns ──────────
    // Some dropdowns (e.g. "City") are populated only after a parent dropdown
    // (e.g. "Country") is selected and Angular processes the change. A single
    // pass would miss these because their options haven't loaded yet.
    // We run up to MAX_PASSES, waiting between each pass for Angular to
    // fetch/filter dependent data and render new options.

    const MAX_PASSES = 5;
    const PASS_DELAY_MS = 800; // time to wait for Angular to populate dependent fields
    let totalFilled = 0;
    let totalDetected = 0;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const fields = gatherFields(requiredOnly);

      if (pass === 0) {
        totalDetected = fields.length;
      }

      // No unfilled fields left — we're done
      if (fields.length === 0) break;

      let filledThisPass = 0;
      for (const field of fields) {
        const ok = await fillField(field);
        if (ok) filledThisPass++;
      }

      totalFilled += filledThisPass;

      // Trigger change detection so Angular processes the values we just set
      // (e.g. parent dropdown change triggers child dropdown population)
      try {
        AngularHelper.triggerAngularChangeDetection(document.body);
      } catch (_) { }

      // If nothing was filled this pass, no point retrying — the remaining
      // fields likely can't be filled (no options, disabled, etc.)
      if (filledThisPass === 0) break;

      // If there might be more dependent fields, wait for Angular to
      // process changes and populate them before the next pass
      if (pass < MAX_PASSES - 1) {
        await new Promise(resolve => setTimeout(resolve, PASS_DELAY_MS));
      }
    }

    // One final change detection pass after all fields are filled
    try {
      AngularHelper.triggerAngularChangeDetection(document.body);
    } catch (_) { }

    return { filled: totalFilled, total: totalFilled };
  }

  // ─── MutationObserver for dynamically rendered fields ───────────────────
  // Angular lazy-loads components, so form fields may appear after our script
  // runs. We watch for new fields and store them for the next fill action.
  // (We do NOT auto-fill them — only on user-triggered action.)

  let dynamicObserver = null;

  function startObserver() {
    if (dynamicObserver) return;
    // We just keep the observer alive so that when the fill command triggers,
    // any newly-added fields will be in the DOM and picked up by gatherFields.
    dynamicObserver = AngularHelper.observeDynamicFields(() => {
      // No-op: fields are detected at fill time
    });
  }

  startObserver();

  // ─── Message listener ───────────────────────────────────────────────────
  // The popup and background script send messages to trigger filling.
  // Also handles payload recording start/stop commands.

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'fill-fields') {
      const requiredOnly = message.requiredOnly !== false; // default true
      fillAllFields(requiredOnly).then(result => {
        sendResponse(result);
      }).catch(err => {
        console.error('[AutoFill] Fill error:', err);
        sendResponse({ filled: 0, total: 0, error: err.message });
      });
      // Return true to indicate we'll call sendResponse asynchronously
      return true;
    }

    // ── Payload recording commands ──────────────────────────────────────
    if (message.action === 'start-payload-recording') {
      // Forward to the page context (injected.js / payload-interceptor.js)
      window.postMessage({
        type: '__autofill_ext_payload__',
        action: 'start-listening',
      }, '*');
      sendResponse({ ok: true });
      return false;
    }

    if (message.action === 'stop-payload-recording') {
      window.postMessage({
        type: '__autofill_ext_payload__',
        action: 'stop-listening',
      }, '*');
      sendResponse({ ok: true });
      return false;
    }
  });

  // ─── Payload relay: page context → content script → background ────────
  // The payload interceptor (running in MAIN world) sends captured data via
  // window.postMessage. We listen here in the content script and forward it
  // to the background service worker via chrome.runtime.sendMessage.

  const PAYLOAD_MSG_KEY = '__autofill_ext_payload__';

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== PAYLOAD_MSG_KEY) return;

    if (event.data.action === 'capture-complete') {
      // Full capture data — forward to background for storage
      chrome.runtime.sendMessage({
        action: 'payload-captured',
        data: event.data.data,
      }).catch(err => {
        console.warn('[AutoFill] Failed to send payload to background:', err);
      });
    }

    if (event.data.action === 'request-captured') {
      // Live count update — forward to background so popup can poll
      chrome.runtime.sendMessage({
        action: 'payload-request-count',
        count: event.data.count,
      }).catch(() => { /* popup might be closed */ });
    }
  });

  // If content script was already loaded and page is ready, log a message
  console.log('[Angular Form AutoFill] Content script loaded and ready.');
})();
