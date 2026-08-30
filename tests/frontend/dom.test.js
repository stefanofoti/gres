'use strict';

/*
 * Loads the real frontend/index.html + frontend/js/app.js into JSDOM and
 * drives the app the way a browser would: clicking tabs, calling the
 * window._-exposed public API, reading back DOM state. app.js runs its
 * IIFEs immediately at script-evaluation time (no DOMContentLoaded gate —
 * intentional, since <script src="js/app.js"> sits at the end of <body> in
 * index.html), so the DOM must be populated *before* the module is required.
 */

var fs = require('fs');
var path = require('path');
var mockXhrHelper = require('./helpers/mockXHR');

var INDEX_HTML_PATH = path.join(__dirname, '../../frontend/index.html');
var APP_JS_PATH = path.join(__dirname, '../../frontend/js/app.js');

var fullHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
var bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
var BODY_HTML = bodyMatch ? bodyMatch[1] : fullHtml;

function flush() {
  jest.advanceTimersByTime(100);
  return Promise.resolve();
}

function loadApp(routeHandler) {
  document.documentElement.className = '';
  document.body.innerHTML = BODY_HTML;
  try { window.localStorage.clear(); } catch (e) { /* ignore */ }

  mockXhrHelper.installMockXHR(routeHandler || mockXhrHelper.defaultRouteHandler);

  /* Plain `delete require.cache[...]` doesn't actually bust Jest's own
     module registry (see tests/helpers/tempWorkdir.js for the long-form
     explanation) — only jest.resetModules() does, so that's required here
     to get app.js's IIFEs (and their module-scoped state, e.g. pinValue,
     settingsUnlocked, protectedEntities) to genuinely re-run per test. */
  jest.resetModules();
  require(APP_JS_PATH);
}

beforeEach(function () { jest.useFakeTimers(); });
afterEach(function () {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('bootstrap', function () {
  test('exposes the documented window._ public API used by other on-page modules', function () {
    loadApp();
    return flush().then(function () {
      expect(typeof window._xhr).toBe('function');
      expect(typeof window._toast).toBe('function');
      expect(typeof window._showPage).toBe('function');
      expect(typeof window._openPinPrompt).toBe('function');
      expect(typeof window._isDeviceLocked).toBe('function');
      expect(typeof window._setDeviceLocked).toBe('function');
      expect(typeof window._guardDeviceAction).toBe('function');
    });
  });

  test('the home page is active by default and other pages are not', function () {
    loadApp();
    return flush().then(function () {
      expect(document.getElementById('page-home').classList.contains('active')).toBe(true);
      expect(document.getElementById('page-smarthome').classList.contains('active')).toBe(false);
    });
  });
});

describe('tab navigation', function () {
  test('clicking a tab activates its page and deactivates the others', function () {
    loadApp();
    return flush().then(function () {
      var smarthomeTab = document.querySelector('[data-page="smarthome"]');
      smarthomeTab.click();
      expect(document.getElementById('page-smarthome').classList.contains('active')).toBe(true);
      expect(document.getElementById('page-home').classList.contains('active')).toBe(false);
      expect(smarthomeTab.classList.contains('active')).toBe(true);
    });
  });

  test('the Settings tab opens the PIN overlay instead of the page when a PIN is required', function () {
    loadApp(function (method, url) {
      if (url.indexOf('scope=settings') !== -1) return { status: 200, body: { required: true, length: 4 } };
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('page-settings').classList.contains('active')).toBe(false);
    });
  });

  test('the Settings tab shows the page directly when no PIN is configured', function () {
    loadApp(); // default handler: pin-status required:false for every scope
    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      expect(document.getElementById('page-settings').classList.contains('active')).toBe(true);
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(true);
    });
  });
});

describe('PIN entry flow', function () {
  test('typing the correct number of digits auto-submits and unlocks on success', function () {
    loadApp(function (method, url) {
      if (url.indexOf('/api/auth/pin-status') !== -1) return { status: 200, body: { required: true, length: 4 } };
      if (url.indexOf('/api/auth/verify-pin') !== -1) return { status: 200, body: { ok: true } };
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(false);

      var keys = document.querySelectorAll('#pin-keypad [data-digit]');
      expect(keys.length).toBeGreaterThan(0);
      for (var i = 0; i < 4; i++) keys[i % keys.length].click();

      return flush();
    }).then(function () {
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('page-settings').classList.contains('active')).toBe(true);
    });
  });
});

describe('toast()', function () {
  test('shows a message immediately, then auto-hides after the given duration', function () {
    loadApp();
    return flush().then(function () {
      window._toast('Saved', 500);
      var toastEl = document.getElementById('toast');
      expect(toastEl.textContent).toBe('Saved');
      expect(toastEl.classList.contains('show')).toBe(true);

      jest.advanceTimersByTime(500);
      expect(toastEl.classList.contains('show')).toBe(false);

      jest.advanceTimersByTime(300);
      expect(toastEl.classList.contains('hidden')).toBe(true);
    });
  });
});

describe('device lock API (window._isDeviceLocked / _setDeviceLocked / _guardDeviceAction)', function () {
  test('a device is unlocked by default', function () {
    loadApp();
    return flush().then(function () {
      expect(window._isDeviceLocked('light.kitchen')).toBe(false);
    });
  });

  test('_setDeviceLocked toggles the lock state', function () {
    loadApp();
    return flush().then(function () {
      window._setDeviceLocked('light.kitchen', true);
      expect(window._isDeviceLocked('light.kitchen')).toBe(true);
      window._setDeviceLocked('light.kitchen', false);
      expect(window._isDeviceLocked('light.kitchen')).toBe(false);
    });
  });

  test('_guardDeviceAction runs the action immediately when the device is unlocked', function () {
    loadApp();
    return flush().then(function () {
      var called = false;
      window._guardDeviceAction('light.kitchen', function () { called = true; });
      expect(called).toBe(true);
    });
  });

  test('_guardDeviceAction opens the devices-scope PIN prompt when locked, without running the action yet', function () {
    loadApp(function (method, url) {
      if (url.indexOf('scope=devices') !== -1) return { status: 200, body: { required: true, length: 4 } };
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      window._setDeviceLocked('light.kitchen', true);
      var called = false;
      window._guardDeviceAction('light.kitchen', function () { called = true; });
      expect(called).toBe(false);
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('pin-title').textContent).toBe('Locked device');
    });
  });
});

describe('settings load (GET /api/settings)', function () {
  test('populates the HA form fields and fans out to registered module callbacks', function () {
    loadApp(function (method, url) {
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        return {
          status: 200,
          body: { ha_url: 'http://ha.local:8123', ha_token: 'tok123', ha_protected_entities: ['light.kitchen'] }
        };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      expect(document.getElementById('ha-url').value).toBe('http://ha.local:8123');
      expect(document.getElementById('ha-token').value).toBe('tok123');
      /* the device-lock module registers via window._onSettingsLoad */
      expect(window._isDeviceLocked('light.kitchen')).toBe(true);
    });
  });
});

describe('appearance module (theme + status bar, persisted via localStorage)', function () {
  test('defaults to dark theme with the status bar visible', function () {
    loadApp();
    return flush().then(function () {
      expect(document.documentElement.className.indexOf('light')).toBe(-1);
      expect(document.getElementById('status-bar').classList.contains('hidden-bar')).toBe(false);
    });
  });

  test('clicking the theme toggle switches to light and persists the choice', function () {
    loadApp();
    return flush().then(function () {
      document.getElementById('toggle-light-theme').click();
      expect(document.documentElement.className.indexOf('light') !== -1).toBe(true);
      expect(window.localStorage.getItem('gres_theme')).toBe('light');
    });
  });

  test('clicking the status-bar toggle hides it and persists the choice', function () {
    loadApp();
    return flush().then(function () {
      document.getElementById('toggle-status-bar').click();
      expect(document.getElementById('status-bar').classList.contains('hidden-bar')).toBe(true);
      expect(window.localStorage.getItem('gres_statusbar')).toBe('hidden');
    });
  });
});
