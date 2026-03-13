/**
 * Stealth patches for Playwright: consistent fingerprint + anti-detection init script.
 */

import type { Page } from 'playwright';

const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
const systemLanguages = [systemLocale, systemLocale.split('-')[0]];

export const FINGERPRINT = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  viewport: { width: 1920, height: 1080 },
  locale: systemLocale,
  timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  secChUa: '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
  secChUaPlatform: '"macOS"',
  secChUaMobile: '?0',
} as const;

export const EXTRA_HEADERS = {
  'Sec-Ch-Ua': FINGERPRINT.secChUa,
  'Sec-Ch-Ua-Mobile': FINGERPRINT.secChUaMobile,
  'Sec-Ch-Ua-Platform': FINGERPRINT.secChUaPlatform,
} as const;

const STEALTH_SCRIPT = `
  // --- navigator.webdriver → false ---
  Object.defineProperty(Navigator.prototype, 'webdriver', {
    get: () => false,
    configurable: true,
  });

  // --- navigator.platform → MacIntel ---
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });

  // --- window.chrome stub ---
  window.chrome = { runtime: {}, loadTimes: () => ({}) };

  // --- navigator.plugins — 3 realistic plugins (proper PluginArray) ---
  (function () {
    function makeMime(type, suffixes, desc, plugin) {
      var mt = Object.create(MimeType.prototype);
      Object.defineProperties(mt, {
        type:          { get: function() { return type; },    configurable: true },
        suffixes:      { get: function() { return suffixes; }, configurable: true },
        description:   { get: function() { return desc; },    configurable: true },
        enabledPlugin: { get: function() { return plugin; },  configurable: true },
      });
      return mt;
    }

    function makePlugin(name, desc, filename, mimes) {
      var p = Object.create(Plugin.prototype);
      Object.defineProperties(p, {
        name:        { get: function() { return name; },     configurable: true },
        description: { get: function() { return desc; },     configurable: true },
        filename:    { get: function() { return filename; }, configurable: true },
        length:      { get: function() { return mimes.length; }, configurable: true },
      });
      for (var i = 0; i < mimes.length; i++) {
        Object.defineProperty(p, i, { get: (function(m) { return function() { return m; }; })(mimes[i]), configurable: true });
      }
      p.item = function(idx) { return mimes[idx] || null; };
      p.namedItem = function(n) { return mimes.find(function(m) { return m.type === n; }) || null; };
      return p;
    }

    var pdf1Mime = null;
    var pdf1 = makePlugin('Chrome PDF Plugin', 'Portable Document Format', 'internal-pdf-viewer', []);
    pdf1Mime = makeMime('application/x-google-chrome-pdf', 'pdf', 'Portable Document Format', pdf1);
    Object.defineProperties(pdf1, {
      length: { get: function() { return 1; }, configurable: true },
      0:      { get: function() { return pdf1Mime; }, configurable: true },
    });
    pdf1.item = function(i) { return i === 0 ? pdf1Mime : null; };
    pdf1.namedItem = function(n) { return n === 'application/x-google-chrome-pdf' ? pdf1Mime : null; };

    var pdf2Mime = null;
    var pdf2 = makePlugin('Chrome PDF Viewer', '', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', []);
    pdf2Mime = makeMime('application/pdf', 'pdf', '', pdf2);
    Object.defineProperties(pdf2, {
      length: { get: function() { return 1; }, configurable: true },
      0:      { get: function() { return pdf2Mime; }, configurable: true },
    });
    pdf2.item = function(i) { return i === 0 ? pdf2Mime : null; };
    pdf2.namedItem = function(n) { return n === 'application/pdf' ? pdf2Mime : null; };

    var naclMime1 = null;
    var naclMime2 = null;
    var nacl = makePlugin('Native Client', '', 'internal-nacl-plugin', []);
    naclMime1 = makeMime('application/x-nacl', '', '', nacl);
    naclMime2 = makeMime('application/x-pnacl', '', '', nacl);
    Object.defineProperties(nacl, {
      length: { get: function() { return 2; }, configurable: true },
      0:      { get: function() { return naclMime1; }, configurable: true },
      1:      { get: function() { return naclMime2; }, configurable: true },
    });
    nacl.item = function(i) { return [naclMime1, naclMime2][i] || null; };
    nacl.namedItem = function(n) {
      if (n === 'application/x-nacl') return naclMime1;
      if (n === 'application/x-pnacl') return naclMime2;
      return null;
    };

    var list = [pdf1, pdf2, nacl];
    var pa = Object.create(PluginArray.prototype);
    Object.defineProperty(pa, 'length', { get: function() { return list.length; }, configurable: true });
    for (var i = 0; i < list.length; i++) {
      Object.defineProperty(pa, i, { get: (function(p) { return function() { return p; }; })(list[i]), configurable: true });
    }
    pa.item = function(idx) { return list[idx] || null; };
    pa.namedItem = function(name) { return list.find(function(p) { return p.name === name; }) || null; };
    pa.refresh = function() {};
    pa[Symbol.iterator] = function() { return list[Symbol.iterator](); };

    Object.defineProperty(navigator, 'plugins', { get: function() { return pa; }, configurable: true });
  })();

  // --- navigator.languages ---
  Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(systemLanguages)} });

  // --- Notification.permission → 'default' ---
  Object.defineProperty(Notification, 'permission', { get: () => 'default' });

  // --- navigator.permissions.query → always 'prompt' for notifications ---
  var origQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = function(desc) {
    if (desc && desc.name === 'notifications') {
      return Promise.resolve({ state: 'prompt', onchange: null });
    }
    return origQuery(desc);
  };

  // --- WebGL vendor/renderer spoofing (headless has no GPU) ---
  (function () {
    var getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';          // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
    var getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParam2.call(this, param);
    };
  })();
`;

export const applyStealthScripts = async (page: Page): Promise<void> => {
  await page.addInitScript(STEALTH_SCRIPT);
};
