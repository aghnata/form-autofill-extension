/**
 * angular-helper.js
 * -----------------
 * Dedicated module for Angular-specific change detection triggers and NgZone interaction.
 * Supports Angular 7 through 17+ (both template-driven and reactive forms).
 *
 * WHY these tricks are needed:
 * Angular uses its own change detection (Zone.js) and value accessor wrappers.
 * Simply setting element.value = "x" does NOT update Angular's internal model.
 * We must:
 *   1. Use the native HTMLInputElement setter (bypassing Angular's wrapper)
 *   2. Dispatch synthetic events that Angular's event listeners capture
 *   3. Trigger Zone.js-aware change detection so the UI/model reconcile
 */

// eslint-disable-next-line no-var
var AngularHelper = (function () {
  'use strict';

  // ─── Native value setter cache ────────────────────────────────────────────
  // Angular wraps the `value` property on input elements with its own accessor.
  // Using Object.getOwnPropertyDescriptor on the prototype gives us the REAL
  // browser setter, which writes to the DOM without going through Angular's
  // ControlValueAccessor, so we can set the value first and THEN notify Angular
  // via events.
  const nativeInputValueSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const nativeTextAreaValueSetter =
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  const nativeSelectValueSetter =
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;

  /**
   * Set a value on an input/textarea using the native setter.
   * This bypasses Angular's value accessor wrapper so the DOM value is set
   * before we dispatch events that Angular will intercept.
   */
  function setNativeValue(element, value) {
    if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(element, value);
    } else if (element instanceof HTMLSelectElement && nativeSelectValueSetter) {
      nativeSelectValueSetter.call(element, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      // Fallback: direct assignment (works on non-Angular pages)
      element.value = value;
    }
  }

  /**
   * Dispatch ALL the events Angular needs to recognize a value change:
   *   - focus  → marks the control as "touched" when followed by blur
   *   - input  → triggers Angular's (input) binding and DefaultValueAccessor
   *   - change → triggers (change) binding and select-based accessors
   *   - blur   → triggers Angular validation and marks ng-touched / ng-dirty
   *
   * Events use { bubbles: true, composed: true } so they cross shadow DOM
   * boundaries (relevant for Angular Material components).
   */
  function dispatchAngularEvents(element) {
    const eventOptions = { bubbles: true, composed: true };

    // Focus the element first — Angular tracks focus for touched state
    element.dispatchEvent(new FocusEvent('focus', eventOptions));
    element.dispatchEvent(new FocusEvent('focusin', eventOptions));

    // InputEvent — this is what DefaultValueAccessor listens to
    element.dispatchEvent(new InputEvent('input', { ...eventOptions, inputType: 'insertText' }));

    // Change event — triggers ChangeEvent-based accessors (select, checkbox, etc.)
    element.dispatchEvent(new Event('change', eventOptions));

    // Blur — triggers validation, marks as touched
    element.dispatchEvent(new FocusEvent('blur', eventOptions));
    element.dispatchEvent(new FocusEvent('focusout', eventOptions));
  }

  /**
   * Try to trigger Angular's change detection manually.
   *
   * Strategy 1 (Angular 9+ Ivy): Walk up from the element looking for
   * __ngContext__ on the element or its ancestors. If found, look for the
   * global `ng` devtools API (Angular exposes it in dev mode) and call
   * ng.applyChanges() on the component root.
   *
   * Strategy 2 (Angular 12-): Use ng.probe() via the debug element tree.
   *
   * Strategy 3: Find Zone.js symbols (__zone_symbol__) and trigger
   * a microtask check (Promise.resolve) which Zone.js will intercept.
   *
   * If none of these work the manually dispatched events above are usually
   * sufficient for production Angular apps (they don't need dev-mode APIs).
   */
  function triggerAngularChangeDetection(element) {
    try {
      // Strategy 1: Ivy runtime — ng.applyChanges (dev mode only)
      if (typeof ng !== 'undefined' && ng.applyChanges) {
        let node = element;
        while (node) {
          if (node.__ngContext__ !== undefined) {
            ng.applyChanges(node);
            return true;
          }
          node = node.parentElement;
        }
      }
    } catch (_) { /* ng not available or not in dev mode */ }

    try {
      // Strategy 2: Pre-Ivy — ng.probe (Angular 7/8 debug)
      if (typeof ng !== 'undefined' && ng.probe) {
        const debugEl = ng.probe(element);
        if (debugEl && debugEl.injector) {
          const appRef = debugEl.injector.get(ng.coreTokens?.ApplicationRef);
          if (appRef) {
            appRef.tick();
            return true;
          }
        }
      }
    } catch (_) { /* probe not available */ }

    // Strategy 3: Zone.js microtask — works in both dev and prod
    // Resolving a promise inside the Angular zone triggers change detection
    // because Zone.js patches Promise.
    try {
      Promise.resolve().then(() => { });
      return true;
    } catch (_) { }

    return false;
  }

  /**
   * Try to update the value via Angular's Reactive Forms control directly.
   * The control reference is often stored on __ngContext__ in Ivy.
   * We attempt to find it by walking the debug tree.
   */
  function trySetViaAngularControl(element, value) {
    try {
      // Ivy: ng.getComponent / ng.getContext
      if (typeof ng !== 'undefined') {
        // Try getting the directive (ngModel or formControl) attached to the element
        const directives = ng.getDirectives ? ng.getDirectives(element) : [];
        for (const dir of directives) {
          // Reactive Forms: FormControlDirective / FormControlName
          if (dir.control && typeof dir.control.setValue === 'function') {
            dir.control.setValue(value, { emitEvent: true });
            dir.control.markAsTouched();
            dir.control.markAsDirty();
            return true;
          }
          // Template-driven: NgModel
          if (dir.viewModel !== undefined && dir.update) {
            dir.viewModel = value;
            dir.update.emit(value);
            return true;
          }
        }
      }
    } catch (_) { /* swallow — API may differ between versions */ }

    try {
      // Pre-Ivy fallback: ng.probe
      if (typeof ng !== 'undefined' && ng.probe) {
        const debugEl = ng.probe(element);
        if (debugEl) {
          const ngModel = debugEl.injector.get(
            debugEl.providerTokens?.find(t => t?.name === 'NgModel'),
            null
          );
          if (ngModel && ngModel.control) {
            ngModel.control.setValue(value, { emitEvent: true });
            ngModel.control.markAsTouched();
            ngModel.control.markAsDirty();
            return true;
          }
        }
      }
    } catch (_) { /* not available */ }

    return false;
  }

  /**
   * Master function: set a value on an element and make Angular aware of it.
   * Tries the Angular control route first; falls back to native setter + events.
   */
  function setValueAndNotify(element, value) {
    // 1. Try the Angular Reactive Forms / NgModel route
    const controlSet = trySetViaAngularControl(element, value);

    // 2. Always set via native setter as well (belt-and-suspenders)
    setNativeValue(element, value);

    // 3. Dispatch all events Angular listens for
    dispatchAngularEvents(element);

    // 4. Trigger change detection
    triggerAngularChangeDetection(element);

    return controlSet;
  }

  // ─── Angular Material helpers ─────────────────────────────────────────────

  /**
   * Handle mat-select: Angular Material select components render a custom
   * overlay panel. We simulate user interaction: click to open, select an
   * option, close.
   */
  function fillMatSelect(matSelectEl) {
    return new Promise((resolve) => {
      // Click the mat-select to open the overlay panel
      matSelectEl.click();
      matSelectEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // Wait for the overlay animation to render options
      setTimeout(() => {
        // mat-option elements appear in a cdk-overlay-container in the document body
        const options = document.querySelectorAll('mat-option, .mat-mdc-option');
        let selected = false;

        for (const option of options) {
          const text = option.textContent?.trim() || '';
          // Skip placeholder / empty options
          if (
            text &&
            !text.toLowerCase().includes('select') &&
            !text.toLowerCase().includes('choose') &&
            !text.toLowerCase().includes('--') &&
            text !== ''
          ) {
            option.click();
            selected = true;
            break;
          }
        }
        // If all options look like placeholders, just pick the second one (or first)
        if (!selected && options.length > 1) {
          options[1].click();
          selected = true;
        } else if (!selected && options.length === 1) {
          options[0].click();
          selected = true;
        }

        // Close any remaining overlay by pressing Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // Trigger change detection after mat-select interaction
        triggerAngularChangeDetection(matSelectEl);

        resolve(selected);
      }, 300);
    });
  }

  /**
   * Handle mat-checkbox / mat-slide-toggle: these are custom components
   * that wrap a hidden native checkbox. We click the component label or
   * the component root to toggle.
   */
  function toggleMatCheckbox(matEl) {
    // If already checked, skip
    const innerInput = matEl.querySelector('input[type="checkbox"]');
    if (innerInput && innerInput.checked) return false;

    // Click the label or the component itself
    const label = matEl.querySelector('label, .mdc-checkbox, .mdc-switch, .mat-mdc-slide-toggle-switch');
    if (label) {
      label.click();
    } else {
      matEl.click();
    }

    // Also mark via events
    if (innerInput) {
      innerInput.checked = true;
      dispatchAngularEvents(innerInput);
    }

    triggerAngularChangeDetection(matEl);
    return true;
  }

  /**
   * Handle mat-radio-group: select the first radio button in the group.
   */
  function selectMatRadio(matRadioGroup) {
    const firstRadio = matRadioGroup.querySelector('mat-radio-button, .mat-mdc-radio-button');
    if (firstRadio) {
      // Check if already selected
      const inner = firstRadio.querySelector('input[type="radio"]');
      if (inner && inner.checked) return false;

      const label = firstRadio.querySelector('label, .mdc-radio');
      if (label) {
        label.click();
      } else {
        firstRadio.click();
      }

      if (inner) {
        inner.checked = true;
        dispatchAngularEvents(inner);
      }

      triggerAngularChangeDetection(matRadioGroup);
      return true;
    }
    return false;
  }

  /**
   * Observe DOM for dynamically rendered Angular form fields.
   * Calls `callback` for each new form element added to the page.
   * Returns the MutationObserver instance so the caller can disconnect it.
   */
  function observeDynamicFields(callback) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node itself is a form element
            if (isFormElement(node)) {
              callback(node);
            }
            // Check descendants
            const formElements = node.querySelectorAll
              ? node.querySelectorAll(
                'input, select, textarea, mat-select, mat-checkbox, mat-radio-group, mat-slide-toggle'
              )
              : [];
            formElements.forEach(el => callback(el));
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  function isFormElement(node) {
    if (!node.tagName) return false;
    const tag = node.tagName.toLowerCase();
    return [
      'input', 'select', 'textarea',
      'mat-select', 'mat-checkbox', 'mat-radio-group', 'mat-slide-toggle'
    ].includes(tag);
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    setNativeValue,
    dispatchAngularEvents,
    triggerAngularChangeDetection,
    trySetViaAngularControl,
    setValueAndNotify,
    fillMatSelect,
    toggleMatCheckbox,
    selectMatRadio,
    observeDynamicFields,
    isFormElement,
  };
})();
