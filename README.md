# Angular Form AutoFill — Chrome Extension

A Chrome extension that automatically detects and fills required form fields on Angular-powered pages with contextually appropriate test data. Supports Angular 7 through 17+, template-driven forms, reactive forms, and Angular Material components.

---

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `form-autofill-extension` folder (the folder containing `manifest.json`)
5. The extension icon will appear in your toolbar

---

## How to Use

### Option A — Popup Button
1. Navigate to any page with a form
2. Click the extension icon in the Chrome toolbar
3. (Optional) Toggle **"Fill all fields"** if you want to fill every field, not just required ones
4. Click **"Fill Required Fields"** (or "Fill All Fields")
5. A status message shows how many fields were filled

### Option B — Keyboard Shortcut
Press **`Alt + Shift + F`** on any page to instantly fill required fields.

> The shortcut respects the "required only vs all fields" toggle saved from the popup.

---

## Supported Field Types

| Field Type | Fill Value |
|---|---|
| `type="email"` | `test@example.com` |
| `type="tel"` | `+1234567890` |
| `type="password"` | `Password123!` |
| `type="number"` | `1` (or the field's `min` value) |
| `type="date"` / mat-datepicker | Today's date |
| `type="url"` | `https://example.com` |
| `<select>` / `<mat-select>` | First non-placeholder option |
| `<textarea>` | Contextual text based on field name |
| Checkbox / mat-checkbox | Checked |
| Radio / mat-radio | First option selected |
| mat-slide-toggle | Toggled to ON |
| `type="text"` | Inferred from context (see below) |

### Context-Aware Text Inference

For `type="text"` and generic inputs, the extension inspects the field's `name`, `id`, `placeholder`, `aria-label`, associated `<label>`, and Angular's `formControlName` attribute to choose an appropriate value:

| Context Detected | Value |
|---|---|
| Name-related | `John Doe` |
| Email-related | `test@example.com` |
| Phone-related | `+1234567890` |
| Address/street | `123 Main Street` |
| City | `New York` |
| State | `NY` |
| Zip/postal code | `10001` |
| Country | `United States` |
| Company/org | `Acme Corp` |
| URL/website | `https://example.com` |
| Default fallback | `Test Value` |

---

## How to Customize Fill Data

All fill values are defined in **`content.js`** in two places:

1. **`inferTextValue(hint)`** — edit the regex patterns and return values to change text field defaults
2. **`fillInput(element)`** — edit the `switch` statement to change values for specific input types (email, password, etc.)

For example, to change the default email:
```js
// In fillInput(), find:
case 'email':
  value = 'test@example.com';
  break;
// Change to:
case 'email':
  value = 'myemail@company.com';
  break;
```

---

## Angular Version Compatibility

| Angular Version | Support Level | Notes |
|---|---|---|
| 7–8 | Full | Uses `ng.probe()` for pre-Ivy debug API |
| 9–12 | Full | Uses `ng.getDirectives()` / `ng.applyChanges()` (Ivy) |
| 13–17+ | Full | Ivy-only; native setter + event dispatch works reliably |

### How Angular Detection Works

The extension uses multiple strategies layered for maximum compatibility:

1. **Native value setter** — bypasses Angular's `ControlValueAccessor` wrappers by calling the HTMLInputElement prototype's setter directly
2. **Synthetic events** — dispatches `input`, `change`, `focus`, `blur` events that Angular's default listeners capture
3. **Angular control API** — attempts to call `control.setValue()` via `ng.getDirectives()` (Ivy) or `ng.probe()` (pre-Ivy) for direct model updates
4. **Zone.js change detection** — triggers a microtask (`Promise.resolve()`) that Zone.js intercepts to run change detection
5. **MutationObserver** — watches for dynamically added form fields so lazy-loaded Angular components are detected

---

## File Structure

```
form-autofill-extension/
├── manifest.json              # Manifest V3 configuration
├── background.js              # Service worker — handles keyboard shortcut
├── content.js                 # Content script — field detection & filling
├── popup.html                 # Extension popup UI
├── popup.js                   # Popup logic & communication
├── utils/
│   └── angular-helper.js      # Angular-specific change detection helpers
├── icons/
│   ├── icon16.png             # 16x16 toolbar icon
│   ├── icon48.png             # 48x48 extension page icon
│   └── icon128.png            # 128x128 Chrome Web Store icon
└── README.md                  # This file
```

---

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab to inject/communicate with content scripts |
| `scripting` | Programmatically inject content scripts when the shortcut is used |
| `storage` | Save user's "required only" toggle preference |

---

## Troubleshooting

- **Fields not filling?** — The extension skips fields that already have values, are hidden, disabled, or readonly. In "required only" mode, only fields detected as required are filled.
- **Angular Material dropdowns not working?** — mat-select requires a 300ms delay for the overlay animation. If your app has slower animations, increase the timeout in `angular-helper.js` → `fillMatSelect()`.
- **Production Angular app not triggering change detection?** — The `ng` debug API is only available in dev mode. For production apps, the extension relies on native setter + event dispatch, which works for the vast majority of Angular apps.
- **Shortcut not working?** — Check `chrome://extensions/shortcuts` to ensure `Alt+Shift+F` isn't conflicting with another extension.
