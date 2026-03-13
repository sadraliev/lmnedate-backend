# Stealth Patches for Playwright

## Why `stealth.ts` exists

Playwright launches Chromium in automation mode. Instagram (and other sites) detect this through multiple signals and block access. The file `apps/scraper/src/stealth.ts` eliminates these leaks, disguising the automated browser as a regular user Chrome session.

## What Instagram detects

| Signal | What Instagram sees | After patch |
|--------|-------------------|-------------|
| `navigator.webdriver` | `true` | `false` |
| `window.chrome` | missing | `{ runtime: {}, loadTimes: () => ({}) }` |
| `navigator.plugins` | empty array (length 0) | 3 plugins (Chrome PDF Plugin, Chrome PDF Viewer, Native Client) |
| `navigator.plugins instanceof PluginArray` | `true`, but length 0 | `true`, length 3 |
| User-Agent | outdated or `HeadlessChrome` | Chrome/136 on macOS |
| `Sec-Ch-Ua` headers | missing | match Chrome version in UA |
| `navigator.languages` | may be empty | matches system locale |
| `Notification.permission` | `denied` (headless) | `default` |
| `navigator.permissions.query('notifications')` | `denied` | `prompt` |
| WebGL vendor/renderer | missing or SwiftShader | Intel Inc. / Intel Iris OpenGL Engine |
| Viewport | atypical (1280x900) | 1920x1080 |

## Module architecture

### `FINGERPRINT`

Single config object with browser context parameters:

```ts
FINGERPRINT.userAgent    // Chrome/136 on macOS
FINGERPRINT.viewport     // { width: 1920, height: 1080 }
FINGERPRINT.locale       // auto-detected from system (Intl API)
FINGERPRINT.timezoneId   // auto-detected from system (Intl API)
FINGERPRINT.secChUa      // Client Hints, matching Chrome version in UA
```

`locale` and `timezoneId` are determined automatically at process startup via `Intl.DateTimeFormat().resolvedOptions()`. This means a server in Europe will use `Europe/Berlin`, not a hardcoded `America/New_York`.

### `EXTRA_HEADERS`

Client Hints HTTP headers (`Sec-Ch-Ua`, `Sec-Ch-Ua-Mobile`, `Sec-Ch-Ua-Platform`), passed as `extraHTTPHeaders` to the Playwright context.

### `STEALTH_SCRIPT`

Init script injected via `page.addInitScript()` that runs **before** any page script. It patches:

1. **`navigator.webdriver`** — overridden on `Navigator.prototype` (not on the instance) to shadow the property set by Chromium.

2. **`navigator.platform`** — `'MacIntel'`, matching macOS in the User-Agent. Works on Linux hosts too.

3. **`window.chrome`** — stub with `runtime` and `loadTimes`, mimicking a real Chrome object.

4. **`navigator.plugins`** — full emulation via `Object.create(PluginArray.prototype)` with proper `Plugin` and `MimeType` objects. Passes `instanceof PluginArray` checks.

5. **`navigator.languages`** — array derived from system locale, e.g. `['en-US', 'en']`.

6. **`Notification.permission`** and **`navigator.permissions.query`** — return `'default'` / `'prompt'` instead of `'denied'` (headless default).

7. **WebGL vendor/renderer** — intercepts `getParameter()` on `WebGLRenderingContext` and `WebGL2RenderingContext`. Returns `Intel Inc.` / `Intel Iris OpenGL Engine` instead of SwiftShader.

### `applyStealthScripts(page)`

Helper that takes a Playwright `Page` and injects the `STEALTH_SCRIPT`:

```ts
import { applyStealthScripts } from './stealth.js';

const page = await context.newPage();
await applyStealthScripts(page);
```

## Usage

- **`scrape.ts`** — browser context for scraping Instagram profiles
- **`session.ts`** — browser context for login and session persistence

Both modules use the same `FINGERPRINT`, ensuring a **consistent fingerprint** between login and scraping. This matters because Instagram compares the login session fingerprint with subsequent requests.

## Chrome launch flags

In `scrape.ts`, the browser is launched with:

```ts
chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',  // removes automation flag
    '--enable-unsafe-swiftshader',                     // enables WebGL in headless
  ],
});
```

## Verification

All patches verified on [bot.sannysoft.com](https://bot.sannysoft.com/) — 0 failed checks out of 31 tests.

A verification script is available at `scripts/verify-stealth.ts`. It opens bot.sannysoft.com with all stealth patches applied and prints the results.

```bash
# Headed mode — opens a visible browser window for visual inspection
npx tsx --tsconfig apps/scraper/tsconfig.json scripts/verify-stealth.ts

# Headless mode — prints results to console and exits
npx tsx --tsconfig apps/scraper/tsconfig.json scripts/verify-stealth.ts --headless
```

## Updating the fingerprint

When a new major Chrome version is released, update:

1. `FINGERPRINT.userAgent` — Chrome version (currently 136)
2. `FINGERPRINT.secChUa` — version in Client Hints headers
3. WebGL vendor/renderer — if Intel Iris looks outdated
