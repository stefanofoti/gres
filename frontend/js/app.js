/* HomeApp — ES5 */
(function () {
  'use strict';

  var API = '';

  /* ── state ─────────────────────────────────────────── */
  var state = {
    page: 'home',
    haConnected: false,
    entities: [],
    loaded: false,
    toggling: {},
    sheet: { entity: null, open: false }
  };

  /* ── DOM helpers ───────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls)  e.className   = cls;
    if (text) e.textContent = text;
    return e;
  }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  /* ── XHR ────────────────────────────────────────────── */
  function xhr(method, url, body, cb) {
    var req = new XMLHttpRequest();
    req.open(method, url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        if (req.status >= 200 && req.status < 300) cb(null, j);
        else cb(j.error || 'HTTP ' + req.status, null);
      } catch (x) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(body ? JSON.stringify(body) : null);
  }
  /* Esposto globalmente per il riuso tra moduli */
  window._xhr = xhr;
  /* openLightSheet exposed after function is defined below */

  /* Counts requests currently in flight, so the wake-from-standby
     overlay (below) can hide itself once whatever it triggered has
     actually finished, instead of guessing a fixed delay. Wrapped
     around the innermost xhr, underneath every other module's own
     window._xhr interceptor (feature gate, markets-toggle hook, ...) —
     every one of those is a proxy in front of this same function, so a
     request one of them drops before calling through is correctly
     never counted here. */
  var _pendingXhrCount = 0;
  (function () {
    var raw = window._xhr;
    window._xhr = function (method, url, body, cb) {
      _pendingXhrCount++;
      raw(method, url, body, function (err, data) {
        _pendingXhrCount--;
        cb(err, data);
      });
    };
  })();

  /* ── shared weather icon function ───────────────────
     Returns an SVG string for a given WMO weather code.
     isDay: 1 = day, 0 = night.
     size: pixel size for width/height attribute.           */
  window._wxIcon = function (code, isDay, size) {
    var s = size || 24;
    var c = code || 0;
    var d = (isDay !== 0);

    /* colour palette */
    var SUN   = '#f5d84e';
    var MOON  = '#c8d4f0';
    var CLOUD = '#9090b0';
    var LCLOUD= '#b8b8d0';
    var RAIN  = '#70a0e0';
    var SNOW  = '#c8d8f8';
    var BOLT  = '#f0d060';
    var FOG   = '#808098';

    function svg(content) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
        '" viewBox="0 0 24 24" fill="none">' + content + '</svg>';
    }
    function sun() {
      return '<circle cx="12" cy="12" r="4.5" fill="' + SUN + '"/>' +
        '<g stroke="' + SUN + '" stroke-width="1.5" stroke-linecap="round">' +
        '<line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>' +
        '<line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>' +
        '<line x1="4.9" y1="4.9" x2="7.1" y2="7.1"/><line x1="16.9" y1="16.9" x2="19.1" y2="19.1"/>' +
        '<line x1="19.1" y1="4.9" x2="16.9" y2="7.1"/><line x1="7.1" y1="16.9" x2="4.9" y2="19.1"/>' +
        '</g>';
    }
    function moon() {
      return '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="' + MOON + '"/>';
    }
    function cloud(x, y, col) {
      x = x || 0; y = y || 0; col = col || CLOUD;
      return '<path d="M' + (5+x) + ' ' + (17+y) + 'a4 4 0 0 1 0-8 5 5 0 0 1 9.9-1A3.5 3.5 0 1 1 ' + (18.5+x) + ' ' + (17+y) + 'z" fill="' + col + '"/>';
    }
    function rainDrops(n, col) {
      var out = ''; col = col || RAIN; n = n || 2;
      var xs = [9, 13, 11, 15];
      for (var i = 0; i < n && i < 4; i++) {
        out += '<line x1="' + xs[i] + '" y1="19" x2="' + (xs[i]-1) + '" y2="22" stroke="' + col + '" stroke-width="1.5" stroke-linecap="round"/>';
      }
      return out;
    }
    function snowFlakes(n) {
      var out = ''; n = n || 2;
      var xs = [9, 13, 11, 15];
      for (var i = 0; i < n && i < 4; i++) {
        out += '<circle cx="' + xs[i] + '" cy="21" r="1" fill="' + SNOW + '"/>';
      }
      return out;
    }

    /* code → icon */
    if (c === 0) { /* clear */
      return svg(d ? sun() : moon());
    }
    if (c <= 2) { /* mainly clear / partly cloudy */
      return svg((d ? sun() : moon()) + cloud(2, 0, LCLOUD));
    }
    if (c === 3) { /* overcast */
      return svg(cloud(0, -2, LCLOUD) + cloud(2, 2, CLOUD));
    }
    if (c === 45 || c === 48) { /* fog */
      return svg('<rect x="3" y="9" width="18" height="1.5" rx="1" fill="' + FOG + '"/>' +
        '<rect x="5" y="12" width="14" height="1.5" rx="1" fill="' + FOG + '"/>' +
        '<rect x="3" y="15" width="18" height="1.5" rx="1" fill="' + FOG + '"/>');
    }
    if (c >= 51 && c <= 57) { /* drizzle */
      return svg(cloud() + rainDrops(2));
    }
    if (c >= 61 && c <= 67) { /* rain */
      return svg(cloud() + rainDrops(4));
    }
    if (c >= 71 && c <= 77) { /* snow */
      return svg(cloud() + snowFlakes(3));
    }
    if (c >= 80 && c <= 82) { /* showers */
      return svg((d ? sun() : moon()) + cloud(2, 0, LCLOUD) + rainDrops(3));
    }
    if (c === 85 || c === 86) { /* snow showers */
      return svg(cloud() + snowFlakes(2));
    }
    if (c >= 95) { /* thunderstorm */
      return svg(cloud() + '<path d="M13 14l-2 4h3l-2 4" stroke="' + BOLT + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    /* fallback */
    return svg(cloud());
  };

  /* ── toast ──────────────────────────────────────────── */
  var _toastTimer;
  function toast(msg, dur) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.classList.add('hidden'); }, 260);
    }, dur || 2200);
  }
  /* Esposto globalmente per il riuso tra moduli */
  window._toast = toast;

  /* ── clock + greeting ──────────────────────────────────
     Both are re-derived from `new Date()` on every tick (rather than
     computed once at load) so they stay correct across an hour/day
     boundary and the moment the app wakes from standby — see the
     visibilitychange handler below. */
  function tick() {
    var n = new Date(), h = n.getHours(), m = n.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    $('home-greeting').textContent =
      h < 6  ? 'Good night'     :
      h < 12 ? 'Good morning'   :
      h < 17 ? 'Good afternoon' :
      h < 21 ? 'Good evening'   : 'Good night';
  }
  tick();
  setInterval(tick, 15000);

  /* ── Generic PIN prompt ─────────────────────────────────
     A single overlay reused for two purposes:
       - 'settings' scope: gates landing on the Settings tab
         (SETTINGS_PIN). Once unlocked it stays unlocked for
         the rest of this page load (in-memory only — a full
         reload re-locks it).
       - 'devices'  scope: gates interacting with smart
         devices flagged as locked (DEVICES_PIN). This one is
         intentionally NOT cached: every interaction with a
         locked device asks for the PIN again.
     Digits are entered via an in-app numeric keypad — the
     system keyboard is never invoked. This is deliberate: on
     iPad, Safari shows a full QWERTY keyboard for type="tel"
     inputs (only iPhone gets a numeric-only pad there), so a
     real on-screen numpad is the only way to guarantee number
     keys everywhere. The digits typed are masked as dots and
     never rendered; the prompt auto-submits as soon as the
     expected number of digits (reported by the backend, the
     value itself never is) has been entered.                 */
  var pinOverlay  = $('pin-overlay');
  var pinTitleEl  = $('pin-title');
  var pinMsgEl    = $('pin-msg');
  var pinDots     = $('pin-dots');
  var pinKeypad   = $('pin-keypad');
  var pinError    = $('pin-error');
  var pinSubmitEl = $('pin-submit');
  var pinCancelEl = $('pin-cancel');
  var pinBackEl   = $('pin-backspace');

  /* All of the elements above must exist for the PIN prompt to work.
     If even one is missing (e.g. an HTML/JS version mismatch from a
     stale cache after an update), pinReady stays false and every
     entry point below safely no-ops instead of throwing — a locked
     Settings tab or device simply won't be reachable until the page
     is refreshed with matching assets. */
  var pinReady = !!(pinOverlay && pinTitleEl && pinMsgEl && pinDots && pinKeypad &&
                    pinError && pinSubmitEl && pinCancelEl && pinBackEl);
  if (!pinReady && window.console && window.console.warn) {
    window.console.warn('PIN prompt markup missing or out of date — clear cache / reload.');
  }

  var pinValue = '';            /* digits entered so far, in memory only */
  var pinStatusCache = {};      /* scope -> { required, length } */
  var pinState = { scope: 'settings', length: 0, onSuccess: null, onCancel: null };

  function fetchPinStatus(scope, cb) {
    if (pinStatusCache[scope]) { cb(pinStatusCache[scope]); return; }
    xhr('GET', API + '/api/auth/pin-status?scope=' + scope, null, function (err, data) {
      var res = (!err && data) ? data : { required: false, length: 0 };
      pinStatusCache[scope] = res;
      cb(res);
    });
  }

  /* Pre-warm the cache for both scopes as soon as the app loads, well
     before the user taps anything, so the prompt can open instantly
     with the right number of dot slots. */
  fetchPinStatus('settings', function () {});
  fetchPinStatus('devices',  function () {});

  function renderPinDots() {
    if (!pinReady) return;
    var n     = pinValue.length;
    var slots = Math.max(pinState.length || 0, n, 4);
    var html  = '';
    for (var i = 0; i < slots; i++) {
      html += '<span class="pin-dot' + (i < n ? ' filled' : '') + '"></span>';
    }
    pinDots.innerHTML = html;
  }

  function closePinOverlay() {
    if (!pinReady) return;
    pinOverlay.classList.add('hidden');
    pinValue = '';
    renderPinDots();
  }

  /**
   * Show the PIN prompt for a given scope.
   *
   * @param {string}   scope     'settings' | 'devices'
   * @param {string}   title
   * @param {string}   msg
   * @param {Function} onSuccess called with no args once the PIN is verified
   * @param {Function} [onCancel]
   */
  function openPinPrompt(scope, title, msg, onSuccess, onCancel) {
    /* Markup missing (stale cache): fail safe by NOT granting access —
       better a non-functional lock than an accidental bypass. */
    if (!pinReady) {
      toast('Unable to show the PIN prompt. Please reload the page.');
      return;
    }

    pinState.scope     = scope;
    pinState.onSuccess = onSuccess;
    pinState.onCancel  = onCancel || null;
    pinTitleEl.textContent = title;
    pinMsgEl.textContent   = msg;
    pinError.classList.add('hidden');
    pinValue = '';

    fetchPinStatus(scope, function (status) {
      pinState.length = status.length || 0;
      if (!status.required) {
        /* Nothing configured for this scope: proceed straight away. */
        if (onSuccess) onSuccess();
        return;
      }
      renderPinDots();
      pinOverlay.classList.remove('hidden');
    });
  }

  function submitPin() {
    if (!pinReady) return;
    var pin = pinValue || '';
    if (!pin) return;
    xhr('POST', API + '/api/auth/verify-pin', { scope: pinState.scope, pin: pin },
      function (err, data) {
        if (!err && data && data.ok) {
          var cb = pinState.onSuccess;
          closePinOverlay();
          if (cb) cb();
        } else {
          pinError.textContent = (data && data.error) ? data.error : 'Wrong PIN';
          pinError.classList.remove('hidden');
          pinValue = '';
          renderPinDots();
        }
      }
    );
  }

  function pinAppendDigit(d) {
    if (!pinReady) return;
    if (pinState.length > 0 && pinValue.length >= pinState.length) return;
    pinValue += d;
    renderPinDots();
    if (pinState.length > 0 && pinValue.length >= pinState.length) submitPin();
  }

  function pinBackspace() {
    if (!pinReady) return;
    pinValue = pinValue.slice(0, -1);
    renderPinDots();
  }

if (pinReady) {
    var bindFastInteraction = function (el, handler) {
      el.addEventListener('touchstart', function (e) {
        e.preventDefault();
        handler(e);
      }, false);
      
      el.addEventListener('click', function (e) {
        handler(e);
      }, false);
    };

    bindFastInteraction(pinSubmitEl, submitPin);
    
    bindFastInteraction(pinCancelEl, function () {
      var cb = pinState.onCancel;
      closePinOverlay();
      if (cb) cb();
    });
    
    bindFastInteraction(pinBackEl, pinBackspace);

    var handleKeypadInput = function (e) {
      var t = e.target;
      while (t && t !== pinKeypad && !t.getAttribute('data-digit')) {
        t = t.parentNode;
      }
      if (t && t.getAttribute && t.getAttribute('data-digit') != null) {
        if (e.cancelable) {
          e.preventDefault();
        }
        pinAppendDigit(t.getAttribute('data-digit'));
      }
    };

    pinKeypad.addEventListener('touchstart', function (e) {
      handleKeypadInput(e);
    }, false);

    pinKeypad.addEventListener('click', function (e) {
      handleKeypadInput(e);
    }, false);
  }

  /* Exposed so other modules (Smart Home page, Home widgets) can gate
     a device interaction without duplicating any of the above. */
  window._openPinPrompt = openPinPrompt;

  /* ── Page navigation ────────────────────────────────── */
  function showPage(id) {
    // Hide all pages and deactivate all tabs
    var pages = document.querySelectorAll('.page');
    var tabs  = document.querySelectorAll('.tab');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    for (var j = 0; j < tabs.length;  j++) tabs[j].classList.remove('active');
    // Show the selected page and activate its tab
    var p = $('page-' + id), t = document.querySelector('[data-page="' + id + '"]');
    if (p) p.classList.add('active');
    if (t) t.classList.add('active');
    state.page = id;
    window._currentPage = id;
    // Load page-specific data if needed
    if (id === 'smarthome') loadSmartHome(false);
    if (id === 'settings')  { loadSettings(); loadAdminSettings(); }
    /* Leaving Server stops its background status poller — it has no other
       page-visibility guard, unlike the Home widget scheduler. */
    if (id !== 'server' && window._pxStopPolling) window._pxStopPolling();
  }

  /* Settings tab gate — uses the 'settings' scope, cached for the page
     session: once unlocked, re-opening Settings doesn't ask again. */
  var settingsUnlocked = false;

  var tabEls = document.querySelectorAll('.tab');
  for (var _ti = 0; _ti < tabEls.length; _ti++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-page');
        if (id === 'settings' && !settingsUnlocked) {
          openPinPrompt('settings', 'Settings locked', 'Enter the PIN to access Settings.', function () {
            settingsUnlocked = true;
            showPage('settings');
          });
          return;
        }
        showPage(id);
        if (id === 'home' && window._homeRefresh) window._homeRefresh();
      });
    })(tabEls[_ti]);
  }

  /* expose showPage for other modules that need programmatic navigation */
  window._showPage = showPage;

  /* ── wake-from-standby refresh ─────────────────────────
     This runs on a wall panel whose iPad screen locks and unlocks all
     day. Locking pauses JS entirely, so on unlock everything on screen
     is stale until whatever poll interval happens to fire next. Rather
     than wait, force an immediate refresh of the clock/greeting and of
     whichever tab is currently visible the moment the page becomes
     visible again. Each per-tab loader here is the exact function its
     own tab-click handler already calls, so this is just re-running
     "as if the user just tapped this tab" rather than new behaviour.
     Settings is deliberately excluded: reloading it can blank a
     credential field the user is mid-edit on (see _markCredential).

     Refreshing several tabs' worth of data over a connection that's
     often still reassociating with wifi right after unlock can take a
     visible moment, during which the page is mid-refetch and would
     otherwise show a jumble of stale and freshly-updated content. The
     #wake-overlay full-screen spinner masks exactly that window: shown
     only here, hidden as soon as every request this triggered has
     settled (via _pendingXhrCount), with a floor so it doesn't flash
     for an instant refresh and a ceiling so a hung request can't leave
     it stuck up. */
  var WAKE_MIN_GAP_MS = 2000;
  var WAKE_OVERLAY_MIN_MS = 350;
  var WAKE_OVERLAY_MAX_MS = 8000;
  var _lastWakeAt = 0;
  var _wakeOverlayTimer = null;

  function showWakeOverlay() {
    var el = $('wake-overlay');
    if (el) el.classList.remove('hidden');
  }
  function hideWakeOverlay() {
    var el = $('wake-overlay');
    if (el) el.classList.add('hidden');
  }

  function onAppWake() {
    var now = Date.now();
    if (now - _lastWakeAt < WAKE_MIN_GAP_MS) return;
    _lastWakeAt = now;

    showWakeOverlay();
    var shownAt = Date.now();

    tick();

    var cp = window._currentPage;
    if (cp === 'home'      && window._homeRefresh)      window._homeRefresh();
    if (cp === 'meteo'     && window._weatherRefresh)    window._weatherRefresh();
    if (cp === 'markets'   && window._marketsRefresh)    window._marketsRefresh();
    if (cp === 'jelly'     && window._jellyRefresh)      window._jellyRefresh();
    if (cp === 'smarthome') loadSmartHome(false);
    if (cp === 'server'    && window._serverWakeRefresh) window._serverWakeRefresh();

    clearTimeout(_wakeOverlayTimer);
    (function waitForIdle() {
      var elapsed = Date.now() - shownAt;
      var idle = _pendingXhrCount <= 0 && elapsed >= WAKE_OVERLAY_MIN_MS;
      if (idle || elapsed >= WAKE_OVERLAY_MAX_MS) {
        hideWakeOverlay();
        return;
      }
      _wakeOverlayTimer = setTimeout(waitForIdle, 150);
    })();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) onAppWake();
  }, false);

  /* Fallback for the rarer case where iOS purges the page from memory
     during a long lock and restores it from the back/forward cache
     instead of just unpausing it — visibilitychange alone would miss
     that. The 2s debounce above absorbs the case where both fire. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) onAppWake();
  }, false);

  /* ── HA status ──────────────────────────────────────── */
  function checkHA() {
    window._xhr('GET', API + '/api/ha/status', null, function (err, data) {
      var ok = !err && data && data.connected;
      $('status-dot').className = 'dot ' + (ok ? 'dot-ok' : 'dot-err');
      $('status-text').textContent = ok ? 'HA Online' : 'HA offline';
      state.haConnected = !!ok;
    });
  }
  checkHA();
  setInterval(checkHA, 30000);

  /* ── startup: load settings immediately ─────────────── */
  /* This ensures features_disabled (and other settings) are applied
     on first paint, without requiring the user to open the Settings tab. */
  loadSettings();

  /* ── domain groups ──────────────────────────────────── */
  var GROUPS = [
    { key: 'lights',   label: 'Lights',           domains: ['light'] },
    { key: 'media',    label: 'TV & Media',      domains: ['media_player'] },
    { key: 'switches', label: 'Smart Plug',  domains: ['switch', 'input_boolean'] },
    { key: 'climate',  label: 'Climate',           domains: ['climate', 'fan'] },
    { key: 'covers',   label: 'Covers',      domains: ['cover'] }
  ];

  var ICONS = {
    light: '○', switch: '⌁', input_boolean: '⌁',
    media_player: '▷', climate: '◇', fan: '◎', cover: '▭'
  };

  var STATE_LABELS = {
    on: 'on', off: 'off', open: 'open', closed: 'closed',
    playing: 'playing', paused: 'paused', idle: 'idle',
    unavailable: 'unavailable', unknown: 'unknown', standby: 'standby'
  };

  function domainOf(eid) { return eid.split('.')[0]; }
  function isOn(e) { var s = e.state; return s==='on'||s==='open'||s==='playing'||s==='paused'||s==='idle'; }
  function svcFor(domain, turnOn) {
    if (domain === 'cover') return turnOn ? 'open_cover' : 'close_cover';
    return turnOn ? 'turn_on' : 'turn_off';
  }
  function stateLabel(s) { return STATE_LABELS[s] || s; }
  function friendlyName(entity) {
    return (entity.attributes && entity.attributes.friendly_name)
      ? entity.attributes.friendly_name
      : entity.entity_id.split('.')[1].replace(/_/g, ' ');
  }

  /* ── light capability detection ─────────────────────── */
  function lightCaps(entity) {
    var modes = (entity.attributes && entity.attributes.supported_color_modes) || [];
    // supported_features bitmask fallback
    var sf = (entity.attributes && entity.attributes.supported_features) || 0;
    return {
      brightness: modes.indexOf('brightness') !== -1 || modes.indexOf('color_temp') !== -1 ||
                  modes.indexOf('hs') !== -1 || modes.indexOf('rgb') !== -1 ||
                  modes.indexOf('xy') !== -1 || modes.indexOf('rgbw') !== -1 ||
                  modes.indexOf('rgbww') !== -1 || (sf & 1) !== 0,
      colorTemp:  modes.indexOf('color_temp') !== -1 || modes.indexOf('rgbww') !== -1 || (sf & 2) !== 0,
      color:      modes.indexOf('hs') !== -1 || modes.indexOf('rgb') !== -1 ||
                  modes.indexOf('xy') !== -1 || modes.indexOf('rgbw') !== -1 ||
                  modes.indexOf('rgbww') !== -1 || (sf & 16) !== 0
    };
  }

  /* ── color conversion helpers ───────────────────────── */
  function hsvToRgb(h, s, v) {
    var r, g, b, i = Math.floor(h * 6),
        f = h * 6 - i, p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
    switch(i % 6) {
      case 0: r=v; g=t; b=p; break; case 1: r=q; g=v; b=p; break;
      case 2: r=p; g=v; b=t; break; case 3: r=p; g=q; b=v; break;
      case 4: r=t; g=p; b=v; break; default: r=v; g=p; b=q;
    }
    return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
  }

  function rgbToHex(r, g, b) {
    return '#' + ('0'+r.toString(16)).slice(-2) + ('0'+g.toString(16)).slice(-2) + ('0'+b.toString(16)).slice(-2);
  }

  function hsToRgb(hue, sat) { // hue 0-360, sat 0-100
    return hsvToRgb(hue/360, sat/100, 1);
  }

  function kelvinToRgb(k) {
    // simple approximation
    k = k / 100;
    var r, g, b;
    if (k <= 66) {
      r = 255;
      g = Math.max(0, Math.min(255, 99.4708025861 * Math.log(k) - 161.1195681661));
      b = k <= 19 ? 0 : Math.max(0, Math.min(255, 138.5177312231 * Math.log(k - 10) - 305.0447927307));
    } else {
      r = Math.max(0, Math.min(255, 329.698727446 * Math.pow(k - 60, -0.1332047592)));
      g = Math.max(0, Math.min(255, 288.1221695283 * Math.pow(k - 60, -0.0755148492)));
      b = 255;
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  }

  function miredToKelvin(m) { return Math.round(1000000 / m); }

  /* ── color wheel canvas ─────────────────────────────── */
  var wheelDrawn = false;
  function drawColorWheel() {
    var canvas = $('light-color-canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var W = canvas.width, cx = W/2, cy = W/2, r = W/2 - 2;
    ctx.clearRect(0, 0, W, W);
    // Render wheel pixel-by-pixel via imageData
    var imageData = ctx.createImageData(W, W);
    var data = imageData.data;
    for (var y = 0; y < W; y++) {
      for (var x = 0; x < W; x++) {
        var dx = x - cx, dy = y - cy;
        var dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > r) { continue; }
        var hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        var sat2 = dist / r;
        var rgb2 = hsvToRgb(hue/360, sat2, 1);
        var idx = (y * W + x) * 4;
        data[idx]   = rgb2[0];
        data[idx+1] = rgb2[1];
        data[idx+2] = rgb2[2];
        data[idx+3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    // dark border
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2*Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    wheelDrawn = true;
  }

  function positionColorCursor(hue, sat) {
    var canvas = $('light-color-canvas');
    var cursor = $('colorwheel-cursor');
    if (!canvas || !cursor) return;
    var r = canvas.width / 2 - 2;
    var cx = canvas.width / 2, cy = canvas.height / 2;
    var rad = hue * Math.PI / 180;
    var dist = (sat / 100) * r;
    var x = cx + dist * Math.cos(rad);
    var y = cy + dist * Math.sin(rad);
    cursor.style.left = x + 'px';
    cursor.style.top  = y + 'px';
  }

  /* ── light sheet open/close ─────────────────────────── */
  var _sliderBrTimer, _sliderCtTimer, _colorSendTimer;

  function openLightSheet(entity) {
    if (window._isDeviceLocked(entity.entity_id)) {
      window._guardDeviceAction(entity.entity_id, function () { doOpenLightSheet(entity); });
      return;
    }
    doOpenLightSheet(entity);
  }

  function doOpenLightSheet(entity) {
    state.sheet.entity = entity;
    state.sheet.open = true;

    var caps = lightCaps(entity);
    var attr = entity.attributes || {};
    var on   = entity.state === 'on';

    // title
    $('sheet-title').textContent = friendlyName(entity);

    // power
    var tog = $('sheet-power-toggle');
    on ? tog.classList.add('on') : tog.classList.remove('on');
    $('sheet-power-label').textContent = on ? 'Acceso' : 'Spento';

    // dot color
    updateSheetDot(entity);

    // brightness
    var bCtrl = $('ctrl-brightness');
    if (caps.brightness) {
      bCtrl.style.display = '';
      var bVal = attr.brightness || 255;
      $('slider-brightness').value = bVal;
      $('val-brightness').textContent = Math.round(bVal / 255 * 100) + '%';
    } else {
      bCtrl.style.display = 'none';
    }

    // color temp
    var ctCtrl = $('ctrl-colortemp');
    if (caps.colorTemp) {
      ctCtrl.style.display = '';
      var ctMin = attr.min_mireds || 153;
      var ctMax = attr.max_mireds || 500;
      var ctVal = attr.color_temp || ctMin;
      var slider = $('slider-colortemp');
      slider.min   = ctMin;
      slider.max   = ctMax;
      slider.value = ctVal;
      $('val-colortemp').textContent = miredToKelvin(ctVal) + 'K';
    } else {
      ctCtrl.style.display = 'none';
    }

    // color wheel
    var colCtrl = $('ctrl-color');
    if (caps.color) {
      colCtrl.style.display = '';
      if (!wheelDrawn) drawColorWheel();
      var hs = attr.hs_color || [0, 0];
      positionColorCursor(hs[0], hs[1]);
      var rgb = hsToRgb(hs[0], hs[1]);
      $('val-color').textContent = rgbToHex(rgb[0], rgb[1], rgb[2]);
    } else {
      colCtrl.style.display = 'none';
    }

    // show
    var bd = $('light-sheet-backdrop');
    bd.style.display = 'block';
    void bd.offsetWidth;
    bd.classList.add('open');
    $('light-sheet').classList.add('open');
  }

  function closeLightSheet() {
    state.sheet.open = false;
    var bd = $('light-sheet-backdrop');
    bd.classList.remove('open');
    $('light-sheet').classList.remove('open');
    setTimeout(function () {
      if (!state.sheet.open) bd.style.display = 'none';
    }, 350);
  }

  function updateSheetDot(entity) {
    var attr = entity.attributes || {};
    var dot  = $('sheet-color-dot');
    if (entity.state !== 'on') { dot.style.background = '#2a2a50'; return; }
    if (attr.hs_color) {
      var rgb = hsToRgb(attr.hs_color[0], attr.hs_color[1]);
      dot.style.background = rgbToHex(rgb[0], rgb[1], rgb[2]);
    } else if (attr.color_temp) {
      var k = miredToKelvin(attr.color_temp);
      var rgb2 = kelvinToRgb(k);
      dot.style.background = rgbToHex(rgb2[0], rgb2[1], rgb2[2]);
    } else if (attr.brightness) {
      var b = Math.round(attr.brightness / 255 * 100);
      dot.style.background = 'hsl(240,' + (b > 50 ? '20' : '10') + '%,' + Math.round(40 + b * 0.4) + '%)';
    } else {
      dot.style.background = '#6060ff';
    }
  }

  /* ── sheet interactions ─────────────────────────────── */
  $('sheet-close').addEventListener('click', closeLightSheet);
  $('light-sheet-backdrop').addEventListener('click', function (e) {
    if (e.target === $('light-sheet-backdrop')) closeLightSheet();
  });

  // power toggle in sheet
  $('sheet-power-toggle').addEventListener('click', function () {
    var entity = state.sheet.entity;
    if (!entity) return;
    if (state.toggling[entity.entity_id]) return;

    var wasOn = entity.state === 'on';
    var tog   = $('sheet-power-toggle');
    state.toggling[entity.entity_id] = true;

    // optimistic
    wasOn ? tog.classList.remove('on') : tog.classList.add('on');
    $('sheet-power-label').textContent = wasOn ? 'Spento' : 'Acceso';
    entity.state = wasOn ? 'off' : 'on';
    updateSheetDot(entity);

    // update grid card too
    var card = document.querySelector('[data-eid="' + entity.entity_id + '"]');
    if (card) {
      var stext = card.querySelector('.card-state');
      setCardState(card, stext, !wasOn);
    }

    callService('light', wasOn ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id }, function(err){
      setTimeout(function () {
        delete state.toggling[entity.entity_id];
        if (err) {
          entity.state = wasOn ? 'on' : 'off';
          wasOn ? tog.classList.add('on') : tog.classList.remove('on');
          $('sheet-power-label').textContent = wasOn ? 'Acceso' : 'Spento';
          toast('Error: ' + err);
        }
      }, 500);
    });
  });

  // brightness slider
  $('slider-brightness').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    $('val-brightness').textContent = Math.round(v / 255 * 100) + '%';
    clearTimeout(_sliderBrTimer);
    var val = v;
    _sliderBrTimer = setTimeout(function () {
      var entity = state.sheet.entity;
      if (!entity) return;
      if (entity.state !== 'on') {
        entity.state = 'on';
        $('sheet-power-toggle').classList.add('on');
        $('sheet-power-label').textContent = 'Acceso';
        var card2 = document.querySelector('[data-eid="' + entity.entity_id + '"]');
        if (card2) { var st2 = card2.querySelector('.card-state'); setCardState(card2, st2, true); }
      }
      entity.attributes = entity.attributes || {};
      entity.attributes.brightness = val;
      callService('light', 'turn_on', { entity_id: entity.entity_id, brightness: val }, function(){});
    }, 300);
  });

  // color temp slider
  $('slider-colortemp').addEventListener('input', function () {
    var v = parseInt(this.value, 10);
    $('val-colortemp').textContent = miredToKelvin(v) + 'K';
    clearTimeout(_sliderCtTimer);
    var val = v;
    _sliderCtTimer = setTimeout(function () {
      var entity = state.sheet.entity;
      if (!entity) return;
      entity.attributes = entity.attributes || {};
      entity.attributes.color_temp = val;
      updateSheetDot(entity);
      callService('light', 'turn_on', { entity_id: entity.entity_id, color_temp: val }, function(){});
    }, 300);
  });

  // color wheel interaction
  function handleWheelEvent(e) {
    e.preventDefault();
    var canvas = $('light-color-canvas');
    var rect   = canvas.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var x  = clientX - rect.left;
    var y  = clientY - rect.top;
    var cx = canvas.width / 2, cy = canvas.height / 2;
    // scale from display to canvas coords
    var scaleX = canvas.width  / rect.width;
    var scaleY = canvas.height / rect.height;
    var dx = (x - rect.width/2)  * scaleX;
    var dy = (y - rect.height/2) * scaleY;
    var dist = Math.sqrt(dx*dx + dy*dy);
    var r    = canvas.width / 2 - 2;
    if (dist > r) { dist = r; }
    var hue = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    var sat = dist / r * 100;

    positionColorCursor(hue, sat);
    var rgb = hsToRgb(hue, sat);
    $('val-color').textContent = rgbToHex(rgb[0], rgb[1], rgb[2]);

    // update dot
    var entity = state.sheet.entity;
    if (entity) {
      entity.attributes = entity.attributes || {};
      entity.attributes.hs_color = [hue, sat];
      updateSheetDot(entity);
    }

    clearTimeout(_colorSendTimer);
    var h2 = hue, s2 = sat;
    _colorSendTimer = setTimeout(function () {
      if (!entity) return;
      if (entity.state !== 'on') {
        entity.state = 'on';
        $('sheet-power-toggle').classList.add('on');
        $('sheet-power-label').textContent = 'Acceso';
      }
      callService('light', 'turn_on', {
        entity_id: entity.entity_id,
        hs_color: [Math.round(h2), Math.round(s2)]
      }, function(){});
    }, 250);
  }

  var canvas = $('light-color-canvas');
  var _wheelDragging = false;
  canvas.addEventListener('mousedown',  function(e){ _wheelDragging = true; handleWheelEvent(e); });
  canvas.addEventListener('mousemove',  function(e){ if(_wheelDragging) handleWheelEvent(e); });
  document.addEventListener('mouseup',  function(){ _wheelDragging = false; });
  canvas.addEventListener('touchstart', function(e){ handleWheelEvent(e); }, false);
  canvas.addEventListener('touchmove',  function(e){ handleWheelEvent(e); }, false);
  canvas.addEventListener('touchend',   function(){ /* chiude il gesto */ }, false);
  canvas.addEventListener('touchcancel', function(){ clearTimeout(_colorSendTimer); }, false);

  /* ── HA service call ────────────────────────────────── */
  function callService(domain, service, serviceData, cb) {
    window._xhr('POST', API + '/api/ha/service', {
      domain: domain, service: service, service_data: serviceData
    }, function(err, data) { cb(err, data); });
  }

  /* ── smart home load / refresh ──────────────────────── */
  function updateSmartHomeSubtitle(summary, entities) {
    var total  = summary && summary.total  != null ? summary.total  : entities.length;
    var active = summary && summary.active != null ? summary.active : 0;
    if (summary == null) {
      active = 0;
      for (var i = 0; i < entities.length; i++) { if (isOn(entities[i])) active++; }
    }
    $('smarthome-subtitle').textContent = total + ' devices · ' + active + ' active';
  }

  function mergeEntityStates(target, incoming) {
    var index = {};
    for (var i = 0; i < target.length; i++) index[target[i].entity_id] = target[i];
    for (var j = 0; j < incoming.length; j++) {
      var src = incoming[j];
      var dst = index[src.entity_id];
      if (dst) {
        dst.state = src.state;
        dst.attributes = src.attributes;
        if (src.last_changed) dst.last_changed = src.last_changed;
        if (src.last_updated) dst.last_updated = src.last_updated;
      } else {
        target.push(src);
        index[src.entity_id] = src;
      }
    }
  }

  function syncCardFromEntity(card, entity) {
    var eid = entity.entity_id;
    if (state.toggling[eid]) return;

    var on = isOn(entity);
    var unavail = entity.state === 'unavailable';
    var domain = domainOf(eid);
    var isLight = domain === 'light';

    card.className = 'device-card' + (on ? ' on' : '') + (unavail ? ' unavail' : '');

    if (isLight && on) applyCardColor(card, entity);
    else if (isLight) {
      card.style.background = '';
      card.style.borderColor = '';
    }

    var stateEl = card.querySelector('.card-state');
    if (stateEl) stateEl.textContent = buildStateText(entity);
  }

  function syncSmartHomeCards(entities) {
    var container = $('smarthome-content');
    if (!container) return;
    var map = {};
    for (var i = 0; i < entities.length; i++) map[entities[i].entity_id] = entities[i];
    var cards = container.querySelectorAll('.device-card[data-eid]');
    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      var eid = card.getAttribute('data-eid');
      if (map[eid]) syncCardFromEntity(card, map[eid]);
    }
  }

  var _haRefreshBusy = false;

  function refreshHADevices(options, cb) {
    options = options || {};
    var silent = !!options.silent;
    var forceRender = !!options.forceRender;

    if (_haRefreshBusy) {
      if (cb) cb('busy');
      return;
    }
    _haRefreshBusy = true;

    if (!silent && (!state.loaded || forceRender) && state.page === 'smarthome') {
      show($('smarthome-loading'));
      hide($('smarthome-error'));
      hide($('smarthome-content'));
    }

    window._xhr('GET', API + '/api/ha/devices', null, function (err, data) {
      _haRefreshBusy = false;
      hide($('smarthome-loading'));

      if (err || !data || !Array.isArray(data.entities)) {
        if (!state.loaded && !silent) {
          show($('smarthome-error'));
          $('smarthome-error-msg').textContent = err || 'Unable to load';
        }
        if (cb) cb(err || 'Unable to load');
        return;
      }

      var entities = data.entities;
      var summary = data.summary || null;

      if (!state.loaded || forceRender) {
        state.entities = entities;
        state.loaded = true;
        updateSmartHomeSubtitle(summary, entities);
        renderGroups(entities);
        show($('smarthome-content'));
      } else {
        mergeEntityStates(state.entities, entities);
        updateSmartHomeSubtitle(summary, state.entities);
        syncSmartHomeCards(state.entities);
      }

      if (window._homeSyncHAEntities) window._homeSyncHAEntities(entities, summary);
      if (cb) cb(null, data);
    });
  }

  function loadSmartHome(force) {
    refreshHADevices({
      silent: state.loaded && !force,
      forceRender: !!force
    });
  }

  window._syncHACard = syncCardFromEntity;
  window._mergeHAEntities = mergeEntityStates;
  window._refreshHADevices = refreshHADevices;

  /* ── render groups ──────────────────────────────────── */
  function renderGroups(entities) {
    var container = $('smarthome-content');
    container.innerHTML = '';
    var hasAny = false;
    for (var g = 0; g < GROUPS.length; g++) {
      var grp = GROUPS[g], items = [];
      for (var i = 0; i < entities.length; i++) {
        if (grp.domains.indexOf(domainOf(entities[i].entity_id)) !== -1) items.push(entities[i]);
      }
      if (!items.length) continue;
      hasAny = true;
      container.appendChild(make('div', 'section-label', grp.label));
      var grid = make('div', 'devices-grid');
      for (var k = 0; k < items.length; k++) grid.appendChild(makeCard(items[k]));
      container.appendChild(grid);
    }
    if (!hasAny) {
      var empty = make('div', 'empty-state');
      empty.appendChild(make('div', 'empty-title', 'No devices found'));
      container.appendChild(empty);
    }
  }

  /* ── device card ────────────────────────────────────── */
  function makeCard(entity) {
    var on      = isOn(entity);
    var unavail = entity.state === 'unavailable';
    var domain  = domainOf(entity.entity_id);
    var isLight = domain === 'light';

    var card = make('div', 'device-card' + (on ? ' on' : '') + (unavail ? ' unavail' : ''));
    card.setAttribute('data-eid', entity.entity_id);

    // apply color hint for lights that are on with color
    if (isLight && on) applyCardColor(card, entity);

    var ico   = make('div', 'card-icon', ICONS[domain] || '◈');
    var info  = make('div', 'card-info');
    var name  = make('div', 'card-name', friendlyName(entity));
    var stext = make('div', 'card-state', buildStateText(entity));
    info.appendChild(name);
    info.appendChild(stext);

    // light: split card actions (toggle left, details right)
    if (isLight && !unavail) {
      var split = make('div', 'light-card-split');
      var left = make('button', 'light-main-toggle');
      left.type = 'button';
      var iconWrap = make('div', 'light-main-icon-wrap');
      iconWrap.appendChild(ico);
      left.appendChild(iconWrap);
      left.appendChild(info);

      var right = make('button', 'light-detail-open', '›');
      right.type = 'button';

      left.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleLightFromCard(entity, card, stext, left, right);
      });

      right.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openLightSheet(entity);
      });

      split.appendChild(left);
      split.appendChild(right);
      card.appendChild(split);
    } else {
      card.appendChild(ico);
      card.appendChild(info);
    }

    if (!unavail) {
      card.addEventListener('click', function () {
        if (isLight) {
          return;
        } else {
          toggleEntity(entity, card, stext);
        }
      });
    }
    return card;
  }

  function buildStateText(entity) {
    var base = stateLabel(entity.state);
    var attr = entity.attributes || {};
    if (entity.state === 'on' && domainOf(entity.entity_id) === 'light') {
      var parts = [];
      if (attr.brightness != null) parts.push(Math.round(attr.brightness / 255 * 100) + '%');
      if (attr.color_temp != null && !attr.hs_color) parts.push(miredToKelvin(attr.color_temp) + 'K');
      if (parts.length) return base + ' · ' + parts.join(' · ');
    }
    return base;
  }

  /* Shared with the Home widget so a tile reads the same on both tabs,
     and so a poll-driven sync never rewrites it in a different format
     than the initial build used. */
  window._haStateText = buildStateText;
  /* Same reasoning for the icon map and name formatter: this module owns
     the canonical copy, other modules read it instead of keeping their
     own (which is how the icon map and friendlyName drifted apart before). */
  window._haIcons = ICONS;
  window._haFriendlyName = friendlyName;

  function applyCardColor(card, entity) {
    var attr = entity.attributes || {};
    if (attr.hs_color) {
      var rgb = hsToRgb(attr.hs_color[0], attr.hs_color[1]);
      var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
      card.style.background = 'linear-gradient(135deg, ' + hex + '22 0%, ' + hex + '44 100%)';
      card.style.borderColor = hex + '55';
    } else if (attr.color_temp) {
      var k = miredToKelvin(attr.color_temp);
      var rgb2 = kelvinToRgb(k);
      var hex2 = rgbToHex(rgb2[0], rgb2[1], rgb2[2]);
      card.style.background = 'linear-gradient(135deg, ' + hex2 + '18 0%, ' + hex2 + '38 100%)';
      card.style.borderColor = hex2 + '40';
    }
  }

  /* ── non-light toggle ───────────────────────────────── */
  function toggleEntity(entity, card, stateEl) {
    var eid = entity.entity_id;
    if (state.toggling[eid]) return;
    if (window._isDeviceLocked(eid)) {
      window._guardDeviceAction(eid, function () { doToggleEntity(entity, card, stateEl); });
      return;
    }
    doToggleEntity(entity, card, stateEl);
  }

  function doToggleEntity(entity, card, stateEl) {
    var eid = entity.entity_id;
    var wasOn  = card.classList.contains('on');
    var domain = domainOf(eid);
    setCardState(card, stateEl, !wasOn);
    state.toggling[eid] = true;
    card.classList.add('busy');
    callService(domain, svcFor(domain, !wasOn), { entity_id: eid }, function (err) {
      setTimeout(function () {
        delete state.toggling[eid];
        card.classList.remove('busy');
        if (err) { setCardState(card, stateEl, wasOn); toast('Error: ' + err); }
        else { entity.state = !wasOn ? 'on' : 'off'; }
      }, 500);
    });
  }

  function toggleLightFromCard(entity, card, stateEl, leftBtn, rightBtn) {
    var eid = entity.entity_id;
    if (state.toggling[eid]) return;
    if (window._isDeviceLocked(eid)) {
      window._guardDeviceAction(eid, function () {
        doToggleLightFromCard(entity, card, stateEl, leftBtn, rightBtn);
      });
      return;
    }
    doToggleLightFromCard(entity, card, stateEl, leftBtn, rightBtn);
  }

  function doToggleLightFromCard(entity, card, stateEl, leftBtn, rightBtn) {
    var eid = entity.entity_id;

    var wasOn = entity.state === 'on';
    var nextOn = !wasOn;

    entity.state = nextOn ? 'on' : 'off';
    setCardState(card, stateEl, nextOn);
    if (nextOn) applyCardColor(card, entity);
    else {
      card.style.background = '';
      card.style.borderColor = '';
    }

    state.toggling[eid] = true;
    card.classList.add('busy');
    leftBtn.disabled = true;
    rightBtn.disabled = true;

    callService('light', nextOn ? 'turn_on' : 'turn_off', { entity_id: eid }, function (err) {
      setTimeout(function () {
        delete state.toggling[eid];
        card.classList.remove('busy');
        leftBtn.disabled = false;
        rightBtn.disabled = false;

        if (err) {
          entity.state = wasOn ? 'on' : 'off';
          setCardState(card, stateEl, wasOn);
          if (wasOn) applyCardColor(card, entity);
          else {
            card.style.background = '';
            card.style.borderColor = '';
          }
          toast('Error: ' + err);
        }
      }, 500);
    });
  }

  function setCardState(card, stateEl, on) {
    if (on) card.classList.add('on'); else card.classList.remove('on');
    if (stateEl) stateEl.textContent = stateLabel(on ? 'on' : 'off');
  }

  /* ── settings (centralised loader) ─────────────────────
     Single GET /api/settings on tab activation.
     Other modules register via window._onSettingsLoad(fn).
     ──────────────────────────────────────────────────── */
  window._settingsCallbacks = window._settingsCallbacks || [];
  window._onSettingsLoad = function (fn) {
    window._settingsCallbacks.push(fn);
  };

  function loadSettings() {
    xhr('GET', API + '/api/settings', null, function (err, data) {
      if (!data) return;
      /* Notify every registered module callback */
      var cbs = window._settingsCallbacks;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](data); } catch (e) { /* keep going */ }
      }
    });
  }

  /* ── Admin settings ─────────────────────────────────────
     Service URLs and a set/unset flag per credential, behind the
     settings scope. Fetched only when the Settings tab opens,
     because nothing outside those forms needs it — and the tokens
     themselves are never in the response at all.             */
  window._adminCallbacks = window._adminCallbacks || [];
  window._onAdminSettingsLoad = function (fn) {
    window._adminCallbacks.push(fn);
  };

  function loadAdminSettings() {
    xhr('GET', API + '/api/settings/admin', null, function (err, data) {
      if (err || !data) return;
      var cbs = window._adminCallbacks;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](data); } catch (e) { /* keep going */ }
      }
    });
  }

  /**
   * Show a credential input as "already configured" without ever holding
   * the value. An empty field on save means "keep what is stored"; only a
   * value the user typed is transmitted.
   *
   * @param {HTMLInputElement} input
   * @param {boolean} isSet
   */
  window._markCredential = function (input, isSet) {
    if (!input) return;
    if (!input.getAttribute('data-ph')) {
      input.setAttribute('data-ph', input.getAttribute('placeholder') || '');
    }
    input.value = '';
    input.placeholder = isSet ? '•••••••••••• (saved)' : input.getAttribute('data-ph');
  };

  /* ── Smart device protection ────────────────────────────
     A device is "locked" when its entity_id is listed in the
     'ha_protected_entities' setting (managed from the new
     Settings → "Smart device protection" section). Locked
     devices require the DEVICES_PIN before every interaction,
     from both the Home tab and the Smart Home tab.            */
  var protectedEntities = {};

  window._onSettingsLoad(function (data) {
    var list = Array.isArray(data.ha_protected_entities) ? data.ha_protected_entities : [];
    protectedEntities = {};
    for (var i = 0; i < list.length; i++) protectedEntities[list[i]] = true;
  });

  window._isDeviceLocked = function (entityId) {
    return !!protectedEntities[entityId];
  };

  /* Settings → "Smart device protection" updates this in place so the
     rest of the app sees the new lock state immediately (no reload). */
  window._setDeviceLocked = function (entityId, locked) {
    if (locked) protectedEntities[entityId] = true;
    else delete protectedEntities[entityId];
  };

  /**
   * Run `action` immediately if the device isn't locked, otherwise ask
   * for the DEVICES_PIN first (every time — never cached).
   *
   * @param {string}   entityId
   * @param {Function} action   called with no args once authorised
   * @param {Function} [onCancel]
   */
  window._guardDeviceAction = function (entityId, action, onCancel) {
    if (!window._isDeviceLocked(entityId)) { action(); return; }
    window._openPinPrompt('devices', 'Locked device',
      'Enter the PIN to control this device.', action, onCancel);
  };

  /**
   * Same idea for Proxmox power operations, which the backend gates on the
   * 'server' scope. Prompted every time rather than cached: shutting down a
   * node or stopping a VM is destructive and rare.
   *
   * openPinPrompt asks the backend whether the scope is protected first, so
   * with no SERVER_PIN configured this runs `action` immediately and the tab
   * behaves exactly as before.
   *
   * @param {string}   title    what is about to happen
   * @param {Function} action   called with no args once authorised
   * @param {Function} [onCancel]
   */
  window._guardServerAction = function (title, action, onCancel) {
    window._openPinPrompt('server', title,
      'Enter the PIN to control the server.', action, onCancel);
  };

  /* Whether a token is already stored. The value itself never arrives. */
  var haTokenSet = false;

  window._onAdminSettingsLoad(function (d) {
    if (d.ha_url) $('ha-url').value = d.ha_url;
    haTokenSet = !!d.ha_token_set;
    window._markCredential($('ha-token'), haTokenSet);
  });

  /**
   * Build the save body, omitting the token when the field was left empty
   * and one is already stored — otherwise an untouched form would
   * overwrite a saved token with an empty string.
   *
   * @returns {Object|null} null when the form is incomplete.
   */
  function haCredentialBody() {
    var url   = ($('ha-url').value   || '').trim().replace(/\/$/, '');
    var token = ($('ha-token').value || '').trim();
    if (!url) { toast('Enter server URL'); return null; }
    if (!token && !haTokenSet) { toast('Enter the token'); return null; }
    var body = { ha_url: url };
    if (token) body.ha_token = token;
    return body;
  }

  $('btn-save-ha').addEventListener('click', function () {
    var body = haCredentialBody();
    if (!body) return;
    xhr('POST', API + '/api/settings', body, function (err) {
      if (err) { toast('Error: ' + err); return; }
      haTokenSet = true;
      window._markCredential($('ha-token'), true);
      toast('Saved ✓');
      checkHA();
    });
  });

  $('btn-test-ha').addEventListener('click', function () {
    var res = $('ha-test-result');
    res.className = 'test-result hidden';
    var body = haCredentialBody();
    if (!body) return;
    xhr('POST', API + '/api/settings', body, function () {
      xhr('GET', API + '/api/ha/status', null, function (err, data) {
        res.classList.remove('hidden');
        if (!err && data && data.connected) {
          res.className = 'test-result ok';
          res.textContent = '✓ ' + (data.message || 'Connection successful');
          checkHA();
        } else {
          res.className = 'test-result err';
          res.textContent = '✗ ' + (data && data.error ? data.error : 'Connection failed');
        }
      });
    });
  });

  $('toggle-token').addEventListener('click', function () {
    var i = $('ha-token');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  $('smarthome-retry').addEventListener('click', function () { loadSmartHome(true); });

  function pulseRefreshBtn(id) {
    var btn = $(id);
    if (!btn) return;
    btn.classList.add('is-busy');
    setTimeout(function () { btn.classList.remove('is-busy'); }, 600);
  }

  $('smarthome-refresh-btn').addEventListener('click', function () {
    pulseRefreshBtn('smarthome-refresh-btn');
    refreshHADevices({ silent: true });
  });

  /* ── background poll (interval from backend config) ─── */
  var _haPollTimer = null;
  function startHAPolling(intervalSec) {
    if (_haPollTimer) clearInterval(_haPollTimer);
    if (!intervalSec || intervalSec <= 0) return;
    _haPollTimer = setInterval(function () {
      if (!state.haConnected) return;
      if (state.sheet.open) return;
      refreshHADevices({ silent: true });
    }, intervalSec * 1000);
  }

  xhr('GET', API + '/api/config', null, function (err, cfg) {
    var sec = (!err && cfg && cfg.haRefreshIntervalSec != null) ? cfg.haRefreshIntervalSec : 15;
    startHAPolling(sec);
  });

  /* expose openLightSheet for Home module device cards */
  window._openLightSheet = openLightSheet;

})();

/* ════════════════════════════════════════════════════════
   HOME MODULE
   Renders home_widgets on the home tab.
   Owns the widget grid: reads home_widgets, asks window._WIDGETS
   which cards to build, and hands each one its shell. The widgets
   themselves (their markup, their requests) live in js/widgets.js —
   this module only decides what appears and in which order.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _grid       = null;
  var _emptyEl    = null;
  var _widgets    = [];
  var _haEntities = null;

  function $(id) { return document.getElementById(id); }

  /* home-date: re-derived from `new Date()` every time it's called
     rather than once at load, so it rolls over correctly across
     midnight and on wake from standby (see call sites below and the
     scheduler tick further down). */
  function updateHomeDate() {
    var d = new Date();
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var el = $('home-date');
    if (el) el.textContent = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
  }
  updateHomeDate();

  /* mirror HA status dot on home screen */
  (function () {
    var origCheckHA = window._checkHA;
    /* poll every 30s already running in core; just mirror the status-dot class */
    function syncDot() {
      var src = $('status-dot');
      var dst = $('home-ha-dot');
      if (!src || !dst) return;
      dst.className = 'home-ha-dot ' + (
        src.classList.contains('dot-ok')  ? 'home-ha-dot--ok' :
        src.classList.contains('dot-err') ? 'home-ha-dot--err' : 'home-ha-dot--unknown'
      );
    }
    setInterval(syncDot, 3000);
    syncDot();
  })();

  window._homeSetWidgets = function (widgets) {
    _widgets = Array.isArray(widgets) ? widgets : [];
    if (!_haEntities) _haEntities = [];
    if (window._currentPage === 'home' || !window._currentPage) renderHome();
  };

  window._homeRefresh = function () { renderHome(); };

  function getHomeHAWidgets() {
    var haWidgets = [];
    for (var i = 0; i < _widgets.length; i++) {
      if (_widgets[i].type === 'smarthome') haWidgets.push(_widgets[i]);
    }
    return haWidgets;
  }

  /* Called by the core HA poll. The Smart Home widget owns its own
     grid, so this finds it by marker rather than by id — the grid only
     exists while that widget is on the Home screen. */
  window._homeSyncHAEntities = function (entities, summary) {
    var grid = document.querySelector('#home-widgets [data-ha-grid]');
    if (!grid) return;

    var haWidgets = getHomeHAWidgets();
    if (!haWidgets.length) return;

    if (!_haEntities) _haEntities = [];

    /* First snapshot after the card was rendered empty: build the tiles. */
    if (!grid.querySelector('.device-card[data-eid]')) {
      _haEntities = entities.slice();
      if (window._WIDGETS) {
        window._WIDGETS.buildHACards(grid, haWidgets, _haEntities);
        window._WIDGETS.updateHAStatus(haWidgets, _haEntities);
      }
      return;
    }

    if (window._mergeHAEntities) window._mergeHAEntities(_haEntities, entities);

    var map = {};
    for (var i = 0; i < _haEntities.length; i++) map[_haEntities[i].entity_id] = _haEntities[i];
    var cards = grid.querySelectorAll('.device-card[data-eid]');
    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      var eid = card.getAttribute('data-eid');
      if (map[eid] && window._syncHACard) window._syncHACard(card, map[eid]);
    }

    /* The tiles moved, so the header count has to move with them. */
    if (window._WIDGETS) window._WIDGETS.updateHAStatus(haWidgets, _haEntities);
  };

  /* ── shared refresh scheduler ─────────────────────────
     This runs on a wall panel that is never closed, so every widget
     having its own setInterval would multiply into a steady drip of
     requests that nobody is looking at. Instead widgets declare how
     stale they tolerate being, one timer drives all of them, and it
     goes quiet whenever Home is not the visible tab — returning to
     Home re-renders anyway, which refetches everything.

     The Smart Home widget is deliberately absent: the core HA poll
     already pushes it updates through _homeSyncHAEntities. */
  var _scheduled = [];
  var _schedTimer = null;
  var SCHED_TICK_MS = 30000;

  function scheduleRefresh(def, ctx) {
    if (!def.refreshSec) return;
    _scheduled.push({ def: def, ctx: ctx, everyMs: def.refreshSec * 1000, lastAt: Date.now() });
  }

  function startScheduler() {
    if (_schedTimer) return;
    _schedTimer = setInterval(function () {
      /* Cheap DOM write, not a fetch — runs even when Home isn't the
         visible tab so the date is never more than a tick stale, e.g.
         if the panel is simply left open on Home across midnight. */
      updateHomeDate();
      if (window._currentPage && window._currentPage !== 'home') return;

      var now = Date.now();
      for (var i = 0; i < _scheduled.length; i++) {
        var job = _scheduled[i];
        if (now - job.lastAt < job.everyMs) continue;
        job.lastAt = now;
        try {
          /* render() rebuilds into the existing shell, so a refresh
             never recreates the card or reflows the grid. */
          job.def.render(job.ctx);
        } catch (e) {
          /* Same treatment as the initial render's catch below — a broken
             refresh must not leave the card blank until the next cycle.
             IIFE-bind job: it's a loop-scoped var, and the retry callback
             below can fire long after this loop has moved on to (or past)
             other jobs. */
          (function (failedJob) {
            failedJob.ctx.card.setError('Widget failed to load', function () {
              failedJob.def.render(failedJob.ctx);
            });
          })(job);
          if (window.console && window.console.error) window.console.error(e);
        }
      }
    }, SCHED_TICK_MS);
  }

  /* ── main render ──────────────────────────────────────
     Rebuilds the whole grid. Cheap enough (a handful of cards) and it
     keeps saved order authoritative without diffing. */
  function renderHome() {
    updateHomeDate();
    _grid    = $('home-widgets');
    _emptyEl = $('home-empty');
    if (!_grid) return;

    var W = window._WIDGETS;
    if (!W) return;

    /* Every card is about to be replaced, so the jobs pointing at the
       old ones go with them. */
    _scheduled = [];

    /* plan() drops types this build has no widget for, so a saved
       config from an older version renders what it can. */
    var cards = W.plan(_widgets);

    _grid.innerHTML = '';

    if (_emptyEl) {
      if (cards.length) _emptyEl.classList.remove('visible');
      else _emptyEl.classList.add('visible');
    }

    for (var i = 0; i < cards.length; i++) {
      (function (item) {
        var def  = item.def;
        var wide = (typeof def.wide === 'function') ? def.wide(item.entries) : !!def.wide;

        var shell = W.shell({
          title:     def.title,
          icon:      W.icons[def.type],
          wide:      wide,
          flush:     !!def.flush,
          cardClass: def.cardClass,
          onTap:     def.page ? function () { W.goToTab(def.page); } : null
        });

        _grid.appendChild(shell.el);

        var ctx = {
          def:      def,
          card:     shell,
          body:     shell.body,
          entries:  item.entries,
          entry:    item.entries[0],
          entities: _haEntities || []
        };

        scheduleRefresh(def, ctx);

        try {
          def.render(ctx);
        } catch (e) {
          /* One broken widget must not take the dashboard down with it. */
          shell.setError('Widget failed to load', null);
          if (window.console && window.console.error) window.console.error(e);
        }
      })(cards[i]);
    }

    if (_scheduled.length) startScheduler();
  }

  /* ── hook: refresh on home tab click ───────────────── */
  /* handled by core module calling window._homeRefresh() */

})();

/* ════════════════════════════════════════════════════════
   MARKETS MODULE
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var mk = {
    loaded: false,
    searchTimer: null,
    detailSymbol: '',
    detailName: '',
    detailExchange: '',
    detailRange: '1d',
    detailFavorite: false,
    chart: null
  };

  function $m(id) { return document.getElementById(id); }

  function mkGet(url, cb)       { window._xhr('GET',  url, null, cb); }
  function mkPost(url, body, cb){ window._xhr('POST', url, body, cb); }
  function marketToast(msg)     { window._toast(msg); }

  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '—';
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function fmtLargeNumber(v) {
    if (v == null || isNaN(v)) return '—';
    if (v >= 1e12) return (v / 1e12).toFixed(1) + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toString();
  }

  function fmtPercent(v) {
    if (v == null || isNaN(v)) return '—';
    return (Math.round(v * 10000) / 100).toFixed(2) + '%';
  }

  function mkChangeClass(v) {
    if (v > 0) return 'up';
    if (v < 0) return 'down';
    return 'flat';
  }

  function fmtChange(v, p) {
    if (v == null || p == null) return '—';
    var sign = v > 0 ? '+' : '';
    return sign + (Math.round(v * 100) / 100).toFixed(2) + ' (' + sign + (Math.round(p * 100) / 100).toFixed(2) + '%)';
  }

  function loadFavorites() {
    $m('mk-loading').classList.remove('hidden');
    $m('mk-error').classList.add('hidden');
    mkGet('/api/markets/favorites', function (err, data) {
      $m('mk-loading').classList.add('hidden');
      if (err || !data) {
        $m('mk-error').classList.remove('hidden');
        $m('mk-error-msg').textContent = err || 'Error loading markets';
        return;
      }
      renderFavorites(data.items || []);
      mk.loaded = true;
    });
  }

  function renderFavorites(items) {
    var wrap = $m('mk-favorites');
    wrap.innerHTML = '';
    if (!items.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-title">No favourites</div><div class="empty-desc">Search for a symbol and add it to your watchlist.</div></div>';
      $m('markets-subtitle').textContent = 'Favourites · 0';
      return;
    }

    $m('markets-subtitle').textContent = 'Favourites · ' + items.length;
    for (var i = 0; i < items.length; i++) {
      wrap.appendChild(makeMarketRow(items[i]));
    }
  }

  function makeMarketRow(item) {
    var row = document.createElement('div');
    var cls = mkChangeClass(item.change);
    row.className = 'mk-row';
    row.innerHTML =
      '<div class="mk-left">' +
        '<div class="mk-symbol">' + (item.symbol || '—') + '</div>' +
        '<div class="mk-name">' + (item.name || '') + '</div>' +
      '</div>' +
      '<div class="mk-right">' +
        '<div class="mk-price">' + fmtPrice(item.price) + '</div>' +
        '<div class="mk-change ' + cls + '">' + fmtChange(item.change, item.changePercent) + '</div>' +
      '</div>';
    row.addEventListener('click', function () {
      openDetail(item.symbol, item.name || item.symbol, item.exchange || '');
    });
    return row;
  }

  function renderSearch(items) {
    var wrap = $m('mk-search-results');
    wrap.innerHTML = '';
    for (var i = 0; i < items.length; i++) {
      (function (it) {
        var r = document.createElement('button');
        r.type = 'button';
        r.className = 'weather-search-item';
        r.innerHTML = '<strong>' + (it.symbol || '') + ' · ' + (it.name || '') + '</strong>' +
          '<span>' + (it.exchange || '') + (it.type ? (' · ' + it.type) : '') + '</span>';
        r.addEventListener('click', function () {
          wrap.innerHTML = '';
          $m('mk-search').value = '';
          openDetail(it.symbol, it.name || it.symbol, it.exchange || '');
        });
        wrap.appendChild(r);
      })(items[i]);
    }
  }

  function openDetail(symbol, name, exchange) {
    mk.detailSymbol = symbol;
    mk.detailName = name || symbol;
    mk.detailExchange = exchange || '';
    mk.detailRange = '1d';

    $m('mk-detail').classList.remove('hidden');
    $m('mk-detail-symbol').textContent = symbol || '—';
    $m('mk-detail-name').textContent = mk.detailName + (mk.detailExchange ? (' · ' + mk.detailExchange) : '');
    updateRangeButtons();
    loadDetail();
  }

  function updateFavButton() {
    var b = $m('mk-fav-toggle');
    if (mk.detailFavorite) {
      b.classList.add('on');
      b.textContent = '★';
    } else {
      b.classList.remove('on');
      b.textContent = '☆';
    }
  }

  function updateRangeButtons() {
    var btns = document.querySelectorAll('.mk-range-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-range') === mk.detailRange) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
  }

  function loadDetail() {
    if (!mk.detailSymbol) return;
    mkGet('/api/markets/detail?symbol=' + encodeURIComponent(mk.detailSymbol) +
      '&range=' + encodeURIComponent(mk.detailRange), function (err, data) {
      if (err || !data) {
        marketToast('Error loading detail');
        return;
      }
      mk.detailFavorite = !!data.isFavorite;
      updateFavButton();
      renderDetail(data);
    });
  }

  function renderDetail(data) {
    var cls = mkChangeClass(data.change);
    $m('mk-detail-price').textContent = fmtPrice(data.price);
    $m('mk-detail-change').textContent = fmtChange(data.change, data.changePercent);
    $m('mk-detail-change').className = cls;

    // Additional info
    $m('mk-day-low').textContent = fmtPrice(data.dayLow);
    $m('mk-day-high').textContent = fmtPrice(data.dayHigh);
    $m('mk-volume').textContent = fmtLargeNumber(data.volume);
    $m('mk-market-cap').textContent = fmtLargeNumber(data.marketCap);
    $m('mk-pe-ratio').textContent = data.peRatio != null ? data.peRatio.toFixed(2) : '—';
    $m('mk-dividend-yield').textContent = fmtPercent(data.dividendYield);
    $m('mk-52w-low').textContent = fmtPrice(data.fiftyTwoWeekLow);
    $m('mk-52w-high').textContent = fmtPrice(data.fiftyTwoWeekHigh);

    var points = data.points || [];
    renderDetailChart(points);
  }

  function renderDetailChart(points) {
    if (!window.Chartist) return;
    var labels = [];
    var vals = [];
    var len = points.length;
    var step = len > 80 ? Math.ceil(len / 80) : 1;
    for (var i = 0; i < len; i += step) {
      var d = new Date(points[i].t * 1000);
      var label = '';
      if (mk.detailRange === '1d') {
        label = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      } else if (mk.detailRange === '1wk' || mk.detailRange === '1mo') {
        label = (d.getMonth() + 1) + '/' + d.getDate();
      } else {
        label = d.getFullYear() + '/' + (d.getMonth() + 1);
      }
      labels.push(label);
      vals.push(points[i].v);
    }

    var MAX_LABELS = 6;
    var labelCount = labels.length;
    var labelStep = labelCount > MAX_LABELS ? Math.ceil(labelCount / MAX_LABELS) : 1;

    if (mk.chart && mk.chart.detach) {
      try { mk.chart.detach(); } catch (e) {}
    }
    mk.chart = new Chartist.Line('#mk-chart', {
      labels: labels,
      series: [vals]
    }, {
      showPoint: false,
      lineSmooth: false,
      fullWidth: true,
      axisX: {
        showGrid: false,
        showLabel: true,
        labelInterpolationFnc: function(value, index) {
          return index % labelStep === 0 ? value : null;
        }
      },
      axisY: {
        showGrid: true,
        showLabel: true,
        onlyInteger: false,
        offset: 40,
        labelInterpolationFnc: function(value) { return fmtPrice(value); }
      },
      chartPadding: { top: 8, right: 8, bottom: 8, left: 0 }
    });
  }

  $m('mk-back').addEventListener('click', function () {
    $m('mk-detail').classList.add('hidden');
  });

  $m('mk-fav-toggle').addEventListener('click', function () {
    if (!mk.detailSymbol) return;
    mkPost('/api/markets/favorites/toggle', {
      symbol: mk.detailSymbol,
      name: mk.detailName,
      exchange: mk.detailExchange
    }, function (err, data) {
      if (err || !data) {
        marketToast('Error updating favorites');
        return;
      }
      mk.detailFavorite = !!data.isFavorite;
      updateFavButton();
      loadFavorites();
    });
  });

  var rangeBtns = document.querySelectorAll('.mk-range-btn');
  for (var rb = 0; rb < rangeBtns.length; rb++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        mk.detailRange = btn.getAttribute('data-range') || '1d';
        updateRangeButtons();
        loadDetail();
      });
    })(rangeBtns[rb]);
  }

  $m('mk-search').addEventListener('input', function () {
    clearTimeout(mk.searchTimer);
    var q = ($m('mk-search').value || '').trim();
    if (!q) {
      $m('mk-search-results').innerHTML = '';
      return;
    }
    mk.searchTimer = setTimeout(function () {
      mkGet('/api/markets/search?q=' + encodeURIComponent(q), function (err, data) {
        if (err || !data) {
          $m('mk-search-results').innerHTML = '<div class="form-hint">An error occurred while searching</div>';
          return;
        }
        renderSearch(data.items || []);
      });
    }, 300);
  });

  $m('mk-retry').addEventListener('click', function () {
    loadFavorites();
  });

  var marketsTab = document.querySelector('[data-page="markets"]');
  if (marketsTab) {
    marketsTab.addEventListener('click', function () {
      loadFavorites();
    }, true);
  }

  /* used by the core module's wake-from-standby handler */
  window._marketsRefresh = loadFavorites;
})();

/* ════════════════════════════════════════════════════════
   WEATHER MODULE

   Renders the Weather tab from a single /api/weather/forecast
   call: a hero, a scrollable next-24-hours strip, a grid of
   metric tiles, and a 10-day list with range bars.

   Two rules this module follows throughout:

   1. It never constructs a Date from an API string. Open-Meteo
      returns timezone-less local ISO ("2026-08-31T14:00"), which
      iOS 9 WebKit parses as UTC under the ES5 rule — every clock
      label would be shifted by the location's offset. The route
      pre-formats `clock`, `weekday`, `sunriseTime` and friends,
      and this module only ever prints them.

   2. Everything numeric that reaches the DOM goes through the
      formatters below, so a missing upstream field renders as a
      dash instead of "NaN" or "undefined°".
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var wx = {
    defaultLocation: null,
    transientLocation: null,
    selectedSettingsLocation: null,
    settingsSearchTimer: null,
    meteoSearchTimer: null,
    loaded: false,
    /* The day browser: the last forecast payload, the location it
       describes, and which day of it the hero, strip and tiles are
       currently showing. 0 is today, the only index with live data. */
    data: null,
    location: null,
    selectedDayIndex: 0
  };

  function $w(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function wxGet(url, cb)            { window._xhr('GET',  url, null, cb); }
  function wxPostSettings(body, cb)  { window._xhr('POST', '/api/settings', body, cb); }
  function wxToast(msg)              { window._toast(msg); }

  /* ── formatters ──────────────────────────────────────── */
  function num(v) {
    return (v === undefined || v === null || isNaN(v)) ? null : v;
  }

  function temp(v) {
    return num(v) === null ? '--°' : Math.round(v) + '°';
  }

  function locLabel(loc) {
    if (!loc) return '—';
    var parts = [loc.name || ''];
    if (loc.admin1) parts.push(loc.admin1);
    if (loc.country) parts.push(loc.country);
    return parts.join(', ');
  }

  function weatherCodeLabel(code) {
    if (code === 0) return 'Clear';
    if (code === 1) return 'Mostly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if (code === 51 || code === 53 || code === 55) return 'Drizzle';
    if (code === 56 || code === 57) return 'Freezing drizzle';
    if (code === 61 || code === 63 || code === 65) return 'Rain';
    if (code === 66 || code === 67) return 'Freezing rain';
    if (code === 71 || code === 73 || code === 75) return 'Snow';
    if (code === 77) return 'Ice pellets';
    if (code === 80 || code === 81 || code === 82) return 'Showers';
    if (code === 85 || code === 86) return 'Snow showers';
    if (code === 95) return 'Thunderstorm';
    if (code === 96 || code === 99) return 'Thunderstorm with hail';
    return 'Variable';
  }

  /* 0-360 -> the compass point the wind is blowing FROM */
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) {
    if (num(deg) === null) return '';
    return COMPASS[Math.round(deg / 22.5) % 16];
  }

  /* The UV number alone means little; the band is the actionable part. */
  function uvBand(uv) {
    if (num(uv) === null) return '';
    if (uv < 3)  return 'Low';
    if (uv < 6)  return 'Moderate';
    if (uv < 8)  return 'High';
    if (uv < 11) return 'Very high';
    return 'Extreme';
  }

  function pct(v) {
    return num(v) === null ? '—' : Math.round(v) + '%';
  }

  /* ── small inline icons for the metric tiles ─────────── */
  function tileIcon(path) {
    return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none">' + path + '</svg>';
  }
  var TILE_ICONS = {
    feels:  tileIcon('<path d="M12 3v10.5a3.5 3.5 0 1 1-2 0V3a1 1 0 0 1 2 0z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    hum:    tileIcon('<path d="M12 3s6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 6-11 6-11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
    wind:   tileIcon('<path d="M3 8h11a3 3 0 1 0-3-3M3 14h14a3 3 0 1 1-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    uv:     tileIcon('<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    press:  tileIcon('<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 12l4-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    precip: tileIcon('<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.2A3.5 3.5 0 1 1 17 15z" stroke="currentColor" stroke-width="1.6"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
    sun:    tileIcon('<path d="M4 17h16M7.5 17a4.5 4.5 0 0 1 9 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 4v2.5M5.6 7.6l1.8 1.8M18.4 7.6l-1.8 1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
    cloud:  tileIcon('<path d="M7 18a4.5 4.5 0 0 1 0-9 5.5 5.5 0 0 1 10.5-1.3A3.9 3.9 0 1 1 17.5 18z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>')
  };

  /* ── settings / location plumbing ────────────────────── */
  function loadSettingsWeather(cb) {
    wxGet('/api/settings', function (err, data) {
      if (err || !data) { cb(err || 'Error loading settings', null); return; }
      wx.defaultLocation = data.weather_default_location || null;
      cb(null, data);
    });
  }

  function renderLocationSearchResults(container, locations, onPick) {
    clear(container);
    if (!locations || !locations.length) {
      container.appendChild(el('div', 'form-hint', 'No results found'));
      return;
    }
    for (var i = 0; i < locations.length; i++) {
      (function (loc) {
        var b = el('button', 'weather-search-item');
        b.type = 'button';
        b.appendChild(el('strong', null, loc.name));
        b.appendChild(el('span', null,
          (loc.admin1 || '') + (loc.admin1 && loc.country ? ', ' : '') + (loc.country || '')));
        b.addEventListener('click', function () { onPick(loc); });
        container.appendChild(b);
      })(locations[i]);
    }
  }

  function loadForecastForLocation(loc, forceRefresh) {
    if (!loc) return;

    /* Reset the day browser here rather than on tab entry: a one-off
       location search and a saved default both land on this path, and a
       selection surviving either would show one city's Tuesday under
       another city's name. */
    wx.selectedDayIndex = 0;

    $w('weather-loading').classList.remove('hidden');
    $w('weather-error').classList.add('hidden');
    $w('weather-content').classList.add('hidden');

    var url = '/api/weather/forecast?lat=' + encodeURIComponent(loc.latitude) +
      '&lon=' + encodeURIComponent(loc.longitude) +
      '&timezone=' + encodeURIComponent(loc.timezone || 'auto');

    if (forceRefresh) url += '&force=true';

    wxGet(url, function (err, data) {
      $w('weather-loading').classList.add('hidden');
      if (err || !data) {
        $w('weather-error').classList.remove('hidden');
        $w('weather-error-msg').textContent = err || 'Error loading weather data';
        return;
      }
      $w('weather-content').classList.remove('hidden');
      wx.loaded = true;
      wx.data = data;
      wx.location = loc;
      renderWeather(data, loc);
    });
  }

  /**
   * Point the whole view at a different day. Everything needed is already
   * in the cached payload, so this never refetches — switching days is
   * local work, which is what makes the list usable as a picker.
   */
  function selectDay(index) {
    if (!wx.data) return;
    var days = wx.data.days || [];
    if (index < 0 || index >= days.length) return;
    wx.selectedDayIndex = index;
    renderWeather(wx.data, wx.location);
    /* Jump back to the top so the day just picked is what you are looking
       at — the tap lands at the bottom of a scrolled page, and the detail
       it selects is rendered above the fold.
       `.page` is the scroller here (#app is fixed and overflow:hidden),
       not the window, so scrollTo() would be a no-op. */
    var page = document.getElementById('page-meteo');
    if (page) page.scrollTop = 0;
  }

  /* ── render: the reference-day bar ───────────────────────
     Always on top of the view, so which day everything below refers to
     is never in doubt. It is also where the way back lives. */
  function renderDayBar(data, dayIndex) {
    var host = $w('wx-daybar');
    if (!host) return;
    clear(host);

    var day = (data.days || [])[dayIndex] || {};
    var isToday = dayIndex === 0;

    var label = el('div', 'wx-daybar-label');
    if (isToday) label.appendChild(el('span', 'wx-daybar-today', 'Today'));
    label.appendChild(el('span', 'wx-daybar-date', day.dateLabel || day.date || ''));
    host.appendChild(label);

    host.appendChild(el('span', 'wx-daybar-spacer'));

    /* The way back only exists when there is somewhere to go back from. */
    if (!isToday) {
      var back = el('button', 'wx-daybar-back', 'Today');
      back.type = 'button';
      back.addEventListener('click', function () { selectDay(0); });
      host.appendChild(back);
    }
  }

  /* ── render: hero ────────────────────────────────────── */
  function renderHero(data, loc, dayIndex) {
    var host = $w('wx-hero');
    if (!host) return;
    clear(host);

    var isToday = dayIndex === 0;
    var cur     = data.current || {};
    var day     = (data.days || [])[dayIndex] || {};

    /* A browsed day has no time of day, so it is always drawn in its
       daylight form; only today follows the sun. */
    var isDay = isToday ? (cur.is_day != null ? cur.is_day : 1) : 1;
    var code  = isToday ? cur.weather_code : day.weatherCode;

    host.className = 'wx-hero' + (isDay ? '' : ' is-night');

    var top = el('div', 'wx-hero-top');
    top.appendChild(el('div', 'wx-hero-loc', locLabel(loc)));
    /* "as of" is a live-only fact — a Thursday has no reading time. */
    if (isToday && data.currentTime) {
      top.appendChild(el('div', 'wx-hero-updated', 'as of ' + data.currentTime));
    }
    host.appendChild(top);

    var main = el('div', 'wx-hero-main');

    var icon = el('div', 'wx-hero-icon');
    if (window._wxIcon) icon.innerHTML = window._wxIcon(code, isDay, 56);
    main.appendChild(icon);

    /* Today leads with the temperature it is now; any other day leads
       with its high, which is that day's headline number. */
    main.appendChild(el('div', 'wx-hero-temp',
      isToday ? temp(cur.temperature_2m) : temp(day.tempMax)));

    var meta = el('div', 'wx-hero-meta');
    meta.appendChild(el('div', 'wx-hero-cond', weatherCodeLabel(code)));

    var feels = isToday ? num(cur.apparent_temperature) : num(day.feelsMax);
    if (feels !== null) {
      meta.appendChild(el('div', 'wx-hero-feels',
        (isToday ? 'Feels like ' : 'Feels up to ') + temp(feels)));
    }
    main.appendChild(meta);

    /* spacer keeps the right-hand block pinned while the condition truncates */
    var spacer = el('div');
    spacer.style.cssText = '-webkit-box-flex:1;-webkit-flex:1;flex:1;min-width:0';
    main.appendChild(spacer);

    var range = el('div', 'wx-hero-range');
    if (isToday) {
      range.appendChild(el('div', 'wx-hero-range-hi', 'H ' + temp(day.tempMax)));
      range.appendChild(el('div', 'wx-hero-range-lo', 'L ' + temp(day.tempMin)));
    } else {
      /* The high is already the big number, so repeating it here would
         waste the slot — spend it on the low and the sunshine instead. */
      range.appendChild(el('div', 'wx-hero-range-hi', 'L ' + temp(day.tempMin)));
      if (num(day.sunshineHours) !== null) {
        range.appendChild(el('div', 'wx-hero-range-lo', day.sunshineHours + ' h sun'));
      }
    }
    main.appendChild(range);

    host.appendChild(main);
  }

  /* ── render: the hourly strip ────────────────────────────
     Today reads from `hourly` — the next 24 hours from now, which
     crosses midnight. Any other day reads that day's own 24 entries
     from `hoursByDate`, starting at 00:00. */
  function renderHours(data, dayIndex) {
    var host = $w('wx-hours');
    if (!host) return;
    clear(host);

    var isToday = dayIndex === 0;
    var day     = (data.days || [])[dayIndex] || {};
    var hours   = isToday
      ? (data.hourly || [])
      : ((data.hoursByDate || {})[day.date] || []);

    var title = $w('wx-hours-title');
    if (title) title.textContent = isToday ? 'Next 24 hours' : 'Hour by hour';

    if (!hours.length) {
      host.appendChild(el('div', 'form-hint', 'Hourly forecast unavailable'));
      return;
    }

    for (var i = 0; i < hours.length; i++) {
      var h = hours[i];
      /* "Now" only means something on today's strip. */
      var isNow = isToday && i === 0;
      var col = el('div', 'wx-hour' + (isNow ? ' is-now' : '') + (h.isDay ? ' is-day' : ''));

      col.appendChild(el('div', 'wx-hour-label', isNow ? 'Now' : h.clock));

      var ico = el('div', 'wx-hour-icon');
      if (window._wxIcon) ico.innerHTML = window._wxIcon(h.weatherCode, h.isDay, 22);
      col.appendChild(ico);

      col.appendChild(el('div', 'wx-hour-temp', temp(h.temp)));

      /* Only worth the ink above a threshold — a strip of "0%" is noise. */
      col.appendChild(el('div', 'wx-hour-precip',
        (num(h.precipProb) !== null && h.precipProb >= 10) ? Math.round(h.precipProb) + '%' : ''));

      col.appendChild(el('div', 'wx-hour-band'));

      host.appendChild(col);
    }
  }

  /* ── render: metric tiles ────────────────────────────── */
  function metricTile(icon, label, value, sub, foot) {
    var tile = el('div', 'wx-metric');

    var lab = el('div', 'wx-metric-label');
    if (icon) {
      var ic = el('span');
      ic.innerHTML = icon;
      ic.style.cssText = 'line-height:0;display:inline-block';
      lab.appendChild(ic);
    }
    lab.appendChild(el('span', null, label));
    tile.appendChild(lab);

    tile.appendChild(el('div', 'wx-metric-value', value));
    if (sub) tile.appendChild(el('div', 'wx-metric-sub', sub));
    if (foot) {
      var f = el('div', 'wx-metric-foot');
      f.appendChild(foot);
      tile.appendChild(f);
    }
    return tile;
  }

  /* A 0-11+ UV reading placed on the standard colour scale. */
  function uvScale(uv) {
    var wrap = el('div', 'wx-scale');
    var marker = el('div', 'wx-scale-marker');
    marker.style.left = Math.max(0, Math.min(100, (uv / 11) * 100)) + '%';
    wrap.appendChild(marker);
    return wrap;
  }

  /* Sunrise -> sunset as a track, with the marker at the current time. */
  /**
   * Sunrise -> sunset as a track. `currentMin` is null for any day other
   * than today: a browsed day has no "now", so it gets the bare track
   * with no fill and no marker rather than both pinned at zero, which
   * would read as "the sun has not risen".
   */
  function sunArc(day, currentMin) {
    var wrap = el('div');

    var rise = num(day.sunriseMin);
    var set  = num(day.sunsetMin);

    var track = el('div', 'wx-arc');
    if (rise !== null && set !== null && set > rise && currentMin !== null) {
      var progress = Math.max(0, Math.min(1, (currentMin - rise) / (set - rise)));

      var fill = el('div', 'wx-arc-fill');
      fill.style.width = (progress * 100) + '%';
      track.appendChild(fill);

      /* Before dawn or after dusk there is no position in the day to
         show, so the marker is simply omitted. */
      if (currentMin >= rise && currentMin <= set) {
        var marker = el('div', 'wx-arc-marker');
        marker.style.left = (progress * 100) + '%';
        track.appendChild(marker);
      }
    }
    wrap.appendChild(track);

    var ends = el('div', 'wx-arc-ends');
    ends.appendChild(el('span', null, day.sunriseTime || '—'));
    ends.appendChild(el('span', null, day.sunsetTime || '—'));
    wrap.appendChild(ends);

    return wrap;
  }

  function windDial(deg) {
    if (num(deg) === null) return null;
    var wrap = el('span', 'wx-wind-arrow');
    /* Meteorological convention: the reported angle is where the wind
       comes FROM, so the arrow is turned 180° to point where it goes. */
    var rot = (deg + 180) % 360;
    wrap.style.cssText = '-webkit-transform:rotate(' + rot + 'deg);transform:rotate(' + rot + 'deg)';
    wrap.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none">' +
      '<path d="M12 3v18M12 3l-5 5M12 3l5 5" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return wrap;
  }

  /**
   * Today gets all eight tiles, because a live reading exists for all of
   * them. A browsed day gets five: humidity, pressure and cloud cover
   * have no daily aggregate, and a 24-hour mean of any of them is not a
   * number anyone acts on, so they are omitted rather than invented.
   */
  function renderMetrics(data, dayIndex) {
    var host = $w('wx-metrics');
    if (!host) return;
    clear(host);

    var isToday = dayIndex === 0;
    var cur     = data.current || {};
    var day     = (data.days || [])[dayIndex] || {};

    /* Feels like — for today the delta from actual is the point; for a
       browsed day it is the span the day is expected to cover. */
    if (isToday) {
      var feels = num(cur.apparent_temperature);
      var real  = num(cur.temperature_2m);
      var feelsSub = '';
      if (feels !== null && real !== null) {
        var delta = Math.round(feels) - Math.round(real);
        feelsSub = delta === 0 ? 'Same as actual'
          : (Math.abs(delta) + '° ' + (delta > 0 ? 'warmer' : 'cooler') + ' than actual');
      }
      host.appendChild(metricTile(TILE_ICONS.feels, 'Feels like', temp(feels), feelsSub));
    } else {
      host.appendChild(metricTile(TILE_ICONS.feels, 'Feels like',
        temp(day.feelsMax),
        num(day.feelsMin) === null ? '' : ('Down to ' + temp(day.feelsMin))));
    }

    /* Humidity — live only */
    if (isToday) {
      host.appendChild(metricTile(TILE_ICONS.hum, 'Humidity',
        pct(cur.relative_humidity_2m),
        num(cur.cloud_cover) !== null ? (pct(cur.cloud_cover) + ' cloud cover') : ''));
    }

    /* Wind, with a dial pointing downwind */
    var windSpeed = isToday ? cur.wind_speed_10m : day.windMax;
    var windDeg   = isToday ? cur.wind_direction_10m : day.windDir;
    var windVal   = num(windSpeed) === null ? '—' : Math.round(windSpeed) + ' km/h';
    var windTile  = metricTile(TILE_ICONS.wind, isToday ? 'Wind' : 'Wind, peak', windVal,
      compass(windDeg) ? ('From ' + compass(windDeg)) : '');
    var dial = windDial(windDeg);
    if (dial) {
      var dialFoot = el('div', 'wx-metric-foot');
      dialFoot.appendChild(dial);
      windTile.appendChild(dialFoot);
    }
    host.appendChild(windTile);

    /* UV index — a daily maximum either way */
    var uv = num(day.uvIndexMax);
    host.appendChild(metricTile(TILE_ICONS.uv, 'UV index',
      uv === null ? '—' : String(Math.round(uv)),
      uvBand(uv),
      uv === null ? null : uvScale(uv)));

    /* Precipitation — probability first, amount as the supporting detail */
    var precipSum = num(day.precipSum);
    host.appendChild(metricTile(TILE_ICONS.precip, 'Precipitation',
      pct(day.precipProb),
      precipSum === null ? '' :
        ((Math.round(precipSum * 10) / 10) + ' mm expected' + (isToday ? ' today' : ''))));

    /* Pressure — live only */
    if (isToday) {
      host.appendChild(metricTile(TILE_ICONS.press, 'Pressure',
        num(cur.surface_pressure) === null ? '—' : Math.round(cur.surface_pressure) + ' hPa',
        'Surface'));
    }

    /* Sun. The arc only carries a marker for today, where "now" exists. */
    var daylight = num(day.daylightHours);
    host.appendChild(metricTile(TILE_ICONS.sun, 'Sunrise & sunset',
      day.sunriseTime || '—',
      daylight === null
        ? (day.sunsetTime ? ('Sets at ' + day.sunsetTime) : '')
        : (daylight + ' h of daylight'),
      sunArc(day, isToday ? num(data.currentMin) : null)));

    /* Cloud cover — live only */
    if (isToday) {
      host.appendChild(metricTile(TILE_ICONS.cloud, 'Cloud cover',
        pct(cur.cloud_cover),
        weatherCodeLabel(cur.weather_code)));
    }
  }

  /* ── render: 10-day list ─────────────────────────────── */
  function renderDays(data, selectedIndex) {
    var host = $w('wx-days');
    if (!host) return;
    clear(host);

    var days = data.days || [];
    if (!days.length) return;

    /* One shared scale across all ten rows: that is what makes the bars
       comparable, and a cold snap visible as a shape. */
    var lo = null, hi = null;
    for (var s = 0; s < days.length && s < 10; s++) {
      var dmin = num(days[s].tempMin), dmax = num(days[s].tempMax);
      if (dmin !== null) lo = (lo === null || dmin < lo) ? dmin : lo;
      if (dmax !== null) hi = (hi === null || dmax > hi) ? dmax : hi;
    }
    /* A flat ten days would divide by zero; give the span a floor. */
    if (lo === null || hi === null) { lo = 0; hi = 1; }
    if (hi - lo < 1) hi = lo + 1;
    var span = hi - lo;

    var nowTemp = num((data.current || {}).temperature_2m);

    for (var i = 0; i < days.length && i < 10; i++) {
      (function (d, index) {
        var isToday    = index === 0;
        var isSelected = index === selectedIndex;

        /* A real <button>, not a div with a click handler: the rows are
           the day picker, so they need to be reachable by keyboard and
           announced as actionable. The CSS resets it back to looking
           like a row. */
        var row = el('button', 'wx-day' +
          (isToday ? ' is-today' : '') +
          (isSelected ? ' is-selected' : ''));
        row.type = 'button';
        row.addEventListener('click', function () { selectDay(index); });

        row.appendChild(el('div', 'wx-day-name', isToday ? 'Today' : (d.weekday || d.date)));

        var ico = el('div', 'wx-day-icon');
        if (window._wxIcon) ico.innerHTML = window._wxIcon(d.weatherCode, 1, 20);
        row.appendChild(ico);

        row.appendChild(el('div', 'wx-day-precip',
          (num(d.precipProb) !== null && d.precipProb >= 10) ? Math.round(d.precipProb) + '%' : ''));

        row.appendChild(el('div', 'wx-day-lo', temp(d.tempMin)));

        var bar = el('div', 'wx-day-bar');
        var dmin2 = num(d.tempMin), dmax2 = num(d.tempMax);
        if (dmin2 !== null && dmax2 !== null) {
          var left  = ((dmin2 - lo) / span) * 100;
          var width = ((dmax2 - dmin2) / span) * 100;
          var fill  = el('div', 'wx-day-bar-fill');
          fill.style.left  = left + '%';
          /* Keep a sliver visible when min and max coincide. */
          fill.style.width = Math.max(width, 2) + '%';
          bar.appendChild(fill);

          if (isToday && nowTemp !== null) {
            var marker = el('div', 'wx-day-bar-now');
            marker.style.left = Math.max(0, Math.min(100, ((nowTemp - lo) / span) * 100)) + '%';
            bar.appendChild(marker);
          }
        }
        row.appendChild(bar);

        row.appendChild(el('div', 'wx-day-hi', temp(d.tempMax)));

        host.appendChild(row);
      })(days[i], i);
    }
  }

  function renderWeather(data, loc) {
    /* Clamp defensively: a shorter forecast horizon (or a payload from a
       cache entry written by an older build) must not leave the view
       pointing at a day that isn't there. */
    var dayIndex = wx.selectedDayIndex;
    if (!data.days || dayIndex < 0 || dayIndex >= data.days.length) {
      dayIndex = 0;
      wx.selectedDayIndex = 0;
    }

    $w('weather-subtitle').textContent = locLabel(loc);
    renderDayBar(data, dayIndex);
    renderHero(data, loc, dayIndex);
    renderHours(data, dayIndex);
    renderMetrics(data, dayIndex);
    renderDays(data, dayIndex);
  }

  function loadWeatherPage() {
    loadSettingsWeather(function (err) {
      if (err) {
        $w('weather-loading').classList.add('hidden');
        $w('weather-error').classList.remove('hidden');
        $w('weather-error-msg').textContent = err;
        return;
      }
      var loc = wx.transientLocation || wx.defaultLocation;
      if (!loc) {
        $w('weather-loading').classList.add('hidden');
        $w('weather-content').classList.add('hidden');
        $w('weather-error').classList.remove('hidden');
        $w('weather-error-msg').textContent = 'Set a weather location in Settings';
        return;
      }
      loadForecastForLocation(loc);
    });
  }

  /* ── Settings block ──────────────────────────────────── */
  function initWeatherSettingsBlock() {
    var searchInput = $w('wx-settings-search');
    var resultsEl = $w('wx-settings-results');
    var selectedEl = $w('wx-settings-selected');

    if (!searchInput || !resultsEl || !selectedEl) return;
    function refreshSelectedLabel() {
      var loc = wx.selectedSettingsLocation || wx.defaultLocation;
      selectedEl.textContent = loc
        ? ('Location selected: ' + locLabel(loc))
        : 'No location selected.';
      searchInput.value = loc ? locLabel(loc) : '';
    }

    refreshSelectedLabel();

    searchInput.addEventListener('input', function () {
      clearTimeout(wx.settingsSearchTimer);
      var q = (searchInput.value || '').trim();
      if (!q) { clear(resultsEl); return; }
      wx.settingsSearchTimer = setTimeout(function () {
        wxGet('/api/weather/search?q=' + encodeURIComponent(q), function (err, data) {
          if (err || !data) {
            clear(resultsEl);
            resultsEl.appendChild(el('div', 'form-hint', 'An error occurred while searching for location'));
            return;
          }
          renderLocationSearchResults(resultsEl, data.locations || [], function (loc) {
            wx.selectedSettingsLocation = loc;
            refreshSelectedLabel();
            clear(resultsEl);
          });
        });
      }, 400);
    });

    $w('wx-save-default').addEventListener('click', function () {
      if (!wx.selectedSettingsLocation) {
        wxToast('Select a location before saving');
        return;
      }

      wxPostSettings({
        weather_default_location: wx.selectedSettingsLocation
      }, function (err) {
        if (err) {
          wxToast('Error: ' + err);
          return;
        }
        wx.defaultLocation = wx.selectedSettingsLocation;
        /* A new default replaces any one-off location the tab was
           showing, otherwise saving appears to do nothing. */
        wx.transientLocation = null;
        refreshSelectedLabel();
        wxToast('Default location saved ✓');
      });
    });
  }

  /* ── one-off location search on the tab ──────────────── */
  function initMeteoTransientSearch() {
    var toggle  = $w('weather-other-location');
    var panel   = $w('weather-search-panel');
    var input   = $w('weather-search-input');
    var results = $w('weather-search-results');

    toggle.addEventListener('click', function () {
      var opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      if (opening) toggle.classList.add('is-active');
      else toggle.classList.remove('is-active');
    });

    input.addEventListener('input', function () {
      clearTimeout(wx.meteoSearchTimer);
      var q = (input.value || '').trim();
      if (!q) { clear(results); return; }
      wx.meteoSearchTimer = setTimeout(function () {
        wxGet('/api/weather/search?q=' + encodeURIComponent(q), function (err, data) {
          if (err || !data) {
            clear(results);
            results.appendChild(el('div', 'form-hint', 'An error occurred while searching for location'));
            return;
          }
          renderLocationSearchResults(results, data.locations || [], function (loc) {
            wx.transientLocation = loc;
            input.value = '';
            clear(results);
            panel.classList.add('hidden');
            toggle.classList.remove('is-active');
            loadForecastForLocation(loc);
          });
        });
      }, 350);
    });
  }

  $w('weather-retry').addEventListener('click', function () {
    loadWeatherPage();
  });

  $w('weather-refresh-btn').addEventListener('click', function () {
    var loc = wx.transientLocation || wx.defaultLocation;
    if (!loc) return;
    var btn = $w('weather-refresh-btn');
    btn.classList.add('is-busy');
    setTimeout(function () { btn.classList.remove('is-busy'); }, 600);
    loadForecastForLocation(loc, true);
  });

  document.querySelector('[data-page="meteo"]').addEventListener('click', function () {
    setTimeout(function () { loadWeatherPage(); }, 60);
  }, true);

  /* used by the core module's wake-from-standby handler */
  window._weatherRefresh = loadWeatherPage;

  /* Weather registers itself with the central settings loader */
  window._onSettingsLoad(function (data) {
    wx.defaultLocation = data.weather_default_location || null;
    wx.selectedSettingsLocation = wx.defaultLocation || null;
    var selected = $w('wx-settings-selected');
    var input    = $w('wx-settings-search');
    if (selected) {
      selected.textContent = wx.defaultLocation
        ? ('Location selected: ' + locLabel(wx.defaultLocation))
        : 'No location selected.';
    }
    if (input) {
      input.value = wx.defaultLocation ? locLabel(wx.defaultLocation) : '';
    }
  });

  initWeatherSettingsBlock();
  initMeteoTransientSearch();
})();

/* ════════════════════════════════════════════════════════
   JELLYFIN MODULE
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── state ─────────────────────────────────────────── */
  var jf = {
    userId:   null,
    type:     'Movie',
    page:     0,
    total:    0,
    loading:  false,
    searchTimer: null,
    currentItem: null
  };

  /* ── helpers (local) ────────────────────────────────── */
  function $j(id) { return document.getElementById(id); }

  function jfXhr(url, cb)       { window._xhr('GET',  url, null, cb); }
  function jfPost(url, body, cb){ window._xhr('POST', url, body, cb); }
  function jfToast(msg)         { window._toast(msg); }

  /* ── load user id ───────────────────────────────────── */
  function ensureUserId(cb) {
    if (jf.userId) { cb(null); return; }
    jfXhr('/api/jf/userid', function (err, data) {
      if (err || !data || !data.userId) { cb(err || 'Nessun utente trovato'); return; }
      jf.userId = data.userId;
      cb(null);
    });
  }

  /* ── main load function ─────────────────────────────── */
  function loadJelly(resetPage) {
    if (jf.loading) return;
    if (resetPage) jf.page = 0;

    var loadEl  = $j('jelly-loading');
    var errEl   = $j('jelly-error');
    var contEl  = $j('jelly-content');

    if (!jf.userId) {
      loadEl.classList.remove('hidden');
      errEl.classList.add('hidden');
      contEl.classList.add('hidden');
    }

    jf.loading = true;

    ensureUserId(function (err) {
      if (err) {
        jf.loading = false;
        loadEl.classList.add('hidden');
        errEl.classList.remove('hidden');
        $j('jelly-error-msg').textContent = err;
        return;
      }

      var type     = jf.type;
      var sortBy   = $j('jf-sort').value;
      var pageSize = parseInt($j('jf-pagesize').value, 10);
      var search   = ($j('jf-search').value || '').trim();
      var sortOrder = sortBy === 'CommunityRating' ? 'Descending' : 'Ascending';
      if (sortBy === 'DateCreated') sortOrder = 'Descending';

      var url = '/api/jf/items?userId=' + encodeURIComponent(jf.userId) +
                '&type=' + type +
                '&page=' + jf.page +
                '&pageSize=' + pageSize +
                '&sortBy=' + sortBy +
                '&sortOrder=' + sortOrder;
      if (search) url += '&search=' + encodeURIComponent(search);

      jfXhr(url, function (err2, data) {
        jf.loading = false;
        loadEl.classList.add('hidden');

        if (err2 || !data) {
          errEl.classList.remove('hidden');
          $j('jelly-error-msg').textContent = err2 || 'Unknown error';
          return;
        }

        jf.total = data.totalCount || 0;
        errEl.classList.add('hidden');
        contEl.classList.remove('hidden');

        renderGrid(data.items, type);
        updatePagination(pageSize);
        updateSubtitle(data.totalCount, type);
      });
    });
  }

  function updateSubtitle(total, type) {
    var label = type === 'Series' ? 'serie TV' : 'film';
    $j('jelly-subtitle').textContent = total + ' ' + label;
  }

  /* mirrors the .jelly-card column-count breakpoints in css/main.css —
     keep both in sync or poster images get requested at the wrong size */
  function jellyColumns() {
    var w = window.innerWidth;
    if (w >= 1400) return 9;
    if (w >= 1200) return 8;
    if (w >= 1024) return 7;
    if (w >= 768)  return 6;
    if (w >= 600)  return 5;
    if (w >= 480)  return 4;
    return 3;
  }

  /* ── render grid ────────────────────────────────────── */
  function renderGrid(items, type) {
    var grid = $j('jelly-grid');
    grid.innerHTML = '';

    if (!items || !items.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.width = '100%';
      empty.innerHTML = '<div class="empty-title">Nessun risultato</div>';
      grid.appendChild(empty);
      return;
    }

    for (var i = 0; i < items.length; i++) {
      grid.appendChild(makeJellyCard(items[i]));
    }
  }

  function makeJellyCard(item) {
    var card = document.createElement('div');
    card.className = 'jelly-card';

    /* poster */
    var posterWrap = document.createElement('div');
    posterWrap.className = 'jelly-card-poster';

    var hasPoster = item.ImageTags && item.ImageTags.Primary;
    if (hasPoster) {
      var img = document.createElement('img');
      img.alt = item.Name || '';
      // lazy: set src after append
      var dpr = window.devicePixelRatio || 1;
        var cardW = Math.round((window.innerWidth - 32) / jellyColumns());
        var targetH = Math.round(cardW * 1.5 * dpr);
        img.src = '/api/jf/image/' + item.Id + '?type=Primary&maxH=' + targetH;
      img.onerror = function () {
        this.parentNode.innerHTML = '<div class="jelly-card-poster-placeholder">◈</div>';
      };
      posterWrap.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'jelly-card-poster-placeholder';
      ph.textContent = '◈';
      posterWrap.appendChild(ph);
    }

    if (item.CommunityRating) {
      var badge = document.createElement('div');
      badge.className = 'jelly-card-rating';
      badge.textContent = '★ ' + item.CommunityRating.toFixed(1);
      posterWrap.appendChild(badge);
    }

    /* info */
    var info  = document.createElement('div');
    info.className = 'jelly-card-info';

    var title = document.createElement('div');
    title.className = 'jelly-card-title';
    title.textContent = item.Name || '—';

    var year = document.createElement('div');
    year.className = 'jelly-card-year';
    year.textContent = item.ProductionYear || '';

    info.appendChild(title);
    info.appendChild(year);
    card.appendChild(posterWrap);
    card.appendChild(info);

    card.addEventListener('click', function () { openDetail(item); });
    return card;
  }

  /* ── pagination ─────────────────────────────────────── */
  function updatePagination(pageSize) {
    var totalPages = Math.max(1, Math.ceil(jf.total / pageSize));
    var cur = jf.page + 1;
    $j('jf-pag-info').textContent = cur + ' / ' + totalPages;
    $j('jf-prev').disabled = jf.page <= 0;
    $j('jf-next').disabled = jf.page >= totalPages - 1;
  }

  $j('jf-prev').addEventListener('click', function () {
    if (jf.page > 0) { jf.page--; loadJelly(false); scrollToTop(); }
  });
  $j('jf-next').addEventListener('click', function () {
    var pageSize = parseInt($j('jf-pagesize').value, 10);
    var totalPages = Math.ceil(jf.total / pageSize);
    if (jf.page < totalPages - 1) { jf.page++; loadJelly(false); scrollToTop(); }
  });

  function scrollToTop() {
    var page = document.getElementById('page-jelly');
    if (page) page.scrollTop = 0;
  }

  /* ── filter/search change ───────────────────────────── */
  function onFilterChange() { loadJelly(true); }

  var jfTypeBtns = document.querySelectorAll('#jf-type-seg .jf-seg-btn');
  for (var jfti = 0; jfti < jfTypeBtns.length; jfti++) {
    jfTypeBtns[jfti].addEventListener('click', function () {
      if (this.className.indexOf('is-active') !== -1) return;
      for (var k = 0; k < jfTypeBtns.length; k++) {
        jfTypeBtns[k].className = 'jf-seg-btn';
      }
      this.className = 'jf-seg-btn is-active';
      jf.type = this.getAttribute('data-type');
      onFilterChange();
    });
  }
  $j('jf-sort').addEventListener('change', onFilterChange);
  $j('jf-pagesize').addEventListener('change', onFilterChange);

  $j('jf-search').addEventListener('input', function () {
    clearTimeout(jf.searchTimer);
    jf.searchTimer = setTimeout(function () { loadJelly(true); }, 500);
  });

  $j('jelly-retry').addEventListener('click', function () {
    jf.userId = null; // reset userId cache on retry
    loadJelly(true);
  });

  /* ── detail overlay ─────────────────────────────────── */
  function openDetail(item) {
    jf.currentItem = item;
    var overlay = $j('jelly-detail');
    overlay.classList.remove('hidden');
    overlay.scrollTop = 0;

    // back button
    $j('jelly-detail-title').textContent = item.Name || '—';

    // meta
    var meta = [];
    if (item.ProductionYear) meta.push(item.ProductionYear);
    if (item.Genres && item.Genres.length) {
      meta.push(item.Genres.slice(0, 3).join(', '));
    }
    $j('jelly-detail-meta').textContent = meta.join('  ·  ');

    // rating
    var rating = '';
    if (item.CommunityRating) {
      rating = '★ ' + item.CommunityRating.toFixed(1) + ' / 10';
    }
    $j('jelly-detail-rating').textContent = rating;

    var playBtn = $j('jelly-play-btn');
    if (item.Type === 'Movie') {
      playBtn.classList.remove('hidden');
    } else {
      playBtn.classList.add('hidden');
    }

    // overview
    $j('jelly-detail-overview').textContent = item.Overview || 'Nessuna descrizione disponibile.';

    // poster
    var imgEl = $j('jelly-detail-img');
    var hasPoster = item.ImageTags && item.ImageTags.Primary;
    if (hasPoster) {
      imgEl.src = '/api/jf/image/' + item.Id + '?type=Primary&maxH=600';
      imgEl.style.display = '';
    } else {
      imgEl.src = '';
      imgEl.style.display = 'none';
    }
  }

  $j('jelly-back').addEventListener('click', function () {
    $j('jelly-detail').classList.add('hidden');
    jf.currentItem = null;
  });

  $j('jelly-play-btn').addEventListener('click', function () {
    var item = jf.currentItem;
    if (!item || item.Type !== 'Movie') {
      jfToast('Playback available only for movies');
      return;
    }
    if (!jf.userId) {
      jfToast('Jellyfin user not available');
      return;
    }

    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Starting...';

    jfXhr('/api/jf/play/start?userId=' + encodeURIComponent(jf.userId) +
      '&itemId=' + encodeURIComponent(item.Id), function (err, data) {
      btn.disabled = false;
      btn.textContent = '▶ Riproduci';

      if (err || !data || !data.url) {
        jfToast('Player start error: ' + (err || 'stream not available'));
        return;
      }

      /* iOS Safari user gesture: open stream directly in native player */
      window.location.href = data.url;
    });
  });

  /* ── hook into page navigation ──────────────────────── */
  // We patch the global showPage function by wrapping tab clicks
  var jellyTab = document.querySelector('[data-page="jelly"]');
  if (jellyTab) {
    jellyTab.addEventListener('click', function () {
      // first visit: load
      if (!jf.userId && !jf.loading) {
        var loadEl = $j('jelly-loading');
        loadEl.classList.remove('hidden');
        loadJelly(true);
      }
    }, true); // capture phase — fires before the page switch handler
  }

  /* used by the core module's wake-from-standby handler — skip if the
     tab was never visited yet, so waking up doesn't force a first load
     of a tab the user hasn't opened. */
  window._jellyRefresh = function () {
    if (jf.userId) loadJelly(false);
  };

  /* ── settings: Jellyfin save & test ────────────────── */
  /* Whether an API key is already stored. The value itself never arrives. */
  var jfTokenSet = false;

  /**
   * @returns {Object|null} save body, or null when the form is incomplete.
   */
  function jfCredentialBody() {
    var url   = ($j('jf-url').value   || '').trim().replace(/\/$/, '');
    var token = ($j('jf-token').value || '').trim();
    if (!url) { jfToast('Enter server URL'); return null; }
    if (!token && !jfTokenSet) { jfToast('Enter the API token'); return null; }
    var body = { jf_url: url };
    if (token) body.jf_token = token;
    return body;
  }

  $j('btn-save-jf').addEventListener('click', function () {
    var body = jfCredentialBody();
    if (!body) return;
    jfPost('/api/settings', body, function (err) {
      if (err) jfToast('Error: ' + err);
      else {
        jfTokenSet = true;
        window._markCredential($j('jf-token'), true);
        jfToast('Jellyfin saved ✓');
        jf.userId = null; // reset cache
      }
    });
  });

  $j('btn-test-jf').addEventListener('click', function () {
    var res = $j('jf-test-result');
    res.className = 'test-result hidden';
    var body = jfCredentialBody();
    if (!body) return;
    jfPost('/api/settings', body, function () {
      jfXhr('/api/jf/status', function (err, data) {
        res.classList.remove('hidden');
        if (!err && data && data.connected) {
          res.className = 'test-result ok';
          res.textContent = '✓ ' + (data.serverName || 'Connection successful') +
                            (data.version ? ' · v' + data.version : '');
          jf.userId = null;
        } else {
          res.className = 'test-result err';
          res.textContent = '✗ ' + (data && data.error ? data.error : 'Connection failed');
        }
      });
    });
  });

  $j('toggle-jf-token').addEventListener('click', function () {
    var i = $j('jf-token');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  /* Jellyfin registers itself with the admin settings loader — the URL is
     configuration, the key is reported only as set or unset. */
  window._onAdminSettingsLoad(function (data) {
    if (data.jf_url) $j('jf-url').value = data.jf_url;
    jfTokenSet = !!data.jf_token_set;
    window._markCredential($j('jf-token'), jfTokenSet);
  });

  /* Re-fetch on rotation only if the column bracket actually changed and the
     Jellyfin tab has already loaded — a plain resize is not enough since iOS
     also fires resize for the software keyboard opening/closing. */
  var _lastJellyCols = jellyColumns();
  window.addEventListener('orientationchange', function () {
    setTimeout(function () {
      var cols = jellyColumns();
      if (cols !== _lastJellyCols) {
        _lastJellyCols = cols;
        if (jf.userId && window._currentPage === 'jelly') loadJelly(false);
      }
    }, 200); /* iOS fires orientationchange before the new viewport size settles */
  });

})();

/* ════════════════════════════════════════════════════════
   PROXMOX MODULE
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── state ─────────────────────────────────────────── */
  var px = {
    nodes:       [],
    selected:    null,   // { kind:'node'|'vm'|'storage', node, vmid, type, data }
    pollTimer:   null,
    charts:      {},     // chartist instances keyed by id
    loaded:      false
  };

  /* ── helpers ────────────────────────────────────────── */
  function $p(id) { return document.getElementById(id); }

  function pxGet(path, cb)          { window._xhr('GET',  '/api/px' + path, null, cb); }
  function pxPost(path, body, cb)   { window._xhr('POST', '/api/px' + path, body, cb); }
  function pxPostSettings(body, cb) { window._xhr('POST', '/api/settings',  body, cb); }
  function pxToast(msg)             { window._toast(msg); }

  /* ── formatting ─────────────────────────────────────── */
  function fmtBytes(b, decimals) {
    if (!b || b === 0) return '0 B';
    decimals = decimals !== undefined ? decimals : 1;
    var k = 1024, sizes = ['B','KB','MB','GB','TB'];
    var i = Math.floor(Math.log(b) / Math.log(k));
    i = Math.min(i, sizes.length - 1);
    return parseFloat((b / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
  }

  function fmtPct(val) {
    return val !== undefined ? (val * 100).toFixed(1) + '%' : '—';
  }

  function fmtMHz(hz) {
    if (!hz) return '—';
    return (hz / 1e6).toFixed(0) + ' MHz';
  }

  function fmtUptime(sec) {
    if (!sec) return '—';
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600),
        m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + 'g ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  }

  function statusClass(status) {
    if (status === 'running' || status === 'online') return 'running';
    if (status === 'paused' || status === 'prelaunch') return 'paused';
    return 'stopped';
  }

  /* ── tree rendering ─────────────────────────────────── */
  function renderTree(nodes) {
    var tree = $p('px-tree');
    tree.innerHTML = '';

    for (var ni = 0; ni < nodes.length; ni++) {
      var node = nodes[ni];
      // Node header
      var nodeItem = makeTreeItem('node', node.node, 'node.node', null,
        'node', node.node, node.status || '—', statusClass(node.status));
      nodeItem.setAttribute('data-node', node.node);
      tree.appendChild(nodeItem);

      // VMs for this node stored in node._vms
      if (node._vms && node._vms.length) {
        var vmGroup = document.createElement('div');
        vmGroup.className = 'px-group';
        var vmLabel = document.createElement('div');
        vmLabel.className = 'px-group-header';
        vmLabel.textContent = 'VM · LXC';
        vmGroup.appendChild(vmLabel);

        for (var vi = 0; vi < node._vms.length; vi++) {
          var vm = node._vms[vi];
          var vmItem = makeTreeItem('vm',
            vm.name || ('VM ' + vm.vmid),
            vm._type.toUpperCase() + ' ' + vm.vmid,
            { node: node.node, vmid: vm.vmid, type: vm._type, data: vm },
            vm._type === 'lxc' ? 'lxc' : 'vm',
            vm.name || ('VM ' + vm.vmid),
            vm.status || '—',
            statusClass(vm.status));
          vmGroup.appendChild(vmItem);
        }
        tree.appendChild(vmGroup);
      }

      // Storages
      if (node._storages && node._storages.length) {
        var stGroup = document.createElement('div');
        stGroup.className = 'px-group';
        var stLabel = document.createElement('div');
        stLabel.className = 'px-group-header';
        stLabel.textContent = 'Storage';
        stGroup.appendChild(stLabel);

        for (var si = 0; si < node._storages.length; si++) {
          var st = node._storages[si];
          var stItem = makeTreeItem('storage',
            st.storage,
            st.type || 'dir',
            { node: node.node, storage: st.storage, data: st },
            'disk',
            st.storage,
            st.type || '',
            '');
          stGroup.appendChild(stItem);
        }
        tree.appendChild(stGroup);
      }

      // separator
      var sep = document.createElement('div');
      sep.style.height = '8px';
      tree.appendChild(sep);
    }
    tree.classList.remove('hidden');
  }

  function makeTreeItem(kind, name, meta, payload, iconKey, labelText, metaText, dotCls) {
    var item = document.createElement('div');
    item.className = 'px-tree-item px-' + kind;

    var ico = document.createElement('div');
    ico.className = 'px-item-icon';

    /* SVG icons for Proxmox tree — iOS 9 safe */
    var svgMap = {
      'node': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="6" rx="2" stroke="currentColor" stroke-width="1.8"/><rect x="2" y="13" width="20" height="6" rx="2" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="1" fill="currentColor"/><circle cx="18" cy="16" r="1" fill="currentColor"/></svg>',
      'vm':   '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      'lxc':  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8v8H8z" stroke="currentColor" stroke-width="1.4"/></svg>',
      'disk': '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="5" rx="9" ry="3" stroke="currentColor" stroke-width="1.6"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" stroke="currentColor" stroke-width="1.6"/></svg>'
    };
    ico.innerHTML = svgMap[iconKey] || svgMap['disk'];

    var body = document.createElement('div');
    body.className = 'px-item-body';

    var nameEl = document.createElement('div');
    nameEl.className = 'px-item-name';
    nameEl.textContent = labelText;

    var metaEl = document.createElement('div');
    metaEl.className = 'px-item-meta';
    metaEl.textContent = metaText;

    body.appendChild(nameEl);
    body.appendChild(metaEl);
    item.appendChild(ico);
    item.appendChild(body);

    if (dotCls) {
      var dot = document.createElement('div');
      dot.className = 'px-status-dot ' + dotCls;
      item.appendChild(dot);
    }

    item.addEventListener('click', function () {
      // deselect all
      var all = document.querySelectorAll('.px-tree-item');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('selected');
      item.classList.add('selected');

      clearInterval(px.pollTimer);

      if (kind === 'node') {
        // find node data
        var nodeData = null;
        for (var ni = 0; ni < px.nodes.length; ni++) {
          if (px.nodes[ni].node === name) { nodeData = px.nodes[ni]; break; }
        }
        selectNode(name, nodeData);
      } else if (kind === 'vm' && payload) {
        selectVM(payload.node, payload.vmid, payload.type, payload.data);
      } else if (kind === 'storage' && payload) {
        selectStorage(payload.node, payload.storage, payload.data);
      }
    });

    return item;
  }

  /* ── SELECT NODE ────────────────────────────────────── */
  function selectNode(nodeName, nodeData) {
    clearInterval(px.pollTimer);
    px.selected = { kind: 'node', node: nodeName };
    var detail = $p('px-detail-content');
    $p('px-detail-empty').classList.add('hidden');
    detail.classList.remove('hidden');
    detail.innerHTML = '<div class="px-detail-loading" style="padding:28px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';

    pxGet('/nodes/' + nodeName + '/status', function (err, status) {
      if (err) { detail.innerHTML = '<div style="padding:16px;color:#5a2a2a;font-size:13px">Error: ' + err + '</div>'; return; }

      var html = '';
      html += '<div class="px-detail-header">';
      html += '<div class="px-detail-name">' + escHtml(nodeName) + '</div>';
      html += '<div class="px-detail-type">Proxmox Node · ' + (status.status || '—') + '</div>';
      html += '</div>';

      // Actions
      html += '<div class="px-actions">';
      html += '<button class="px-action-btn reboot"  data-action="reboot"   data-node="'+nodeName+'">Riavvia</button>';
      html += '<button class="px-action-btn node-off" data-action="shutdown" data-node="'+nodeName+'">Spegni</button>';
      html += '</div>';

      // Stats
      var cpuPct = status.cpu ? (status.cpu * 100).toFixed(1) : '0';
      var memUsed = status.memory ? status.memory.used  : 0;
      var memTot  = status.memory ? status.memory.total : 1;
      var memPct  = ((memUsed / memTot) * 100).toFixed(1);
      var swapU   = status.swap   ? status.swap.used    : 0;
      var swapT   = status.swap   ? status.swap.total   : 1;
      var rootU   = status.rootfs ? status.rootfs.used  : 0;
      var rootT   = status.rootfs ? status.rootfs.total : 1;

      html += '<div class="px-stat-grid">';
      html += statCard('CPU', cpuPct + '%', fmtMHz(status.cpuinfo && status.cpuinfo.mhz) + ' · ' + ((status.cpuinfo && status.cpuinfo.cpus) || '?') + ' core', parseFloat(cpuPct)/100, 'cpu');
      html += statCard('RAM', fmtBytes(memUsed), fmtBytes(memTot) + ' tot · ' + memPct + '%', memUsed/memTot, 'mem');
      html += statCard('Swap', fmtBytes(swapU), fmtBytes(swapT) + ' tot', swapT>0?swapU/swapT:0, 'disk');
      html += statCard('Root FS', fmtBytes(rootU), fmtBytes(rootT) + ' tot', rootT>0?rootU/rootT:0, 'disk');
      html += statCard('Uptime', fmtUptime(status.uptime), '', 0, '');
      html += statCard('Kernel', '', status.ksm ? 'KSM on' : (status.pveversion || ''), 0, '');
      html += '</div>';

      // Charts placeholder
      html += '<div class="px-chart-section">';
      html += '<div class="px-chart-label">CPU % — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-node-cpu"></div>';
      html += '<div class="px-chart-label">RAM — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-node-mem"></div>';
      html += '<div class="px-chart-label">Rete (in/out) — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-node-net"></div>';
      html += '</div>';

      detail.innerHTML = html;

      // bind node actions
      bindNodeActions(detail, nodeName);

      // load RRD
      loadNodeCharts(nodeName);

      // poll status every 10s
      px.pollTimer = setInterval(function () {
        if (px.selected && px.selected.kind === 'node' && px.selected.node === nodeName) {
          loadNodeCharts(nodeName);
        }
      }, 15000);
    });
  }

  function loadNodeCharts(nodeName) {
    pxGet('/nodes/' + nodeName + '/rrd?timeframe=hour', function (err, rrd) {
      if (err || !rrd || !rrd.length) return;
      renderLineChart('chart-node-cpu', rrd, function(d){ return d.cpu ? d.cpu * 100 : 0; });
      renderLineChart('chart-node-mem', rrd, function(d){ return (d.memused && d.memtotal) ? (d.memused/d.memtotal)*100 : 0; });
      renderDualChart('chart-node-net', rrd,
        function(d){ return d.netin  ? d.netin  / 1024 : 0; },
        function(d){ return d.netout ? d.netout / 1024 : 0; });
    });
  }

  function bindNodeActions(container, nodeName) {
    var btns = container.querySelectorAll('[data-action]');
    for (var i = 0; i < btns.length; i++) {
      (function(btn) {
        btn.addEventListener('click', function () {
          var action = btn.getAttribute('data-action');
          var label  = action === 'reboot' ? 'riavviare' : 'spegnere';
          confirmDialog(
            (action === 'reboot' ? 'Riavvio' : 'Spegnimento') + ' nodo',
            'Vuoi davvero ' + label + ' il nodo ' + nodeName + '?',
            function() {
              window._guardServerAction(
                (action === 'reboot' ? 'Reboot' : 'Shut down') + ' node',
                function () {
                  btn.disabled = true;
                  pxPost('/nodes/' + nodeName + '/power', { command: action }, function(err) {
                    btn.disabled = false;
                    if (err) pxToast('Error: ' + err);
                    else     pxToast('Command sent: ' + action);
                  });
                }
              );
            }
          );
        });
      })(btns[i]);
    }
  }

  /* ── SELECT VM ──────────────────────────────────────── */
  function selectVM(nodeName, vmid, vmType, vmData) {
    clearInterval(px.pollTimer);
    px.selected = { kind: 'vm', node: nodeName, vmid: vmid, type: vmType };
    var detail = $p('px-detail-content');
    $p('px-detail-empty').classList.add('hidden');
    detail.classList.remove('hidden');

    function renderVMDetail(status) {
      var running = status.status === 'running';
      var paused  = status.status === 'paused';

      var html = '';
      html += '<div class="px-detail-header">';
      html += '<div class="px-detail-name">' + escHtml(status.name || ('VM ' + vmid)) + '</div>';
      html += '<div class="px-detail-type">' + vmType.toUpperCase() + ' ' + vmid + ' · ' + (status.status || '—') + '</div>';
      html += '</div>';

      // Actions
      html += '<div class="px-actions">';
      if (!running && !paused)
        html += '<button class="px-action-btn start"    data-vm-action="start">▶ Avvia</button>';
      if (running)
        html += '<button class="px-action-btn shutdown" data-vm-action="shutdown">⏻ Shutdown</button>';
      if (running)
        html += '<button class="px-action-btn stop"     data-vm-action="stop">■ Stop</button>';
      if (running)
        html += '<button class="px-action-btn suspend"  data-vm-action="suspend">⏸ Sospendi</button>';
      if (paused)
        html += '<button class="px-action-btn start"    data-vm-action="resume">▶ Riprendi</button>';
      if (running || paused)
        html += '<button class="px-action-btn reset"    data-vm-action="reset">↺ Reset</button>';
      /* VNC console — only available for QEMU VMs, not LXC containers */
      if (vmType === 'qemu')
        html += '<button class="px-action-btn vnc" data-vm-vnc="1">⬡ Console VNC</button>';
      html += '</div>';

      // Stats
      var cpuPct = running && status.cpu ? (status.cpu * 100).toFixed(1) : '—';
      var memUsed = status.mem    || 0;
      var memTot  = status.maxmem || 1;
      var memPct  = running ? ((memUsed / memTot) * 100).toFixed(1) + '%' : '—';
      var diskRead = status.diskread  || 0;
      var diskWrite= status.diskwrite || 0;
      var netIn    = status.netin     || 0;
      var netOut   = status.netout    || 0;

      html += '<div class="px-stat-grid">';
      html += statCard('CPU', running ? cpuPct + '%' : '—', status.cpus ? status.cpus + ' vCPU' : '', running ? parseFloat(cpuPct)/100 : 0, 'cpu', 'vm-cpu');
      html += statCard('RAM', fmtBytes(memUsed), fmtBytes(memTot) + ' · ' + memPct, running ? memUsed/memTot : 0, 'mem', 'vm-mem');
      html += statCard('Disk R', fmtBytes(diskRead), 'totale lettura', 0, '', 'vm-diskr');
      html += statCard('Disk W', fmtBytes(diskWrite), 'totale scrittura', 0, '', 'vm-diskw');
      html += statCard('Net In',  fmtBytes(netIn),  '', 0, '', 'vm-netin');
      html += statCard('Net Out', fmtBytes(netOut), '', 0, '', 'vm-netout');
      if (status.uptime)
        html += statCard('Uptime', fmtUptime(status.uptime), '', 0, '', 'vm-uptime');
      html += '</div>';

      // Charts
      html += '<div class="px-chart-section">';
      html += '<div class="px-chart-label">CPU % — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-vm-cpu"></div>';
      html += '<div class="px-chart-label">RAM — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-vm-mem"></div>';
      html += '<div class="px-chart-label">Rete (in/out) — ultima ora</div>';
      html += '<div class="px-chart-wrap" id="chart-vm-net"></div>';
      html += '</div>';

      detail.innerHTML = html;

      // bind actions
      /* VNC console button — opens Proxmox noVNC in a new tab */
      var vncBtn = detail.querySelector('[data-vm-vnc]');
      if (vncBtn) {
        vncBtn.addEventListener('click', function () {
          /* Ask backend to compute the noVNC URL (it knows the PVE base URL) */
          pxGet('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/vnc-url',
            function (err, data) {
              if (err || !data || !data.vncUrl) {
                pxToast('Cannot open console: ' + (err || 'URL not available'));
                return;
              }
              /* Open in a new window/tab — compatible with iOS Safari */
              window.open(data.vncUrl, '_blank');
            }
          );
        });
      }

      var btns = detail.querySelectorAll('[data-vm-action]');
      for (var i = 0; i < btns.length; i++) {
        (function(btn) {
          btn.addEventListener('click', function () {
            var action = btn.getAttribute('data-vm-action');
            var dangerous = action === 'stop' || action === 'reset';
            if (dangerous) {
              confirmDialog('Confirm ' + action,
                'This action may cause data loss. Continue?',
                function() { doVMAction(nodeName, vmid, vmType, action, detail); });
            } else {
              doVMAction(nodeName, vmid, vmType, action, detail);
            }
          });
        })(btns[i]);
      }

      // load charts
      loadVMCharts(nodeName, vmType, vmid);
    }

    // load current status
    detail.innerHTML = '<div class="px-detail-loading" style="padding:28px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';
    pxGet('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/status', function(err, status) {
      if (err) { detail.innerHTML = '<div style="padding:16px;color:#5a2a2a;font-size:13px">Error: ' + err + '</div>'; return; }
      renderVMDetail(status);
    });

    // poll every 8s
    px.pollTimer = setInterval(function () {
      if (!px.selected || px.selected.kind !== 'vm' || px.selected.vmid != vmid) return;
      pxGet('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/status', function(err, status) {
        if (!err && status) {
          // refresh only stats and action buttons, not whole detail
          updateVMStats(status, detail);
        }
      });
    }, 8000);
  }

  function updateVMStats(status, detail) {
    var running = status.status === 'running';
    var paused  = status.status === 'paused';

    /* ── helper: aggiorna una card per data-stat key ── */
    function patchCard(key, value, sub, fillRatio, fillClass) {
      var card = detail.querySelector('[data-stat="' + key + '"]');
      if (!card) return;
      var valEl = card.querySelector('.px-stat-value');
      var subEl = card.querySelector('.px-stat-sub');
      var barEl = card.querySelector('.px-bar-fill');
      if (valEl) valEl.textContent = value;
      if (subEl && sub !== undefined) subEl.textContent = sub;
      if (barEl && fillRatio !== undefined) {
        var w = Math.min(100, Math.round(fillRatio * 100));
        barEl.style.width = w + '%';
      }
    }

    var cpuPct   = running && status.cpu ? (status.cpu * 100).toFixed(1) : '—';
    var memUsed  = status.mem    || 0;
    var memTot   = status.maxmem || 1;
    var memPct   = running ? ((memUsed / memTot) * 100).toFixed(1) + '%' : '—';
    var diskRead = status.diskread  || 0;
    var diskWrite= status.diskwrite || 0;
    var netIn    = status.netin     || 0;
    var netOut   = status.netout    || 0;

    patchCard('vm-cpu',    running ? cpuPct + '%' : '—',
                           status.cpus ? status.cpus + ' vCPU' : '',
                           running ? parseFloat(cpuPct) / 100 : 0);
    patchCard('vm-mem',    fmtBytes(memUsed),
                           fmtBytes(memTot) + ' · ' + memPct,
                           running ? memUsed / memTot : 0);
    patchCard('vm-diskr',  fmtBytes(diskRead));
    patchCard('vm-diskw',  fmtBytes(diskWrite));
    patchCard('vm-netin',  fmtBytes(netIn));
    patchCard('vm-netout', fmtBytes(netOut));
    if (status.uptime) patchCard('vm-uptime', fmtUptime(status.uptime));

    /* Aggiorna anche i grafici */
    loadVMCharts(px.selected.node, px.selected.type, px.selected.vmid);
  }

  function doVMAction(nodeName, vmid, vmType, action, detail) {
    window._guardServerAction('VM ' + action, function () {
      pxPost('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/action', { action: action }, function(err) {
        if (err) { pxToast('Error: ' + err); return; }
        pxToast('Command "' + action + '" sent');
        // reload status after short delay
        setTimeout(function () {
          selectVM(nodeName, vmid, vmType, {});
        }, 2500);
      });
    });
  }

  function loadVMCharts(nodeName, vmType, vmid) {
    pxGet('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/rrd?timeframe=hour', function(err, rrd) {
      if (err || !rrd || !rrd.length) return;
      renderLineChart('chart-vm-cpu', rrd, function(d){ return d.cpu ? d.cpu * 100 : 0; });
      renderLineChart('chart-vm-mem', rrd, function(d){ return (d.mem && d.maxmem) ? (d.mem/d.maxmem)*100 : 0; });
      renderDualChart('chart-vm-net', rrd,
        function(d){ return d.netin  ? d.netin  / 1024 : 0; },
        function(d){ return d.netout ? d.netout / 1024 : 0; });
    });
  }

  /* ── SELECT STORAGE ─────────────────────────────────── */
  function selectStorage(nodeName, storageName, stData) {
    px.selected = { kind: 'storage', node: nodeName, storage: storageName };
    var detail = $p('px-detail-content');
    $p('px-detail-empty').classList.add('hidden');
    detail.classList.remove('hidden');

    var used  = stData.used  || 0;
    var avail = stData.avail || 0;
    var total = used + avail;
    var pct   = total > 0 ? ((used / total) * 100).toFixed(1) : 0;

    var html = '';
    html += '<div class="px-detail-header">';
    html += '<div class="px-detail-name">' + escHtml(storageName) + '</div>';
    html += '<div class="px-detail-type">Storage · ' + (stData.type || 'dir') + ' · ' + (stData.status || '—') + '</div>';
    html += '</div>';

    html += '<div class="px-stat-grid">';
    html += statCard('Usato',     fmtBytes(used),  '', used/Math.max(total,1), 'disk');
    html += statCard('Disponibile', fmtBytes(avail), '', 0, '');
    html += statCard('Totale',    fmtBytes(total), '', 0, '');
    html += statCard('Utilizzo',  pct + '%',       '', parseFloat(pct)/100, 'disk');
    html += '</div>';

    if (stData.content) {
      html += '<div style="padding:10px 14px 4px">';
      html += '<div class="px-chart-label">Contenuti supportati</div>';
      html += '<div style="font-size:12px;color:#44446a;padding:6px 0;font-family:\'DM Mono\',monospace">' + stData.content + '</div>';
      html += '</div>';
    }

    detail.innerHTML = html;
  }

  /* ── Charts (Chartist) ──────────────────────────────── */
  function rrdToSeries(rrd, fn) {
    var vals = [];
    // sample every N points to keep chart lean (~30 points)
    var step = Math.max(1, Math.floor(rrd.length / 30));
    for (var i = 0; i < rrd.length; i += step) {
      var v = fn(rrd[i]);
      vals.push(isNaN(v) ? 0 : parseFloat(v.toFixed(2)));
    }
    return vals;
  }

  var chartOpts = {
    showPoint: false,
    lineSmooth: false,
    fullWidth: true,
    showArea: true,
    axisX: { showGrid: false, showLabel: false, offset: 0 },
    axisY: { showGrid: true,  showLabel: false, offset: 0, labelOffset: { x: 0, y: 0 } },
    chartPadding: { top: 4, right: 0, bottom: 0, left: 0 }
  };

  function renderLineChart(elId, rrd, fn) {
    var el = document.getElementById(elId);
    if (!el) return;
    var series = rrdToSeries(rrd, fn);
    // destroy old chart if any
    if (px.charts[elId]) { try { px.charts[elId].detach(); } catch(e){} }
    try {
      px.charts[elId] = new Chartist.Line('#' + elId, {
        labels: series.map(function(v,i){ return i; }),
        series: [series]
      }, chartOpts);
    } catch(e) { el.innerHTML = '<div style="padding:4px;font-size:10px;color:#252540">grafico n/d</div>'; }
  }

  function renderDualChart(elId, rrd, fn1, fn2) {
    var el = document.getElementById(elId);
    if (!el) return;
    var s1 = rrdToSeries(rrd, fn1);
    var s2 = rrdToSeries(rrd, fn2);
    if (px.charts[elId]) { try { px.charts[elId].detach(); } catch(e){} }
    try {
      px.charts[elId] = new Chartist.Line('#' + elId, {
        labels: s1.map(function(v,i){ return i; }),
        series: [s1, s2]
      }, chartOpts);
    } catch(e) {}
  }

  /* ── Stat card HTML ─────────────────────────────────── */
  function statCard(label, value, sub, fillRatio, fillClass, dataKey) {
    var barHtml = '';
    if (fillClass && fillRatio !== undefined && fillRatio >= 0) {
      var w = Math.min(100, Math.round(fillRatio * 100));
      barHtml = '<div class="px-bar-wrap"><div class="px-bar-fill ' + fillClass + '" style="width:' + w + '%"></div></div>';
    }
    var attr = dataKey ? ' data-stat="' + dataKey + '"' : '';
    return '<div class="px-stat-card"' + attr + '>' +
      '<div class="px-stat-label">' + escHtml(label) + '</div>' +
      '<div class="px-stat-value">' + escHtml(value) + '</div>' +
      (sub ? '<div class="px-stat-sub">' + escHtml(sub) + '</div>' : '') +
      barHtml +
      '</div>';
  }

  /* ── Confirm dialog ─────────────────────────────────── */
  function confirmDialog(title, msg, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'px-confirm-overlay';
    overlay.innerHTML =
      '<div class="px-confirm-box">' +
        '<div class="px-confirm-title">' + escHtml(title) + '</div>' +
        '<div class="px-confirm-msg">'   + escHtml(msg)   + '</div>' +
        '<div class="px-confirm-btns">' +
          '<button class="btn-secondary" id="px-confirm-cancel">Annulla</button>' +
          '<button class="btn-primary danger" id="px-confirm-ok">Conferma</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#px-confirm-cancel').addEventListener('click', function() { document.body.removeChild(overlay); });
    overlay.querySelector('#px-confirm-ok').addEventListener('click', function() {
      document.body.removeChild(overlay);
      onConfirm();
    });
  }

  function escHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Load cluster ───────────────────────────────────── */
  function loadCluster() {
    $p('px-tree-loading').style.display = '';
    $p('px-tree-error').classList.add('hidden');
    $p('px-tree').classList.add('hidden');

    pxGet('/nodes', function(err, nodes) {
      if (err || !Array.isArray(nodes) || !nodes.length) {
        $p('px-tree-loading').style.display = 'none';
        $p('px-tree-error').classList.remove('hidden');
        $p('px-tree-error-msg').textContent = err || 'Nessun nodo trovato';
        return;
      }

      px.nodes = nodes;
      var pending = nodes.length * 2; // vms + storages per node

      function checkDone() {
        pending--;
        if (pending <= 0) {
          $p('px-tree-loading').style.display = 'none';
          renderTree(px.nodes);
          px.loaded = true;
          var total = 0;
          for (var i = 0; i < px.nodes.length; i++) total += (px.nodes[i]._vms || []).length;
          $p('px-subtitle').textContent = px.nodes.length + ' nodi · ' + total + ' VM';
        }
      }

      for (var ni = 0; ni < nodes.length; ni++) {
        (function(node) {
          pxGet('/nodes/' + node.node + '/vms', function(err2, vms) {
            node._vms = Array.isArray(vms) ? vms : [];
            checkDone();
          });
          pxGet('/nodes/' + node.node + '/storage', function(err3, storages) {
            node._storages = Array.isArray(storages) ? storages : [];
            checkDone();
          });
        })(nodes[ni]);
      }
    });
  }

  /* ── Hook into tab navigation ───────────────────────── */
  var serverTab = document.querySelector('[data-page="server"]');
  if (serverTab) {
    serverTab.addEventListener('click', function () {
      if (!px.loaded) {
        setTimeout(loadCluster, 60);
      }
    }, true);
  }

  /* ── Settings: Proxmox save & test ─────────────────── */
  /* Whether a token secret is already stored. The value never arrives. */
  var pxTokenSet = false;

  /**
   * @returns {Object|null} save body, or null when the form is incomplete.
   */
  function pxCredentialBody() {
    var url     = ($p('px-url').value     || '').trim().replace(/\/$/, '');
    var tokenid = ($p('px-tokenid').value || '').trim();
    var token   = ($p('px-token').value   || '').trim();
    if (!url)     { pxToast('Enter server URL'); return null; }
    if (!tokenid) { pxToast('Enter the Token ID'); return null; }
    if (!token && !pxTokenSet) { pxToast('Enter the Token Secret'); return null; }
    var body = { px_url: url, px_tokenid: tokenid };
    if (token) body.px_token = token;
    return body;
  }

  $p('btn-save-px').addEventListener('click', function () {
    var body = pxCredentialBody();
    if (!body) return;
    pxPostSettings(body, function(err) {
      if (err) pxToast('Error: ' + err);
      else {
        pxTokenSet = true;
        window._markCredential($p('px-token'), true);
        pxToast('Proxmox saved ✓');
        px.loaded = false;
      }
    });
  });

  $p('btn-test-px').addEventListener('click', function () {
    var res = $p('px-test-result');
    res.className = 'test-result hidden';
    var body = pxCredentialBody();
    if (!body) return;
    pxPostSettings(body, function () {
      pxGet('/status', function(err, data) {
        res.classList.remove('hidden');
        if (!err && data && data.connected) {
          res.className = 'test-result ok';
          res.textContent = '✓ Proxmox VE ' + (data.version || '') + (data.release ? '-' + data.release : '');
        } else {
          res.className = 'test-result err';
          res.textContent = '✗ ' + (data && data.error ? data.error : err || 'Connection failed');
        }
      });
    });
  });

  $p('toggle-px-token').addEventListener('click', function () {
    var i = $p('px-token');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  $p('px-retry').addEventListener('click', function () {
    px.loaded = false;
    loadCluster();
  });

  /* Proxmox registers itself with the admin settings loader — URL and token
     id are configuration, the secret is reported only as set or unset. */
  window._onAdminSettingsLoad(function (d) {
    if (d.px_url)     $p('px-url').value     = d.px_url;
    if (d.px_tokenid) $p('px-tokenid').value = d.px_tokenid;
    pxTokenSet = !!d.px_token_set;
    window._markCredential($p('px-token'), pxTokenSet);
  });

  /* Stops the node/VM status poller. Called from the tab-switch handler
     when navigating away from Server, so leaving the tab doesn't leave a
     background poll running indefinitely. */
  window._pxStopPolling = function () { clearInterval(px.pollTimer); };

  /* Used by the core module's wake-from-standby handler. _pxStopPolling
     kills the node/VM poll the moment you leave this tab (see above), so
     unlike the other tabs there's no live timer to just resume on wake —
     re-opening whatever was selected is what restarts it. Storage rows
     have no poll, so they're left alone. */
  window._serverWakeRefresh = function () {
    if (!px.selected) return;
    if (px.selected.kind === 'node') selectNode(px.selected.node);
    if (px.selected.kind === 'vm')   selectVM(px.selected.node, px.selected.vmid, px.selected.type);
  };

})();

/* ════════════════════════════════════════════════════════
   FEATURES MODULE
   Accordion in Settings: enable/disable tabs + home widget picker.
   Widget selections are persisted to settings.json (home_widgets).
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── feature definitions ─────────────────────────────
     routes: XHR url substrings to block when disabled.
     accordion: whether the row is expandable.
     widgetKey: key used in home_widgets settings array.   */
  var FEATURES = [
    { key: 'smarthome', label: 'Smart Home', page: 'smarthome', tab: 'smarthome', routes: ['/api/ha'] },
    { key: 'meteo',     label: 'Weather',    page: 'meteo',     tab: 'meteo',     routes: ['/api/weather'] },
    { key: 'jelly',     label: 'Jellyfin',   page: 'jelly',     tab: 'jelly',     routes: ['/api/jf'] },
    { key: 'markets',   label: 'Markets',    page: 'markets',   tab: 'markets',   routes: ['/api/markets'] },
    /* The Proxmox router is mounted at /api/px (see backend/server.js), not
       /api/proxmox — the old value only ever matched by accident, via the
       '/nodes' substring, so /api/px/status stayed live with Server off. */
    { key: 'server',    label: 'Server',     page: 'server',    tab: 'server',    routes: ['/api/px'] }
  ];

  /* disabled set: keys of features currently off */
  var disabled = {};

  /* home_widgets: array of { type, id, label } */
  var homeWidgets = [];

  /* ── DOM helper ─────────────────────────────────────── */
  function $f(id) { return document.getElementById(id); }

  /* ── persist ─────────────────────────────────────────── */
  function saveFeatures() {
    var keys = [];
    for (var k in disabled) { if (disabled[k]) keys.push(k); }
    window._xhr('POST', '/api/settings', { features_disabled: keys }, function () {});
  }

  function saveWidgets() {
    window._xhr('POST', '/api/settings', { home_widgets: homeWidgets }, function () {});
    if (window._homeSetWidgets) window._homeSetWidgets(homeWidgets);
  }

  function isWidgetAdded(type, id) {
    for (var i = 0; i < homeWidgets.length; i++) {
      if (homeWidgets[i].type === type && homeWidgets[i].id === id) return true;
    }
    return false;
  }

  function toggleWidget(type, id, label, btn) {
    if (isWidgetAdded(type, id)) {
      /* remove */
      var next = [];
      for (var i = 0; i < homeWidgets.length; i++) {
        if (!(homeWidgets[i].type === type && homeWidgets[i].id === id)) next.push(homeWidgets[i]);
      }
      homeWidgets = next;
      if (btn) { btn.textContent = '+'; btn.classList.remove('added'); }
    } else {
      /* add */
      homeWidgets.push({ type: type, id: id, label: label });
      if (btn) { btn.textContent = '−'; btn.classList.add('added'); }
    }
    saveWidgets();
  }

  function makeAddBtn(type, id, label) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'feat-widget-add-btn' + (isWidgetAdded(type, id) ? ' added' : '');
    btn.textContent = isWidgetAdded(type, id) ? '−' : '+';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleWidget(type, id, label, btn);
    });
    return btn;
  }

  /* ── tab/page show-hide ─────────────────────────────── */
  function applyFeature(feat, enabled) {
    var tab  = document.querySelector('[data-page="' + feat.tab + '"]');
    var page = document.getElementById('page-' + feat.page);
    var tog  = $f('feat-toggle-' + feat.key);
    if (enabled) {
      if (tab)  tab.style.display  = '';
      if (page) page.style.display = '';
      if (tog)  tog.classList.add('on');
    } else {
      if (tab)  tab.style.display  = 'none';
      if (page) page.style.display = 'none';
      if (tog)  tog.classList.remove('on');
      if (window._currentPage && window._currentPage === feat.page) {
        var homeTab = document.querySelector('[data-page="home"]');
        if (homeTab) homeTab.click();
      }
    }
  }

  /* ── XHR interception ───────────────────────────────── */
  var _origXhr = window._xhr;
  window._xhr = function (method, url, body, cb) {
    for (var i = 0; i < FEATURES.length; i++) {
      var feat = FEATURES[i];
      if (!disabled[feat.key]) continue;
      for (var r = 0; r < feat.routes.length; r++) {
        if (url.indexOf(feat.routes[r]) !== -1) return; /* drop */
      }
    }
    _origXhr(method, url, body, cb);
  };

  /* ── accordion open/close ───────────────────────────── */
  var openKey = null; /* at most one open at a time */

  function openAccordion(key) {
    if (openKey && openKey !== key) closeAccordion(openKey);
    openKey = key;
    var acc = $f('feat-acc-'  + key);
    var body = $f('feat-body-' + key);
    if (acc)  acc.classList.add('open');
    if (body) body.classList.remove('hidden');
    populateAccordion(key);
  }

  function closeAccordion(key) {
    if (openKey === key) openKey = null;
    var acc  = $f('feat-acc-'  + key);
    var body = $f('feat-body-' + key);
    if (acc)  acc.classList.remove('open');
    if (body) body.classList.add('hidden');
  }

  /* ── accordion content population ──────────────────── */

  function populateAccordion(key) {
    if (key === 'smarthome') populateSmartHome();
    else if (key === 'meteo')    populateSingle('meteo',   'weather',  'Weather widget');
    else if (key === 'jelly')    populateSingle('jelly',   'jellyfin', 'Jellyfin widget');
    else if (key === 'server')   populateSingle('server',  'server',   'Server widget');
    else if (key === 'markets')  populateMarkets();
  }

  /* Single-item sections (Meteo, Jellyfin, Server) */
  function populateSingle(key, widgetId, widgetLabel) {
    var list = $f('feat-list-' + key);
    if (!list || list.dataset.loaded) return;
    list.dataset.loaded = '1';
    list.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'feat-single-add';
    var lbl = document.createElement('span');
    lbl.className = 'feat-single-add-label';
    lbl.textContent = 'Add to Home screen';
    row.appendChild(lbl);
    row.appendChild(makeAddBtn(key, widgetId, widgetLabel));
    list.appendChild(row);
  }

  /* Smart Home: fetch entities, group by domain */
  function populateSmartHome() {
    var list = $f('feat-list-smarthome');
    var loader = $f('feat-load-smarthome');
    if (!list) return;
    if (list.dataset.loaded) { refreshSmartHomeButtons(); return; }

    if (loader) loader.classList.remove('hidden');
    list.innerHTML = '';

    _origXhr('GET', '/api/ha/entities', null, function (err, entities) {
      if (loader) loader.classList.add('hidden');
      if (err || !Array.isArray(entities) || !entities.length) {
        list.innerHTML = '<div class="feat-widget-empty">No devices available.</div>';
        return;
      }
      list.dataset.loaded = '1';

      var HA_GROUPS = [
        { key: 'lights',   label: 'Lights',      domains: ['light'],                      icon: '○' },
        { key: 'media',    label: 'Media',        domains: ['media_player'],               icon: '▷' },
        { key: 'switches', label: 'Smart Plug',   domains: ['switch','input_boolean'],     icon: '⌁' },
        { key: 'climate',  label: 'Climate',      domains: ['climate','fan'],              icon: '◇' },
        { key: 'covers',   label: 'Covers',       domains: ['cover'],                      icon: '▭' }
      ];

      function domainOf(eid) { return eid.split('.')[0]; }
      /* The top module owns the canonical friendlyName — it always runs
         first, so window._haFriendlyName is set by the time this fires. */
      var friendlyName = window._haFriendlyName;

      var hasAny = false;
      for (var g = 0; g < HA_GROUPS.length; g++) {
        var grp = HA_GROUPS[g], items = [];
        for (var i = 0; i < entities.length; i++) {
          if (grp.domains.indexOf(domainOf(entities[i].entity_id)) !== -1) items.push(entities[i]);
        }
        if (!items.length) continue;
        hasAny = true;
        var glbl = document.createElement('div');
        glbl.className = 'feat-widget-group-label';
        glbl.textContent = grp.label;
        list.appendChild(glbl);

        for (var k = 0; k < items.length; k++) {
          (function (entity, icon) {
            var name = friendlyName(entity);
            var row  = document.createElement('div');
            row.className = 'feat-widget-item';
            row.dataset.entityId = entity.entity_id;

            var left = document.createElement('div');
            left.className = 'feat-widget-item-left';
            var ic = document.createElement('span');
            ic.className = 'feat-widget-item-icon';
            ic.textContent = icon;
            var nm = document.createElement('span');
            nm.className = 'feat-widget-item-name';
            nm.textContent = name;
            left.appendChild(ic);
            left.appendChild(nm);
            row.appendChild(left);
            row.appendChild(makeAddBtn('smarthome', entity.entity_id, name));
            list.appendChild(row);
          })(items[k], grp.icon);
        }
      }
      if (!hasAny) {
        list.innerHTML = '<div class="feat-widget-empty">No devices available.</div>';
      }
    });
  }

  /* Refresh +/− button states after homeWidgets changes (without re-fetching) */
  function refreshSmartHomeButtons() {
    var list = $f('feat-list-smarthome');
    if (!list) return;
    var btns = list.querySelectorAll('.feat-widget-add-btn');
    for (var i = 0; i < btns.length; i++) {
      var row = btns[i].parentNode;
      var entityId = row && row.dataset && row.dataset.entityId;
      if (!entityId) continue;
      var added = isWidgetAdded('smarthome', entityId);
      btns[i].textContent = added ? '−' : '+';
      if (added) btns[i].classList.add('added');
      else btns[i].classList.remove('added');
    }
  }

  /* Markets: fetch favorites list */
  function populateMarkets() {
    var list   = $f('feat-list-markets');
    var loader = $f('feat-load-markets');
    if (!list) return;

    /* always reload to stay in sync with favorites */
    list.innerHTML = '';
    list.dataset.loaded = '';
    if (loader) loader.classList.remove('hidden');

    _origXhr('GET', '/api/markets/favorites', null, function (err, data) {
      if (loader) loader.classList.add('hidden');
      list.dataset.loaded = '1';
      var items = (!err && data && Array.isArray(data.items)) ? data.items : [];

      if (!items.length) {
        list.innerHTML = '<div class="feat-widget-empty">No favourites yet. Add symbols from the Markets tab.</div>';
        return;
      }

      for (var i = 0; i < items.length; i++) {
        (function (item) {
          var id    = item.symbol;
          var label = (item.name || item.symbol) + ' (' + item.symbol + ')';
          var row   = document.createElement('div');
          row.className = 'feat-widget-item';
          row.dataset.symbolId = id;

          var left = document.createElement('div');
          left.className = 'feat-widget-item-left';
          var ic = document.createElement('span');
          ic.className = 'feat-widget-item-icon';
          ic.textContent = '◬';
          var nm = document.createElement('span');
          nm.className = 'feat-widget-item-name';
          nm.textContent = item.symbol + (item.name ? ' · ' + item.name : '');
          left.appendChild(ic);
          left.appendChild(nm);
          row.appendChild(left);
          row.appendChild(makeAddBtn('markets', id, label));
          list.appendChild(row);
        })(items[i]);
      }
    });
  }

  /* ── toggle click handlers ──────────────────────────── */
  function bindFeature(feat) {
    /* toggle */
    var tog = $f('feat-toggle-' + feat.key);
    if (tog) {
      tog.addEventListener('click', function (e) {
        e.stopPropagation(); /* prevent accordion open */
        var isEnabled = !disabled[feat.key];
        if (isEnabled) disabled[feat.key] = true;
        else delete disabled[feat.key];
        applyFeature(feat, !disabled[feat.key]);
        saveFeatures();
      });
    }

    /* accordion header */
    var hdr = $f('feat-hdr-' + feat.key);
    if (hdr) {
      hdr.addEventListener('click', function (e) {
        /* ignore clicks on the toggle itself */
        if (e.target && (e.target.classList.contains('power-toggle') ||
            e.target.classList.contains('power-knob'))) return;
        var body = $f('feat-body-' + feat.key);
        if (body && body.classList.contains('hidden')) {
          openAccordion(feat.key);
        } else {
          closeAccordion(feat.key);
        }
      });
    }
  }

  for (var bi = 0; bi < FEATURES.length; bi++) {
    bindFeature(FEATURES[bi]);
  }

  /* ── When Markets favorites change externally, clear cache ── */
  /* Hook into the markets toggle endpoint response so the accordion
     re-fetches the updated list next time it opens.              */
  (function () {
    var _xhrOrig2 = window._xhr;
    window._xhr = function (method, url, body, cb) {
      if (url.indexOf('/api/markets/favorites/toggle') !== -1) {
        var wrapped = function (err, data) {
          if (!err) {
            /* invalidate markets accordion cache */
            var list = $f('feat-list-markets');
            if (list) { list.dataset.loaded = ''; }
            /* also remove any home widget for a symbol that was unfavorited */
            if (data && !data.isFavorite && body && body.symbol) {
              var sym = (body.symbol || '').toUpperCase();
              var next = [];
              var changed = false;
              for (var i = 0; i < homeWidgets.length; i++) {
                if (homeWidgets[i].type === 'markets' && homeWidgets[i].id === sym) {
                  changed = true;
                } else {
                  next.push(homeWidgets[i]);
                }
              }
              if (changed) {
                homeWidgets = next;
                saveWidgets();
              }
            }
          }
          if (cb) cb(err, data);
        };
        _xhrOrig2(method, url, body, wrapped);
        return;
      }
      _xhrOrig2(method, url, body, cb);
    };
  })();

  /* ── load initial state from settings ───────────────── */
  window._onSettingsLoad(function (data) {
    var list = Array.isArray(data.features_disabled) ? data.features_disabled : [];
    disabled = {};
    for (var di = 0; di < list.length; di++) disabled[list[di]] = true;
    homeWidgets = Array.isArray(data.home_widgets) ? data.home_widgets : [];

    for (var ai = 0; ai < FEATURES.length; ai++) {
      applyFeature(FEATURES[ai], !disabled[FEATURES[ai].key]);
    }

    /* notify HOME module so it can render immediately */
    if (window._homeSetWidgets) window._homeSetWidgets(homeWidgets);
  });

  /* ── first paint defaults (all enabled) ─────────────── */
  for (var ii = 0; ii < FEATURES.length; ii++) {
    applyFeature(FEATURES[ii], true);
  }

})();

/* ════════════════════════════════════════════════════════
   DEVICE-LOCK MODULE — ES5, iOS 9 safe
   Settings → "Smart device protection": lists HA entities and
   lets the user flag individual devices with a lock icon.
   Locked devices require the DEVICES_PIN (see auth.js) before
   every interaction, both on the Home tab and the Smart Home
   tab — enforced by window._isDeviceLocked / _guardDeviceAction
   in the main module.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function $d(id) { return document.getElementById(id); }

  /* The top module owns the canonical icon map and friendlyName — it
     always runs first, so both globals are set by the time this fires. */
  var ICONS = window._haIcons;
  function domainOf(eid)   { return eid.split('.')[0]; }
  var friendlyName = window._haFriendlyName;

  /* Locked entity ids — kept in sync with the main module's copy via
     window._setDeviceLocked, and persisted under 'ha_protected_entities'. */
  var lockedIds = {};

  function isLocked(eid) { return !!lockedIds[eid]; }

  function save() {
    var list = [];
    for (var eid in lockedIds) { if (lockedIds[eid]) list.push(eid); }
    window._xhr('POST', '/api/settings', { ha_protected_entities: list }, function () {});
  }

  function lockIconSvg(locked) {
    return locked
      /* closed padlock */
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="1.8"/></svg>'
      /* open padlock */
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  function setRowState(btn, locked) {
    btn.innerHTML = lockIconSvg(locked);
    btn.className = 'devlock-lock-btn' + (locked ? ' locked' : '');
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
  }

  function buildList(entities) {
    var list = $d('devlock-list');
    list.innerHTML = '';

    if (!entities.length) {
      list.innerHTML = '<div class="feat-widget-empty">No devices available.</div>';
      return;
    }

    for (var i = 0; i < entities.length; i++) {
      (function (entity) {
        var eid = entity.entity_id;
        var row = document.createElement('div');
        row.className = 'feat-widget-item';

        var left = document.createElement('div');
        left.className = 'feat-widget-item-left devlock-item-left';
        var ic = document.createElement('span');
        ic.className = 'feat-widget-item-icon';
        ic.textContent = ICONS[domainOf(eid)] || '◈';
        var nm = document.createElement('span');
        nm.className = 'feat-widget-item-name';
        nm.textContent = friendlyName(entity);
        left.appendChild(ic);
        left.appendChild(nm);
        row.appendChild(left);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.eid = eid;
        setRowState(btn, isLocked(eid));
        btn.addEventListener('click', function () {
          var next = !isLocked(eid);
          lockedIds[eid] = next;
          if (window._setDeviceLocked) window._setDeviceLocked(eid, next);
          setRowState(btn, next);
          save();
        });
        row.appendChild(btn);

        list.appendChild(row);
      })(entities[i]);
    }
  }

  var loaded = false;

  function populateDeviceLock() {
    if (loaded) { refreshRowStates(); return; }
    var loader = $d('devlock-loading');
    if (loader) loader.classList.remove('hidden');

    window._xhr('GET', '/api/ha/entities', null, function (err, entities) {
      if (loader) loader.classList.add('hidden');
      loaded = true;
      buildList((!err && Array.isArray(entities)) ? entities : []);
    });
  }

  /* Re-sync the lock icon of every already-rendered row with the
     current lockedIds map, without re-fetching the entity list. */
  function refreshRowStates() {
    var list = $d('devlock-list');
    if (!list) return;
    var rows = list.querySelectorAll('.feat-widget-item');
    for (var i = 0; i < rows.length; i++) {
      var btn = rows[i].querySelector('.devlock-lock-btn');
      var nm  = rows[i].querySelector('.feat-widget-item-name');
      if (!btn || !nm || !btn.dataset || !btn.dataset.eid) continue;
      setRowState(btn, isLocked(btn.dataset.eid));
    }
  }

  /* Populate as soon as we know which entities are locked, the first
     time Settings is opened (cheap: a single GET, cached afterwards). */
  if (window._onSettingsLoad) {
    window._onSettingsLoad(function (data) {
      var list = Array.isArray(data.ha_protected_entities) ? data.ha_protected_entities : [];
      lockedIds = {};
      for (var i = 0; i < list.length; i++) lockedIds[list[i]] = true;
      populateDeviceLock();
    });
  }
})();

/* ════════════════════════════════════════════════════════
   APPEARANCE MODULE — ES5, iOS 9 safe
   Manages: light/dark theme + status bar visibility + text size.
   Persists to localStorage (supported on iOS 9+ Safari).
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_THEME    = 'gres_theme';      /* 'light' | 'dark' */
  var LS_SBAR     = 'gres_statusbar';  /* 'hidden' | 'visible' */
  var LS_FONTSIZE = 'gres_fontsize';   /* 'normal' | 'large' | 'xl' */

  /* ── safe localStorage helpers (iOS 9 private mode may throw) ── */
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch(e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch(e) {}
  }

  /* ── DOM refs ──────────────────────────────────────── */
  var htmlEl      = document.documentElement;
  var bodyEl      = document.body;
  var statusBar   = document.getElementById('status-bar');
  var appEl       = document.getElementById('app');

  var themeToggle  = document.getElementById('toggle-light-theme');
  var sbarToggle   = document.getElementById('toggle-status-bar');
  var fsButtons    = document.querySelectorAll('#fs-btn-row .fs-btn');

  /* ── Apply theme ─────────────────────────────────── */
  function applyTheme(isLight) {
    if (isLight) {
      htmlEl.className = (htmlEl.className || '').replace(/\blight\b/g, '') + ' light';
    } else {
      htmlEl.className = (htmlEl.className || '').replace(/\blight\b/g, '');
    }
    /* sync toggle knob */
    if (themeToggle) {
      if (isLight) themeToggle.classList.add('on');
      else         themeToggle.classList.remove('on');
    }
  }

  /* ── Apply status bar ────────────────────────────── */
  function applyStatusBar(isVisible) {
    if (statusBar) {
      if (isVisible) {
        statusBar.classList.remove('hidden-bar');
        bodyEl.className = (bodyEl.className || '').replace(/\bstatusbar-hidden\b/g, '');
        /* restore #app top */
        appEl.style.top = '42px';
      } else {
        statusBar.classList.add('hidden-bar');
        if (bodyEl.className.indexOf('statusbar-hidden') === -1) {
          bodyEl.className = (bodyEl.className || '') + ' statusbar-hidden';
        }
        appEl.style.top = '0';
      }
    }
    /* sync toggle knob — ON means "visible" */
    if (sbarToggle) {
      if (isVisible) sbarToggle.classList.add('on');
      else           sbarToggle.classList.remove('on');
    }
  }

  /* ── Apply text size ─────────────────────────────── */
  function applyFontSize(size) {
    htmlEl.className = (htmlEl.className || '').replace(/\bfs-large\b|\bfs-xl\b/g, '');
    if (size === 'large') htmlEl.className += ' fs-large';
    else if (size === 'xl') htmlEl.className += ' fs-xl';
    /* sync button group */
    for (var i = 0; i < fsButtons.length; i++) {
      var btn = fsButtons[i];
      if (btn.getAttribute('data-fontsize') === size) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }

  /* ── Init from localStorage ──────────────────────── */
  var savedTheme    = lsGet(LS_THEME);
  var savedSbar     = lsGet(LS_SBAR);
  var savedFontSize = lsGet(LS_FONTSIZE);

  /* Default: dark theme, status bar visible, normal text size */
  var isLight   = (savedTheme === 'light');
  var sbarVisible = (savedSbar !== 'hidden'); /* default visible */
  var fontSize = (savedFontSize === 'large' || savedFontSize === 'xl') ? savedFontSize : 'normal';

  applyTheme(isLight);
  applyStatusBar(sbarVisible);
  applyFontSize(fontSize);

  /* ── Toggle handlers ─────────────────────────────── */
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      isLight = !isLight;
      applyTheme(isLight);
      lsSet(LS_THEME, isLight ? 'light' : 'dark');
    });
  }

  if (sbarToggle) {
    sbarToggle.addEventListener('click', function () {
      sbarVisible = !sbarVisible;
      applyStatusBar(sbarVisible);
      lsSet(LS_SBAR, sbarVisible ? 'visible' : 'hidden');
    });
  }

  for (var fi = 0; fi < fsButtons.length; fi++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var size = btn.getAttribute('data-fontsize');
        fontSize = size;
        applyFontSize(fontSize);
        lsSet(LS_FONTSIZE, fontSize);
      });
    })(fsButtons[fi]);
  }

})();

/* ════════════════════════════════════════════════════════
   TAP SOUND MODULE — ES5, iOS 9 safe
   A light click on every meaningful tap, the same role as the iOS
   keyboard click: instant confirmation that the tap registered.
   Self-contained (own localStorage key, own settings toggle), no
   dependency on any other module.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_TAPSOUND = 'gres_tapsound'; /* 'on' | 'off' */

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  var savedTapSound = lsGet(LS_TAPSOUND);
  var enabled = (savedTapSound !== 'off'); /* default on */

  var toggle = document.getElementById('toggle-tap-sound');
  function applyTapSoundToggle() {
    if (!toggle) return;
    if (enabled) toggle.classList.add('on');
    else toggle.classList.remove('on');
  }
  applyTapSoundToggle();
  if (toggle) {
    toggle.addEventListener('click', function () {
      enabled = !enabled;
      applyTapSoundToggle();
      lsSet(LS_TAPSOUND, enabled ? 'on' : 'off');
    });
  }

  /* ── synthesized click ─────────────────────────────────
     A short highpass-filtered noise burst reads as a percussive
     "click" — a plain oscillator tone reads as a beep instead. The
     AudioContext is created lazily, the first time playClick() runs
     from inside a real touchstart handler: iOS refuses to produce
     audio from a context built outside a user gesture, so it can't be
     constructed at module-load time. One context/buffer is created
     and reused for the whole session. */
  var Ctx = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var noiseBuffer = null;

  function ensureCtx() {
    if (!Ctx) return null;
    if (!ctx) ctx = new Ctx();
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function playClick() {
    var c = ensureCtx();
    if (!c) return;
    if (!noiseBuffer) {
      var len = Math.floor(c.sampleRate * 0.02); /* 20ms */
      noiseBuffer = c.createBuffer(1, len, c.sampleRate);
      var data = noiseBuffer.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    var src = c.createBufferSource();
    src.buffer = noiseBuffer;
    var filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500; /* bright "tick", not a hiss */
    var gain = c.createGain();
    var now = c.currentTime;
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.02); /* fast decay = percussive */
    src.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    src.start(now);
    src.stop(now + 0.03);
  }

  /* ── delegated tap detection ────────────────────────────
     Most tap targets in this app are plain divs with a click listener
     (device tiles, Proxmox tree rows, Jellyfin cards, the on/off
     switches), not <button> elements, so this can't just listen for
     button presses. Manual DOM-walk, same style as the PIN keypad's
     handleKeypadInput — matches() / closest() aren't relied on here
     since they're not guaranteed on iOS 9.3. Anything missed is a
     one-line addition to TAP_CLASSES, not a new listener. */
  var TAP_CLASSES = ['device-card', 'power-toggle', 'power-knob',
    'jelly-card', 'px-tree-item', 'mk-fav-item', 'w-head-btn'];

  function isTapTarget(el) {
    var depth = 0;
    while (el && el !== document.body && depth < 6) {
      if (el.tagName === 'BUTTON') return true;
      if (el.classList) {
        for (var i = 0; i < TAP_CLASSES.length; i++) {
          if (el.classList.contains(TAP_CLASSES[i])) return true;
        }
      }
      el = el.parentNode;
      depth++;
    }
    return false;
  }

  /* A real key click fires on press-down, not release, so touchstart
     is both the most keyboard-like trigger and the reliable place to
     unlock iOS audio. click is kept only for non-touch input (desktop
     testing); the timestamp guard stops a touch-originated tap from
     also playing via the synthetic click that follows it. Listen-only
     — no preventDefault/stopPropagation — so this can never interfere
     with any existing handler, bindFastInteraction included. */
  var _lastTouchAt = 0;

  document.addEventListener('touchstart', function (e) {
    if (!enabled || !isTapTarget(e.target)) return;
    _lastTouchAt = Date.now();
    /* ensureCtx() (create/resume) must run synchronously, inside this
       gesture, or iOS refuses to unlock audio. Everything after that —
       building the node graph and scheduling start() — doesn't need the
       gesture once the context is running, so it's deferred a tick. On
       old/slow WebKit that graph-building is heavy enough to block the
       main thread and delay the touchend/click that follows, which made
       the tap's real action appear to wait for the click sound to
       finish. Deferring it lets that action run first. */
    ensureCtx();
    setTimeout(playClick, 0);
  }, false);

  document.addEventListener('click', function (e) {
    if (Date.now() - _lastTouchAt < 500) return;
    if (enabled && isTapTarget(e.target)) playClick();
  }, false);

})();

/* ════════════════════════════════════════════════════════
   UPDATE MODULE — ES5, iOS 9 safe
   Tells the user when the page is running an older release
   than the server, and gives them a way to fix it.

   The problem it solves: this is a single page with no
   router and no build step, so after the first load
   index.html is never requested again. On the wall panel —
   a Home-screen web app under Guided Access — that means a
   deploy is invisible until someone quits and reopens the
   app, which nobody does, so the panel can sit weeks behind.

   Service workers (the modern answer) need iOS 11.3; this
   targets 9.3. So the mechanism is deliberately plain: the
   version is stamped into the HTML at serve time
   (backend/lib/indexHtml.js) and compared against
   /api/config, which reports what the SERVER is on. A
   mismatch means the browser handed us a cached page.

   Nothing reloads by itself. An unattended reload would drop
   whatever is on screen, re-lock the Settings PIN (it is
   in-memory only) and — since index.html pulls Chartist and
   the fonts from a CDN — could land while the internet is
   down and leave the panel worse off than the stale-but-
   working page it replaced. So the reload is always a tap.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Slow on purpose: this only has to beat "never", and the
     panel is a 24/7 client. A wake from standby is the more
     useful trigger of the two. */
  var POLL_MS      = 10 * 60 * 1000;
  var WAKE_GAP_MS  = 60 * 1000;

  function $(id) { return document.getElementById(id); }

  var versionEl = $('sw-version');
  var statusEl  = $('sw-status');
  var reloadBtn = $('sw-reload');

  /* Only the <head> carries the stamp, and some hosts serve
     frontend/ as plain files (the visual harness, opening the
     file directly, jsdom tests that mount <body> alone). In
     every one of those the placeholder survives untouched or
     the tag is absent — there is no release identity to
     compare against, so the check disables itself rather than
     reporting a phantom update. */
  var metaEl  = document.querySelector ? document.querySelector('meta[name="app-version"]') : null;
  var running = metaEl ? (metaEl.getAttribute('content') || '') : '';
  var stamped = !!running && running.indexOf('__') !== 0;

  if (versionEl) versionEl.textContent = stamped ? running : 'unknown';

  function setStatus(text, isUpdate) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (isUpdate) statusEl.classList.add('sw-status--update');
    else          statusEl.classList.remove('sw-status--update');
  }

  /* The toast fires once per page load, not once per check —
     otherwise a panel left un-reloaded would interrupt the
     view every ten minutes, forever. */
  var announced = false;

  function check() {
    if (!stamped) return;
    window._xhr('GET', '/api/config', null, function (err, cfg) {
      if (err || !cfg || !cfg.version) { setStatus('Version check unavailable', false); return; }
      if (cfg.version === running) { setStatus('Up to date', false); return; }
      setStatus('Version ' + cfg.version + ' available', true);
      if (!announced) {
        announced = true;
        if (window._toast) window._toast('Update available — reload from Settings', 4000);
      }
    });
  }

  if (!stamped) setStatus('Version unknown', false);
  else          check();

  if (reloadBtn) {
    reloadBtn.addEventListener('click', function () {
      setStatus('Reloading…', false);
      /* reload() and not a location assignment: in a Home-screen
         web app a navigation can bounce the user out into
         Safari, which under Guided Access is a dead end. The
         boolean "force" argument is non-standard and ignored by
         WebKit, so it is not passed — the reload already
         revalidates, since index.html is sent no-cache and
         everything else max-age=0 with an ETag. */
      window.location.reload();
    }, false);
  }

  /* A wake from standby is when a stale panel is most likely to
     be looked at, and the cheapest moment to notice. Debounced
     the same way onAppWake is, since iOS can fire
     visibilitychange and pageshow for one unlock. */
  var lastCheckAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    var now = Date.now();
    if (now - lastCheckAt < WAKE_GAP_MS) return;
    lastCheckAt = now;
    check();
  }, false);

  setInterval(function () {
    if (document.hidden) return;
    lastCheckAt = Date.now();
    check();
  }, POLL_MS);

})();
