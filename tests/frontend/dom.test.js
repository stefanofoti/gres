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
var WIDGETS_JS_PATH = path.join(__dirname, '../../frontend/js/widgets.js');
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

  /* A browser gets a fresh window per load; jsdom reuses one across every
     loadApp() in the file, so the window._* globals the app writes have
     to be cleared by hand. Two of them genuinely change behaviour if they
     survive: _settingsCallbacks accumulates one registration per previous
     load, and a stale _currentPage from an earlier tab-click test makes
     the HOME module skip rendering (it only re-renders while Home is the
     visible tab). */
  window._settingsCallbacks = [];
  window._currentPage = undefined;
  window._WIDGETS = undefined;

  mockXhrHelper.installMockXHR(routeHandler || mockXhrHelper.defaultRouteHandler);

  /* Plain `delete require.cache[...]` doesn't actually bust Jest's own
     module registry (see tests/helpers/tempWorkdir.js for the long-form
     explanation) — only jest.resetModules() does, so that's required here
     to get app.js's IIFEs (and their module-scoped state, e.g. pinValue,
     settingsUnlocked, protectedEntities) to genuinely re-run per test. */
  jest.resetModules();
  /* Same order as index.html: widgets.js defines window._WIDGETS and must
     be evaluated before app.js's HOME module reads the registry. */
  require(WIDGETS_JS_PATH);
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

describe('settings load', function () {
  /*
   * Since 0.0.9 the boot-time read carries public UI state only, and the
   * credential forms are filled from a separate scoped read that reports each
   * token as set or unset without ever carrying its value.
   */

  test('the public read fans out to registered module callbacks', function () {
    loadApp(function (method, url) {
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        return {
          status: 200,
          body: { ha_protected_entities: ['light.kitchen'] }
        };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      /* the device-lock module registers via window._onSettingsLoad */
      expect(window._isDeviceLocked('light.kitchen')).toBe(true);
    });
  });

  test('the boot read does not request the scoped admin endpoint', function () {
    var asked = [];
    loadApp(function (method, url) {
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        asked.push(url);
        return { status: 200, body: {} };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      /* Nothing outside the Settings forms needs it, and asking for it on
         every page load would prompt for a PIN the user has not asked for. */
      expect(asked.length).toBeGreaterThan(0);
      asked.forEach(function (u) {
        expect(u.indexOf('/api/settings/admin')).toBe(-1);
      });
    });
  });

  test('the admin read fills the URL fields and masks the credentials', function () {
    loadApp(function (method, url) {
      if (method === 'GET' && url.indexOf('/api/settings/admin') !== -1) {
        return {
          status: 200,
          body: {
            ha_url: 'http://ha.local:8123',
            jf_url: 'http://jf.local:8096',
            px_url: 'https://px.local:8006',
            px_tokenid: 'root@pam!panel',
            ha_token_set: true,
            jf_token_set: true,
            px_token_set: false
          }
        };
      }
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        return { status: 200, body: {} };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });

    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      return flush();
    }).then(function () {
      expect(document.getElementById('ha-url').value).toBe('http://ha.local:8123');
      expect(document.getElementById('jf-url').value).toBe('http://jf.local:8096');
      expect(document.getElementById('px-tokenid').value).toBe('root@pam!panel');

      /* A stored token is shown as a placeholder, never as a value. */
      expect(document.getElementById('ha-token').value).toBe('');
      expect(document.getElementById('ha-token').placeholder).toContain('saved');
      expect(document.getElementById('jf-token').placeholder).toContain('saved');

      /* An unset one keeps its original prompt. */
      expect(document.getElementById('px-token').placeholder).not.toContain('saved');
    });
  });

  test('saving with an untouched token field omits the token from the body', function () {
    var posted = null;
    loadApp(function (method, url, body) {
      if (method === 'GET' && url.indexOf('/api/settings/admin') !== -1) {
        return { status: 200, body: { ha_url: 'http://ha.local:8123', ha_token_set: true } };
      }
      if (method === 'POST' && url.indexOf('/api/settings') !== -1) {
        /* window._xhr sends a JSON string, not an object. */
        posted = JSON.parse(body);
        return { status: 200, body: { success: true, settings: {} } };
      }
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        return { status: 200, body: {} };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });

    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      return flush();
    }).then(function () {
      document.getElementById('btn-save-ha').click();
      return flush();
    }).then(function () {
      /* Leaving the field empty means "keep what is stored" — sending an
         empty string would wipe a working token. */
      expect(posted).not.toBeNull();
      expect(posted.ha_url).toBe('http://ha.local:8123');
      expect(posted).not.toHaveProperty('ha_token');
    });
  });

  test('saving a typed token does include it', function () {
    var posted = null;
    loadApp(function (method, url, body) {
      if (method === 'GET' && url.indexOf('/api/settings/admin') !== -1) {
        return { status: 200, body: { ha_url: 'http://ha.local:8123', ha_token_set: true } };
      }
      if (method === 'POST' && url.indexOf('/api/settings') !== -1) {
        /* window._xhr sends a JSON string, not an object. */
        posted = JSON.parse(body);
        return { status: 200, body: { success: true, settings: {} } };
      }
      if (method === 'GET' && url.indexOf('/api/settings') !== -1) {
        return { status: 200, body: {} };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });

    return flush().then(function () {
      document.querySelector('[data-page="settings"]').click();
      return flush();
    }).then(function () {
      document.getElementById('ha-token').value = 'a-new-token';
      document.getElementById('btn-save-ha').click();
      return flush();
    }).then(function () {
      expect(posted.ha_token).toBe('a-new-token');
    });
  });
});

describe('FEATURES module: window._xhr gate applies to background HA polling', function () {
  /*
   * checkHA() used to call the top module's local `xhr` closure instead of
   * window._xhr, so disabling "Smart Home" in Settings never stopped its
   * 30s background poll of /api/ha/status — the one thing the FEATURES
   * module's window._xhr wrapper (installed after boot) is supposed to
   * block. This asserts the poll actually stops once the wrapper is live
   * and the feature is off, and keeps running when it's on.
   */
  function countHAStatusCalls(featuresDisabled) {
    var calls = 0;
    loadApp(function (method, url, body) {
      if (method === 'GET' && url.indexOf('/api/ha/status') !== -1) {
        calls++;
        return { status: 200, body: { connected: true } };
      }
      if (method === 'GET' && url.indexOf('/api/settings') !== -1 && url.indexOf('/admin') === -1) {
        return { status: 200, body: { features_disabled: featuresDisabled } };
      }
      return mockXhrHelper.defaultRouteHandler(method, url, body);
    });

    return flush().then(function () {
      /* Settings have now loaded and the FEATURES wrapper is installed;
         only calls from here on exercise the gate. */
      calls = 0;
      jest.advanceTimersByTime(30000);
      return flush();
    }).then(function () { return calls; });
  }

  test('disabling Smart Home stops the HA status poll', function () {
    return countHAStatusCalls(['smarthome']).then(function (calls) {
      expect(calls).toBe(0);
    });
  });

  test('an enabled Smart Home keeps polling', function () {
    return countHAStatusCalls([]).then(function (calls) {
      expect(calls).toBeGreaterThan(0);
    });
  });
});

describe('server-scope guard on Proxmox power actions', function () {
  /*
   * The backend gates node power and VM lifecycle on the 'server' scope. The
   * frontend has to ask for that PIN first, or a configured SERVER_PIN turns
   * every action button into a 401 with no way for the user to authenticate.
   */

  test('_guardServerAction runs the action straight through when no PIN is set', function () {
    loadApp();
    return flush().then(function () {
      var ran = false;
      window._guardServerAction('VM stop', function () { ran = true; });
      return flush();
    }).then(function () {
      expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(true);
    });
  });

  test('_guardServerAction prompts for the PIN when the scope is protected', function () {
    loadApp(function (method, url) {
      if (url.indexOf('/api/auth/pin-status') !== -1 && url.indexOf('scope=server') !== -1) {
        return { status: 200, body: { required: true, length: 4 } };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      var ran = false;
      window._guardServerAction('Shut down node', function () { ran = true; });
      return flush().then(function () {
        expect(ran).toBe(false);
        expect(document.getElementById('pin-overlay').classList.contains('hidden')).toBe(false);
        expect(document.getElementById('pin-title').textContent).toBe('Shut down node');
      });
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

/*
 * The Home widget grid. plan() is the piece that has to be forgiving:
 * `markets` and `server` entries were writable from Settings long before
 * anything rendered them, so real settings.json files in the wild already
 * contain entries an older build ignored — and a future one might add
 * types this build has never heard of.
 */
describe('widget registry (window._WIDGETS)', function () {
  function withWidgets(widgets) {
    return function (method, url, body) {
      if (url.indexOf('/api/settings') !== -1 && method === 'GET') {
        return { status: 200, body: { home_widgets: widgets } };
      }
      if (url.indexOf('/api/ha/devices') !== -1) {
        return { status: 200, body: { entities: [], summary: { total: 0, active: 0 } } };
      }
      if (url.indexOf('/api/weather/home-summary') !== -1) {
        return { status: 200, body: {
          location: { name: 'Milano' },
          current: { temp: 7, weatherCode: 3, isDay: 1 },
          today: { tempMax: 9, tempMin: 2, precipProb: 20 },
          hourly: [], daily: []
        } };
      }
      if (url.indexOf('/api/jf/home-summary') !== -1) {
        return { status: 200, body: { totalMovies: 3, totalSeries: 1, recentMovies: [] } };
      }
      if (url.indexOf('/api/px/home-summary') !== -1) {
        return { status: 200, body: {
          nodes: [{ node: 'pve1', status: 'online', uptime: 100, cpu: 0.1, maxcpu: 4,
                    mem: 1, maxmem: 2, disk: 1, maxdisk: 2, vmsRunning: 1, vmsStopped: 0 }],
          totals: { nodes: 1, online: 1, vmsRunning: 1, vmsStopped: 0 }
        } };
      }
      if (url.indexOf('/api/markets/favorites') !== -1) {
        return { status: 200, body: { items: [
          { symbol: 'AAPL', name: 'Apple Inc.', price: 232.14, change: 1.24, changePercent: 0.53 }
        ] } };
      }
      return mockXhrHelper.defaultRouteHandler(method, url, body);
    };
  }

  function grid() { return document.getElementById('home-widgets'); }
  function cards() { return grid().querySelectorAll('.w-card'); }

  test('registers a definition for every type Settings can write', function () {
    loadApp();
    return flush().then(function () {
      ['smarthome', 'meteo', 'jelly', 'markets', 'server'].forEach(function (type) {
        expect(window._WIDGETS.has(type)).toBe(true);
      });
    });
  });

  test('renders one card per widget, in saved order', function () {
    loadApp(withWidgets([
      { type: 'meteo', id: 'weather', label: 'Weather widget' },
      { type: 'jelly', id: 'jellyfin', label: 'Jellyfin widget' }
    ]));
    return flush().then(function () {
      var titles = grid().querySelectorAll('.w-title');
      expect(titles).toHaveLength(2);
      expect(titles[0].textContent).toBe('Weather');
      expect(titles[1].textContent).toBe('Jellyfin');
    });
  });

  test('collapses every pinned smart-home entity into a single card', function () {
    loadApp(withWidgets([
      { type: 'smarthome', id: 'light.a', label: 'A' },
      { type: 'smarthome', id: 'light.b', label: 'B' },
      { type: 'smarthome', id: 'switch.c', label: 'C' }
    ]));
    return flush().then(function () {
      expect(cards()).toHaveLength(1);
      expect(grid().querySelector('.w-title').textContent).toBe('Smart Home');
      /* all three still render, as tiles inside that one card */
      expect(grid().querySelectorAll('.device-card')).toHaveLength(3);
    });
  });

  test('renders the Proxmox and Markets widgets that Settings could already add', function () {
    loadApp(withWidgets([
      { type: 'server', id: 'server', label: 'Server widget' },
      { type: 'markets', id: 'AAPL', label: 'Apple Inc. (AAPL)' }
    ]));
    return flush().then(function () {
      var titles = [];
      var found = grid().querySelectorAll('.w-title');
      for (var i = 0; i < found.length; i++) titles.push(found[i].textContent);
      expect(titles).toEqual(['Proxmox', 'Markets']);
    });
  });

  test('skips an unrecognised type instead of throwing', function () {
    loadApp(withWidgets([
      { type: 'meteo', id: 'weather', label: 'Weather widget' },
      { type: 'from-the-future', id: 'x', label: 'Unknown' }
    ]));
    return flush().then(function () {
      expect(cards()).toHaveLength(1);
      expect(grid().querySelector('.w-title').textContent).toBe('Weather');
    });
  });

  test('shows the empty state when nothing is configured', function () {
    loadApp(withWidgets([]));
    return flush().then(function () {
      expect(cards()).toHaveLength(0);
      expect(document.getElementById('home-empty').classList.contains('visible')).toBe(true);
    });
  });

  test('a widget that throws degrades to an error card, leaving the others intact', function () {
    loadApp(withWidgets([
      { type: 'meteo', id: 'weather', label: 'Weather widget' },
      { type: 'jelly', id: 'jellyfin', label: 'Jellyfin widget' }
    ]));
    return flush().then(function () {
      /* Re-render with one definition sabotaged. */
      var jelly = window._WIDGETS.get('jelly');
      var realRender = jelly.render;
      jelly.render = function () { throw new Error('boom'); };
      try {
        window._homeRefresh();
        expect(cards()).toHaveLength(2);
        expect(cards()[1].querySelector('.w-msg').textContent).toContain('failed');
        /* the neighbour is untouched */
        expect(cards()[0].querySelector('.w-title').textContent).toBe('Weather');
      } finally {
        jelly.render = realRender;
      }
    });
  });
});

/*
 * The Weather tab. The property worth locking down is that no label is
 * computed from a Date: /api/weather/forecast sends `clock`, `weekday`
 * and `sunriseTime` already formatted, because iOS 9 WebKit reads a
 * timezone-less ISO string as UTC (the ES5 rule) and would shift every
 * hour by the location's offset. These tests assert the pre-formatted
 * strings arrive on screen verbatim.
 */
describe('weather tab', function () {
  var LOCATION = {
    name: 'Milano', admin1: 'Lombardia', country: 'Italia',
    latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome'
  };

  /* In the real payload `today` IS `days[0]` — the route builds the list
     once and points `today` at its first entry — so the stub does the
     same rather than letting the two drift apart. */
  var DAY_0 = {
    date: '2026-08-30', weekday: 'Sun', dateLabel: 'Sunday, 30 August',
    weatherCode: 3, tempMax: 30, tempMin: 20,
    feelsMax: 32, feelsMin: 19, precipProb: 0, precipSum: 0,
    uvIndexMax: 7.4, windMax: 9.4, windDir: 218,
    daylightHours: 13.4, sunshineHours: 11.2,
    sunriseTime: '06:42', sunsetTime: '20:05',
    sunriseMin: 402, sunsetMin: 1205
  };

  var DAY_1 = {
    date: '2026-08-31', weekday: 'Mon', dateLabel: 'Monday, 31 August',
    weatherCode: 2, tempMax: 40, tempMin: 30,
    feelsMax: 43, feelsMin: 29, precipProb: 55, precipSum: 3.4,
    uvIndexMax: 5.1, windMax: 18.7, windDir: 90,
    daylightHours: 13.3, sunshineHours: 4.1,
    sunriseTime: '06:43', sunsetTime: '20:03',
    sunriseMin: 403, sunsetMin: 1203
  };

  var FORECAST = {
    current: {
      time: '2026-08-30T09:45', temperature_2m: 23.7, apparent_temperature: 25.4,
      relative_humidity_2m: 59, is_day: 1, weather_code: 0,
      wind_speed_10m: 2.9, wind_direction_10m: 218,
      surface_pressure: 1014.2, cloud_cover: 12
    },
    currentTime: '09:45',
    currentMin: 585,
    today: DAY_0,
    tomorrow: DAY_1,
    days: [DAY_0, DAY_1],
    hourly: [
      { time: '2026-08-30T10:00', hour: 10, clock: '10:00', temp: 24, feelsLike: 26, weatherCode: 0, precipProb: 16, wind: 5, humidity: 60, isDay: 1 },
      { time: '2026-08-30T11:00', hour: 11, clock: '11:00', temp: 26, feelsLike: 28, weatherCode: 0, precipProb: 4,  wind: 6, humidity: 58, isDay: 1 },
      { time: '2026-08-30T22:00', hour: 22, clock: '22:00', temp: 19, feelsLike: 18, weatherCode: 3, precipProb: 40, wind: 4, humidity: 70, isDay: 0 }
    ],
    hoursByDate: {
      '2026-08-30': [
        { clock: '00:00', temp: 21, weatherCode: 3, precipProb: 0, isDay: 0 },
        { clock: '01:00', temp: 21, weatherCode: 3, precipProb: 0, isDay: 0 }
      ],
      '2026-08-31': [
        { clock: '00:00', temp: 31, weatherCode: 2, precipProb: 20, isDay: 0 },
        { clock: '12:00', temp: 39, weatherCode: 2, precipProb: 55, isDay: 1 },
        { clock: '13:00', temp: 40, weatherCode: 2, precipProb: 55, isDay: 1 }
      ]
    }
  };

  function weatherRoutes(overrides) {
    var forecast = overrides === undefined ? FORECAST : overrides;
    return function (method, url, body) {
      if (url.indexOf('/api/settings') !== -1 && method === 'GET') {
        return { status: 200, body: { weather_default_location: LOCATION } };
      }
      if (url.indexOf('/api/weather/forecast') !== -1) {
        return forecast === null
          ? { status: 502, body: { error: 'upstream down' } }
          : { status: 200, body: forecast };
      }
      return mockXhrHelper.defaultRouteHandler(method, url, body);
    };
  }

  function openWeather() {
    document.querySelector('[data-page="meteo"]').click();
    jest.advanceTimersByTime(200);
    return Promise.resolve().then(function () {
      jest.advanceTimersByTime(200);
    });
  }

  test('renders hero, hourly strip, metric tiles and the 10-day list', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      expect(document.getElementById('weather-content').classList.contains('hidden')).toBe(false);
      expect(document.querySelectorAll('#wx-hours .wx-hour')).toHaveLength(3);
      expect(document.querySelectorAll('#wx-metrics .wx-metric')).toHaveLength(8);
      expect(document.querySelectorAll('#wx-days .wx-day')).toHaveLength(2);
      expect(document.querySelector('.wx-hero-temp').textContent).toBe('24°');
      expect(document.querySelector('.wx-hero-cond').textContent).toBe('Clear');
      expect(document.querySelector('.wx-hero-feels').textContent).toBe('Feels like 25°');
    });
  });

  test('prints the pre-formatted clock labels and never derives them', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      var labels = document.querySelectorAll('#wx-hours .wx-hour-label');
      /* the hour we are already in reads "Now", the rest use the
         server's own strings */
      expect(labels[0].textContent).toBe('Now');
      expect(labels[1].textContent).toBe('11:00');
      expect(labels[2].textContent).toBe('22:00');
      expect(document.querySelector('.wx-hero-updated').textContent).toBe('as of 09:45');
      expect(document.querySelectorAll('#wx-days .wx-day-name')[1].textContent).toBe('Mon');
    });
  });

  test('marks daylight hours so the strip shows where night starts', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      var hours = document.querySelectorAll('#wx-hours .wx-hour');
      expect(hours[0].className).toContain('is-day');
      expect(hours[2].className).not.toContain('is-day');
    });
  });

  test('hides precipitation below 10% instead of printing a row of zeroes', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      var precip = document.querySelectorAll('#wx-hours .wx-hour-precip');
      expect(precip[0].textContent).toBe('16%');
      expect(precip[1].textContent).toBe('');   // 4% — below the threshold
      expect(precip[2].textContent).toBe('40%');
    });
  });

  /* The bars are only comparable because every row is drawn against the
     same span; this pins that arithmetic down. */
  test('scales every day bar against the shared 10-day range', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      /* span is 20..40, so 20 degrees wide */
      var fills = document.querySelectorAll('#wx-days .wx-day-bar-fill');
      expect(fills[0].style.left).toBe('0%');    // day 1: 20 -> 30
      expect(fills[0].style.width).toBe('50%');
      expect(fills[1].style.left).toBe('50%');   // day 2: 30 -> 40
      expect(fills[1].style.width).toBe('50%');

      /* current temp 23.7 sits at (23.7-20)/20 = 18.5% on today's row */
      var now = document.querySelector('#wx-days .wx-day-bar-now');
      expect(now).not.toBeNull();
      expect(parseFloat(now.style.left)).toBeCloseTo(18.5, 1);
    });
  });

  test('places the sun-arc marker at the current point of the day', function () {
    loadApp(weatherRoutes());
    return flush().then(openWeather).then(function () {
      /* 09:45 = 585 min, between sunrise 402 and sunset 1205 */
      var marker = document.querySelector('.wx-arc-marker');
      expect(marker).not.toBeNull();
      expect(parseFloat(marker.style.left)).toBeCloseTo((585 - 402) / (1205 - 402) * 100, 1);
    });
  });

  test('reports a failed forecast without wiping the tab', function () {
    loadApp(weatherRoutes(null));
    return flush().then(openWeather).then(function () {
      expect(document.getElementById('weather-error').classList.contains('hidden')).toBe(false);
      expect(document.getElementById('weather-error-msg').textContent).toBeTruthy();
    });
  });
});

/*
 * The day browser: tapping a row in the 10-day list re-points the
 * reference-day bar, hero, hourly strip and metric tiles at that day,
 * without refetching. Today (index 0) is the only day with live "now"
 * data, so the live-only affordances must disappear on any other day
 * rather than rendering at position zero and reading as real.
 */
describe('weather day browser', function () {
  var LOCATION = {
    name: 'Milano', admin1: 'Lombardia', country: 'Italia',
    latitude: 45.46, longitude: 9.19, timezone: 'Europe/Rome'
  };

  var fetchCount;

  function routes(forecast) {
    return function (method, url, body) {
      if (url.indexOf('/api/settings') !== -1 && method === 'GET') {
        return { status: 200, body: { weather_default_location: LOCATION } };
      }
      if (url.indexOf('/api/weather/forecast') !== -1) {
        fetchCount++;
        return { status: 200, body: forecast };
      }
      return mockXhrHelper.defaultRouteHandler(method, url, body);
    };
  }

  function openWeather() {
    document.querySelector('[data-page="meteo"]').click();
    jest.advanceTimersByTime(200);
    return Promise.resolve().then(function () { jest.advanceTimersByTime(200); });
  }

  function rows() { return document.querySelectorAll('#wx-days .wx-day'); }

  /* Reuse the payload the weather-tab suite above already defines by
     rebuilding it here — kept local so the two suites stay independent. */
  var PAYLOAD;
  beforeEach(function () {
    fetchCount = 0;
    PAYLOAD = JSON.parse(JSON.stringify({
      current: {
        time: '2026-08-30T09:45', temperature_2m: 23.7, apparent_temperature: 25.4,
        relative_humidity_2m: 59, is_day: 1, weather_code: 0,
        wind_speed_10m: 2.9, wind_direction_10m: 218,
        surface_pressure: 1014.2, cloud_cover: 12
      },
      currentTime: '09:45', currentMin: 585,
      days: [
        { date: '2026-08-30', weekday: 'Sun', dateLabel: 'Sunday, 30 August',
          weatherCode: 3, tempMax: 30, tempMin: 20, feelsMax: 32, feelsMin: 19,
          precipProb: 0, precipSum: 0, uvIndexMax: 7.4, windMax: 9.4, windDir: 218,
          daylightHours: 13.4, sunshineHours: 11.2,
          sunriseTime: '06:42', sunsetTime: '20:05', sunriseMin: 402, sunsetMin: 1205 },
        { date: '2026-08-31', weekday: 'Mon', dateLabel: 'Monday, 31 August',
          weatherCode: 2, tempMax: 40, tempMin: 30, feelsMax: 43, feelsMin: 29,
          precipProb: 55, precipSum: 3.4, uvIndexMax: 5.1, windMax: 18.7, windDir: 90,
          daylightHours: 13.3, sunshineHours: 4.1,
          sunriseTime: '06:43', sunsetTime: '20:03', sunriseMin: 403, sunsetMin: 1203 }
      ],
      hourly: [
        { time: '2026-08-30T10:00', hour: 10, clock: '10:00', temp: 24, feelsLike: 26, weatherCode: 0, precipProb: 16, wind: 5, humidity: 60, isDay: 1 }
      ],
      hoursByDate: {
        '2026-08-30': [{ clock: '00:00', temp: 21, weatherCode: 3, precipProb: 0, isDay: 0 }],
        '2026-08-31': [
          { clock: '00:00', temp: 31, weatherCode: 2, precipProb: 20, isDay: 0 },
          { clock: '12:00', temp: 39, weatherCode: 2, precipProb: 55, isDay: 1 },
          { clock: '13:00', temp: 40, weatherCode: 2, precipProb: 55, isDay: 1 }
        ]
      }
    }));
    PAYLOAD.today = PAYLOAD.days[0];
    PAYLOAD.tomorrow = PAYLOAD.days[1];
  });

  test('the rows are buttons, so the list is reachable by keyboard', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      expect(rows()).toHaveLength(2);
      expect(rows()[0].tagName).toBe('BUTTON');
      expect(rows()[0].type).toBe('button');
    });
  });

  test('names the reference day on top of the view, marked as today by default', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      expect(document.querySelector('.wx-daybar-date').textContent).toBe('Sunday, 30 August');
      expect(document.querySelector('.wx-daybar-today')).not.toBeNull();
      /* nowhere to go back to yet */
      expect(document.querySelector('.wx-daybar-back')).toBeNull();
    });
  });

  test('tapping a day re-points the header, hero and strip at it', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      rows()[1].click();

      expect(document.querySelector('.wx-daybar-date').textContent).toBe('Monday, 31 August');
      expect(document.querySelector('.wx-daybar-today')).toBeNull();

      /* a browsed day leads with its high, not with a current reading */
      expect(document.querySelector('.wx-hero-temp').textContent).toBe('40°');
      expect(document.querySelector('.wx-hero-cond').textContent).toBe('Partly cloudy');
      expect(document.querySelector('.wx-hero-feels').textContent).toBe('Feels up to 43°');

      /* and its own 24 hours, from midnight rather than from "now" */
      var labels = document.querySelectorAll('#wx-hours .wx-hour-label');
      expect(labels).toHaveLength(3);
      expect(labels[0].textContent).toBe('00:00');
      expect(document.getElementById('wx-hours-title').textContent).toBe('Hour by hour');
    });
  });

  test('switching days never refetches — it is all in the cached payload', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      expect(fetchCount).toBe(1);
      rows()[1].click();
      rows()[0].click();
      rows()[1].click();
      expect(fetchCount).toBe(1);
    });
  });

  test('drops the live-only affordances on a browsed day', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      /* today: "as of", a sun-arc marker, and all eight tiles */
      expect(document.querySelector('.wx-hero-updated')).not.toBeNull();
      expect(document.querySelector('.wx-arc-marker')).not.toBeNull();
      expect(document.querySelectorAll('#wx-metrics .wx-metric')).toHaveLength(8);

      rows()[1].click();

      /* a future day has no "now" for any of them to refer to */
      expect(document.querySelector('.wx-hero-updated')).toBeNull();
      expect(document.querySelector('.wx-arc-marker')).toBeNull();
      /* humidity, pressure and cloud cover have no daily aggregate */
      expect(document.querySelectorAll('#wx-metrics .wx-metric')).toHaveLength(5);
    });
  });

  test('the Today button returns the view to live conditions', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      rows()[1].click();
      document.querySelector('.wx-daybar-back').click();

      expect(document.querySelector('.wx-daybar-date').textContent).toBe('Sunday, 30 August');
      expect(document.querySelector('.wx-hero-temp').textContent).toBe('24°');
      expect(document.querySelector('.wx-hero-updated').textContent).toBe('as of 09:45');
      expect(document.querySelectorAll('#wx-hours .wx-hour-label')[0].textContent).toBe('Now');
    });
  });

  test('marks the selected row in the list', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      expect(rows()[0].className).toContain('is-selected');
      rows()[1].click();
      expect(rows()[0].className).not.toContain('is-selected');
      expect(rows()[1].className).toContain('is-selected');
    });
  });

  /* The last day of the horizon can come back short. */
  test('renders a day whose hourly series is truncated', function () {
    PAYLOAD.hoursByDate['2026-08-31'] = [
      { clock: '00:00', temp: 31, weatherCode: 2, precipProb: 20, isDay: 0 }
    ];
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      rows()[1].click();
      expect(document.querySelectorAll('#wx-hours .wx-hour')).toHaveLength(1);
    });
  });

  test('falls back to today when a day has no hours at all', function () {
    delete PAYLOAD.hoursByDate['2026-08-31'];
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      rows()[1].click();
      /* the rest of the day still renders; only the strip reports the gap */
      expect(document.querySelector('.wx-daybar-date').textContent).toBe('Monday, 31 August');
      expect(document.querySelector('#wx-hours .form-hint')).not.toBeNull();
    });
  });

  /* A selection surviving a location change would show one city's
     Tuesday under another city's name. */
  test('resets to today when the location changes', function () {
    loadApp(routes(PAYLOAD));
    return flush().then(openWeather).then(function () {
      rows()[1].click();
      expect(document.querySelector('.wx-daybar-today')).toBeNull();

      document.getElementById('weather-refresh-btn').click();
      jest.advanceTimersByTime(200);
      return Promise.resolve();
    }).then(function () {
      jest.advanceTimersByTime(200);
      expect(document.querySelector('.wx-daybar-today')).not.toBeNull();
      expect(document.querySelector('.wx-daybar-date').textContent).toBe('Sunday, 30 August');
    });
  });
});

/* ── update check ─────────────────────────────────────────
   The page is loaded once and then runs for weeks on the wall
   panel, so "am I still the current release?" cannot be answered
   from /api/config alone — that reports the server. The answer
   comes from comparing it against the stamp the backend wrote
   into this page's HTML at serve time.

   loadApp() mounts only <body>, exactly like a bare static host
   serving frontend/ untouched, so the stamp has to be planted in
   <head> by hand here — which is also the case the module has to
   survive without inventing an update. */
describe('update check (Software block)', function () {
  function stamp(version) {
    document.head.innerHTML = '<meta name="app-version" content="' + version + '">';
  }
  function serving(version) {
    return function (method, url) {
      if (url.indexOf('/api/config') !== -1) {
        return { status: 200, body: { haRefreshIntervalSec: 0, version: version } };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    };
  }

  afterEach(function () { document.head.innerHTML = ''; });

  test('reports up to date when the page and the server are on the same release', function () {
    stamp('0.0.12');
    loadApp(serving('0.0.12'));
    return flush().then(function () {
      expect(document.getElementById('sw-version').textContent).toBe('0.0.12');
      expect(document.getElementById('sw-status').textContent).toBe('Up to date');
      expect(document.getElementById('sw-status').classList.contains('sw-status--update')).toBe(false);
    });
  });

  test('names the newer release and toasts once when the page is behind', function () {
    stamp('0.0.12');
    loadApp(serving('0.0.13'));
    return flush().then(function () {
      var status = document.getElementById('sw-status');
      expect(status.textContent).toBe('Version 0.0.13 available');
      expect(status.classList.contains('sw-status--update')).toBe(true);
      expect(document.getElementById('toast').textContent).toContain('Update available');
    });
  });

  /* Served raw (no backend substitution) the placeholder survives. There is
     no release identity to compare, so the check must go quiet rather than
     read '__APP_VERSION__' as an old version and cry update forever. */
  test('disables itself when the HTML was served without a version stamp', function () {
    stamp('__APP_VERSION__');
    var seen = [];
    loadApp(function (method, url) {
      seen.push(url);
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      expect(document.getElementById('sw-version').textContent).toBe('unknown');
      expect(document.getElementById('sw-status').textContent).toBe('Version unknown');
      expect(document.getElementById('toast').classList.contains('show')).toBe(false);
    });
  });

  test('survives a page with no version meta at all', function () {
    loadApp();
    return flush().then(function () {
      expect(document.getElementById('sw-version').textContent).toBe('unknown');
      expect(document.getElementById('sw-status').textContent).toBe('Version unknown');
    });
  });

  test('re-checks when the app comes back from standby', function () {
    stamp('0.0.12');
    /* Deploy while the panel sleeps: the answer changes between the boot
       check and the wake. */
    var serverVersion = '0.0.12';
    loadApp(function (method, url) {
      if (url.indexOf('/api/config') !== -1) {
        return { status: 200, body: { haRefreshIntervalSec: 0, version: serverVersion } };
      }
      return mockXhrHelper.defaultRouteHandler(method, url);
    });
    return flush().then(function () {
      expect(document.getElementById('sw-status').textContent).toBe('Up to date');
      serverVersion = '0.0.13';
      document.dispatchEvent(new Event('visibilitychange'));
      return flush();
    }).then(function () {
      expect(document.getElementById('sw-status').textContent).toBe('Version 0.0.13 available');
    });
  });
});
