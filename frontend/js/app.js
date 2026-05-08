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

  /* rain-drop icon for precip probability */
  window._wxRainIcon = function (size) {
    var s = size || 11;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" fill="none">' +
      '<path d="M12 3 C12 3 5 12 5 16 a7 7 0 0 0 14 0 C19 12 12 3 12 3z" fill="#70a0e0"/>' +
      '</svg>';
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

  /* ── clock ──────────────────────────────────────────── */
  function tick() {
    var n = new Date(), h = n.getHours(), m = n.getMinutes();
    $('clock').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  tick();
  setInterval(tick, 15000);

  /* ── greeting ───────────────────────────────────────── */
  (function () {
    var h = new Date().getHours();
    $('home-greeting').textContent =
      h < 6  ? 'Good night'     :
      h < 12 ? 'Good morning'   :
      h < 17 ? 'Good afternoon' :
      h < 21 ? 'Good evening'   : 'Good night';
  })();

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
    if (id === 'settings')  loadSettings();
  }

  var tabEls = document.querySelectorAll('.tab');
  for (var _ti = 0; _ti < tabEls.length; _ti++) {
    (function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-page');
        showPage(id);
        if (id === 'home' && window._homeRefresh) window._homeRefresh();
      });
    })(tabEls[_ti]);
  }

  /* expose showPage for other modules that need programmatic navigation */
  window._showPage = showPage;

  /* ── HA status ──────────────────────────────────────── */
  function checkHA() {
    xhr('GET', API + '/api/ha/status', null, function (err, data) {
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
    xhr('POST', API + '/api/ha/service', {
      domain: domain, service: service, service_data: serviceData
    }, function(err, data) { cb(err, data); });
  }

  /* ── smart home load ────────────────────────────────── */
  function loadSmartHome(force) {
    if (!state.loaded || force) {
      show($('smarthome-loading'));
      hide($('smarthome-error'));
      hide($('smarthome-content'));
    }
    xhr('GET', API + '/api/ha/entities', null, function (err, entities) {
      hide($('smarthome-loading'));
      if (err || !Array.isArray(entities)) {
        if (!state.loaded) {
          show($('smarthome-error'));
          $('smarthome-error-msg').textContent = err || 'Unable to load';
        }
        return;
      }
      state.entities = entities;
      state.loaded = true;
      var total = entities.length, active = 0;
      for (var i = 0; i < entities.length; i++) { if (isOn(entities[i])) active++; }
      $('smarthome-subtitle').textContent = total + ' devices · ' + active + ' active';
      renderGroups(entities);
      show($('smarthome-content'));
    });
  }

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
      /* HA fields — handled here in the main module */
      if (data.ha_url)   $('ha-url').value   = data.ha_url;
      if (data.ha_token) $('ha-token').value = data.ha_token;
      /* Notify every registered module callback */
      var cbs = window._settingsCallbacks;
      for (var i = 0; i < cbs.length; i++) {
        try { cbs[i](data); } catch (e) { /* keep going */ }
      }
    });
  }

  $('btn-save-ha').addEventListener('click', function () {
    var url   = ($('ha-url').value   || '').trim().replace(/\/$/, '');
    var token = ($('ha-token').value || '').trim();
    if (!url)   { toast('Enter server URL'); return; }
    if (!token) { toast('Enter the token');       return; }
    xhr('POST', API + '/api/settings', { ha_url: url, ha_token: token }, function (err) {
      err ? toast('Error: ' + err) : (toast('Saved ✓'), checkHA());
    });
  });

  $('btn-test-ha').addEventListener('click', function () {
    var url   = ($('ha-url').value   || '').trim().replace(/\/$/, '');
    var token = ($('ha-token').value || '').trim();
    var res   = $('ha-test-result');
    res.className = 'test-result hidden';
    if (!url || !token) { toast('Fill in URL and token first'); return; }
    xhr('POST', API + '/api/settings', { ha_url: url, ha_token: token }, function () {
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

  /* ── background poll ────────────────────────────────── */
  setInterval(function () {
    if (state.page === 'smarthome' && state.haConnected && state.loaded && !state.sheet.open) {
      loadSmartHome(false);
    }
  }, 20000);

  /* expose openLightSheet for Home module device cards */
  window._openLightSheet = openLightSheet;

})();

/* ════════════════════════════════════════════════════════
   HOME MODULE
   Renders home_widgets on the home tab.
   Widget types: smarthome, jelly, meteo.
   Jellyfin + Weather are rendered side-by-side in glance row.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var _glanceRow  = null;
  var _emptyEl    = null;
  var _haSection  = null;
  var _haGrid     = null;
  var _placeholderRow = null;
  var _widgets    = [];
  var _haEntities = null;

  function $(id) { return document.getElementById(id); }

  /* populate home-date */
  (function () {
    var d = new Date();
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var el = $('home-date');
    if (el) el.textContent = days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
  })();

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
    _haEntities = null;
    if (window._currentPage === 'home' || !window._currentPage) renderHome();
  };

  window._homeRefresh = function () { renderHome(); };

  /* ── main render ──────────────────────────────────── */
  function renderHome() {
    _glanceRow      = $('home-widgets');
    _emptyEl        = $('home-empty');
    _haSection      = $('home-smarthome-section');
    _haGrid         = $('home-smarthome-grid');
    _placeholderRow = $('home-placeholder-row');
    if (!_glanceRow) return;

    _glanceRow.innerHTML = '';

    var haWidgets = [];
    var hasJelly  = false;
    var hasMeteo  = false;

    for (var i = 0; i < _widgets.length; i++) {
      var w = _widgets[i];
      if (w.type === 'smarthome') haWidgets.push(w);
      else if (w.type === 'jelly') hasJelly = true;
      else if (w.type === 'meteo') hasMeteo = true;
    }

    var hasAny = haWidgets.length || hasJelly || hasMeteo;

    /* empty state */
    if (_emptyEl) {
      if (hasAny) _emptyEl.classList.remove('visible');
      else _emptyEl.classList.add('visible');
    }

    /* placeholder row: hide if we have Jelly or Meteo */
    if (_placeholderRow) {
      _placeholderRow.style.display = (hasJelly || hasMeteo) ? 'none' : '';
    }

    /* Jelly + Weather side by side in glance row */
    if (hasJelly || hasMeteo) {
      _glanceRow.style.display = '';
      if (hasJelly) {
        var jCol = document.createElement('div');
        jCol.className = 'home-glance-col';
        _glanceRow.appendChild(jCol);
        renderJellyCard(jCol);
      }
      if (hasMeteo) {
        var wCol = document.createElement('div');
        wCol.className = 'home-glance-col';
        _glanceRow.appendChild(wCol);
        renderWeatherCard(wCol);
      }
      /* solo: add class so it stretches full width */
      if ((hasJelly ? 1 : 0) + (hasMeteo ? 1 : 0) === 1) {
        _glanceRow.className = 'home-glance-row solo';
      } else {
        _glanceRow.className = 'home-glance-row';
      }
    } else {
      _glanceRow.style.display = 'none';
    }

    /* HA tiles */
    if (_haSection && _haGrid) {
      if (haWidgets.length) {
        _haSection.classList.remove('hidden');
        _haGrid.innerHTML = '';
        buildHACards(_haGrid, haWidgets, _haEntities || []);
        if (!_haEntities) {
          window._xhr('GET', '/api/ha/entities', null, function (err, entities) {
            if (!err && Array.isArray(entities)) _haEntities = entities;
            buildHACards(_haGrid, haWidgets, _haEntities || []);
          });
        }
      } else {
        _haSection.classList.add('hidden');
      }
    }
  }

  /* ── HA devices ────────────────────────────────────── */
  function buildHACards(grid, haWidgets, entities) {
    grid.innerHTML = '';
    var entityMap = {};
    for (var i = 0; i < entities.length; i++) entityMap[entities[i].entity_id] = entities[i];

    var ICONS = { light:'○', switch:'⌁', input_boolean:'⌁', media_player:'▷', climate:'◇', fan:'◎', cover:'▭' };
    function domainOf(eid)   { return eid.split('.')[0]; }
    function isOn(e)         { var s=e.state; return s==='on'||s==='open'||s==='playing'||s==='paused'||s==='idle'; }
    function stateLabel(s)   { var m={on:'On',off:'Off',open:'Open',closed:'Closed',playing:'Playing',paused:'Paused',idle:'Idle',unavailable:'N/A',unknown:'?'}; return m[s]||s; }
    function friendlyName(e) { return (e.attributes&&e.attributes.friendly_name)?e.attributes.friendly_name:e.entity_id.split('.')[1].replace(/_/g,' '); }
    function make(tag,cls,txt){ var el=document.createElement(tag); if(cls)el.className=cls; if(txt!=null)el.textContent=txt; return el; }

    for (var k = 0; k < haWidgets.length; k++) {
      (function (w) {
        var entity = entityMap[w.id];
        if (!entity) {
          var ghost = make('div','device-card unavail');
          ghost.appendChild(make('div','card-icon','◈'));
          var gi=make('div','card-info'); gi.appendChild(make('div','card-name',w.label||w.id)); gi.appendChild(make('div','card-state','N/A'));
          ghost.appendChild(gi); grid.appendChild(ghost); return;
        }
        var on = isOn(entity), unavail = entity.state==='unavailable', domain = domainOf(entity.entity_id);
        var card = make('div','device-card'+(on?' on':'')+(unavail?' unavail':''));
        card.setAttribute('data-eid', entity.entity_id);
        var ico=make('div','card-icon',ICONS[domain]||'◈');
        var info=make('div','card-info');
        info.appendChild(make('div','card-name',friendlyName(entity)));
        var stateEl=make('div','card-state',stateLabel(entity.state));
        info.appendChild(stateEl);

        if (domain==='light' && !unavail) {
          var split=make('div','light-card-split');
          var lb=make('button','light-main-toggle'); lb.type='button';
          var iw=make('div','light-main-icon-wrap'); iw.appendChild(ico); lb.appendChild(iw); lb.appendChild(info);
          var rb=make('button','light-detail-open','›'); rb.type='button';
          lb.addEventListener('click', function(ev){ ev.stopPropagation();
            window._xhr('POST','/api/ha/service',{domain:'light',service:on?'turn_off':'turn_on',service_data:{entity_id:entity.entity_id}},function(err){
              if(!err){on=!on;entity.state=on?'on':'off';_haEntities=null;card.className='device-card'+(on?' on':'');stateEl.textContent=stateLabel(entity.state);}
            });
          });
          rb.addEventListener('click',function(ev){ ev.stopPropagation(); if(window._openLightSheet)window._openLightSheet(entity); });
          split.appendChild(lb); split.appendChild(rb); card.appendChild(split);
        } else {
          card.appendChild(ico); card.appendChild(info);
          if (!unavail) {
            card.addEventListener('click', function(){
              var svc=on?(domain==='cover'?'close_cover':'turn_off'):(domain==='cover'?'open_cover':'turn_on');
              var sd=domain==='cover'?'cover':(domain==='media_player'?'media_player':domain);
              window._xhr('POST','/api/ha/service',{domain:sd,service:svc,service_data:{entity_id:entity.entity_id}},function(err){
                if(!err){on=!on;entity.state=on?'on':'off';_haEntities=null;card.className='device-card'+(on?' on':'');stateEl.textContent=stateLabel(entity.state);}
              });
            });
          }
        }
        grid.appendChild(card);
      })(haWidgets[k]);
    }
  }

  /* ── Jellyfin card ─────────────────────────────────── */
  function renderJellyCard(col) {
    var card = document.createElement('div');
    card.className = 'hw-jelly-card';
    col.appendChild(card);

    /* skeleton */
    card.innerHTML =
      '<div class="hw-jelly-posters">' +
        '<div class="hw-jelly-poster"><div class="hw-jelly-poster-fallback"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="3" stroke="#3a3a5a" stroke-width="1.6"/><path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="#3a3a5a"/></svg></div></div>' +
        '<div class="hw-jelly-poster"><div class="hw-jelly-poster-fallback"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="3" stroke="#3a3a5a" stroke-width="1.6"/><path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="#3a3a5a"/></svg></div></div>' +
        '<div class="hw-jelly-poster"><div class="hw-jelly-poster-fallback"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="3" stroke="#3a3a5a" stroke-width="1.6"/><path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="#3a3a5a"/></svg></div></div>' +
      '</div>' +
      '<div class="hw-jelly-meta">' +
        '<div class="hw-jelly-meta-left"><span class="hw-jelly-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="currentColor"/></svg></span><span class="hw-jelly-title">Jellyfin</span></div>' +
        '<span class="hw-jelly-counts">…</span>' +
        '<span class="hw-jelly-arrow">›</span>' +
      '</div>';

    window._xhr('GET', '/api/jf/home-summary', null, function (err, data) {
      if (err || !data) {
        card.querySelector('.hw-jelly-counts').textContent = 'N/A';
        return;
      }
      var postersEl = card.querySelector('.hw-jelly-posters');
      postersEl.innerHTML = '';
      var recent = Array.isArray(data.recentMovies) ? data.recentMovies : [];
      while (recent.length < 3) recent.push(null);
      recent = recent.slice(0, 3);
      for (var i = 0; i < 3; i++) {
        (function (item) {
          var div = document.createElement('div');
          div.className = 'hw-jelly-poster';
          var fb = document.createElement('div');
          fb.className = 'hw-jelly-poster-fallback';
          fb.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="18" rx="3" stroke="#3a3a5a" stroke-width="1.6"/><path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="#3a3a5a"/></svg>';
          div.appendChild(fb);
          if (item && item.id) {
            var img = new Image();
            img.onload = function () { div.style.backgroundImage = 'url(' + img.src + ')'; };
            img.src = '/api/jf/image/' + item.id + '?type=Primary&maxH=220';
          }
          if (item) {
            var ttl = document.createElement('div');
            ttl.className = 'hw-jelly-poster-title';
            ttl.textContent = item.name + (item.year ? ' ' + item.year : '');
            div.appendChild(ttl);
          }
          postersEl.appendChild(div);
        })(recent[i]);
      }
      var counts = (data.totalMovies || 0) + ' films · ' + (data.totalSeries || 0) + ' series';
      card.querySelector('.hw-jelly-counts').textContent = counts;
    });

    card.addEventListener('click', function () {
      var t = document.querySelector('[data-page="jelly"]');
      if (t) t.click();
    });
  }

  /* ── Weather card ──────────────────────────────────── */
  function renderWeatherCard(col) {
    var card = document.createElement('div');
    card.className = 'hw-wx-card';
    col.appendChild(card);

    card.innerHTML = '<div class="hw-wx-na">Loading…</div>';

    window._xhr('GET', '/api/weather/home-summary', null, function (err, data) {
      card.innerHTML = '';

      if (err || !data || !data.current) {
        card.innerHTML = '<div class="hw-wx-na">N/A</div>';
        return;
      }

      var cur   = data.current;
      var today = data.today    || {};
      var loc   = data.location || {};
      var code  = cur.weatherCode != null ? cur.weatherCode : 0;
      var isDay = cur.isDay      != null ? cur.isDay        : 1;

      /* ── top bar: pin + location ── */
      var topbar = document.createElement('div');
      topbar.className = 'hw-wx-topbar';
      var pin = document.createElement('span');
      pin.className = 'hw-wx-pin';
      pin.textContent = '⌖';          /* pin-point glyph */
      var locEl = document.createElement('span');
      locEl.className = 'hw-wx-loc';
      locEl.textContent = loc.name || '';
      topbar.appendChild(pin);
      topbar.appendChild(locEl);
      card.appendChild(topbar);

      /* ── main row ── */
      var main = document.createElement('div');
      main.className = 'hw-wx-main';

      /* icon — large */
      var iconEl = document.createElement('div');
      iconEl.className = 'hw-wx-icon';
      if (window._wxIcon) iconEl.innerHTML = window._wxIcon(code, isDay, 42);
      main.appendChild(iconEl);

      /* current temp */
      var tempEl = document.createElement('div');
      tempEl.className = 'hw-wx-temp';
      tempEl.textContent = cur.temp != null ? cur.temp + '°' : '--°';
      main.appendChild(tempEl);

      /* max / min stacked */
      var rangeCol = document.createElement('div');
      rangeCol.className = 'hw-wx-range-col';
      var maxEl = document.createElement('div');
      maxEl.className = 'hw-wx-range-max';
      maxEl.textContent = today.tempMax != null ? today.tempMax + '°' : '--°';
      var minEl = document.createElement('div');
      minEl.className = 'hw-wx-range-min';
      minEl.textContent = today.tempMin != null ? today.tempMin + '°' : '--°';
      rangeCol.appendChild(maxEl);
      rangeCol.appendChild(minEl);
      main.appendChild(rangeCol);

      /* humidity pushed to right */
      var humCol = document.createElement('div');
      humCol.className = 'hw-wx-humidity-col';
      var humLabel = document.createElement('div');
      humLabel.className = 'hw-wx-hum-label';
      humLabel.textContent = 'Prec.';
      var humVal = document.createElement('div');
      humVal.className = 'hw-wx-hum-val';
      humVal.textContent = today.precipProb != null ? Math.round(today.precipProb) + '%' : '--';
      humCol.appendChild(humLabel);
      humCol.appendChild(humVal);
      main.appendChild(humCol);

      card.appendChild(main);
    });

    card.addEventListener('click', function () {
      var t = document.querySelector('[data-page="meteo"]');
      if (t) t.click();
    });
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
})();

/* ════════════════════════════════════════════════════════
   WEATHER MODULE
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var wx = {
    defaultLocation: null,
    transientLocation: null,
    selectedSettingsLocation: null,
    settingsSearchTimer: null,
    meteoSearchTimer: null,
    chart: null,
    loaded: false
  };

  function $w(id) { return document.getElementById(id); }

  function wxGet(url, cb)            { window._xhr('GET',  url, null, cb); }
  function wxPostSettings(body, cb)  { window._xhr('POST', '/api/settings', body, cb); }
  function wxToast(msg)              { window._toast(msg); }

  function locLabel(loc) {
    if (!loc) return '—';
    var parts = [loc.name || ''];
    if (loc.admin1) parts.push(loc.admin1);
    if (loc.country) parts.push(loc.country);
    return parts.join(', ');
  }

  function weatherCodeLabel(code) {
    if (code === 0) return 'Sunny';
    if (code === 1) return 'Mostly Sunny';
    if (code === 2) return 'Partly Cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if (code === 51 || code === 53 || code === 55) return 'Light Rain';
    if (code === 56 || code === 57) return 'Freezing Drizzle';
    if (code === 61 || code === 63 || code === 65) return 'Rain';
    if (code === 66 || code === 67) return 'Freezing Rain';
    if (code === 71 || code === 73 || code === 75) return 'Snow';
    if (code === 77) return 'Ice Pellets';
    if (code === 80 || code === 81 || code === 82) return 'Light showers';
    if (code === 85 || code === 86) return 'Snow showers';
    if (code === 95) return 'Thunderstorm';
    if (code === 96 || code === 99) return 'Thunderstorm with hail';
    return 'Variable conditions';
  }

  function weekdayLabel(dateStr) {
    if (!dateStr) return '—';
    var p = dateStr.split('-');
    if (p.length !== 3) return dateStr;
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return names[d.getDay()];
  }

  function temp(v) {
    if (v === undefined || v === null || isNaN(v)) return '--°';
    return Math.round(v) + '°';
  }

  function loadSettingsWeather(cb) {
    wxGet('/api/settings', function (err, data) {
      if (err || !data) { cb(err || 'Error loading settings', null); return; }
      wx.defaultLocation = data.weather_default_location || null;
      cb(null, data);
    });
  }

  function renderLocationSearchResults(el, locations, onPick) {
    el.innerHTML = '';
    if (!locations || !locations.length) {
      el.innerHTML = '<div class="form-hint">No results found</div>';
      return;
    }
    for (var i = 0; i < locations.length; i++) {
      (function (loc) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'weather-search-item';
        b.innerHTML = '<strong>' + loc.name + '</strong>' +
          '<span>' + (loc.admin1 || '') + (loc.admin1 && loc.country ? ', ' : '') + (loc.country || '') + '</span>';
        b.addEventListener('click', function () { onPick(loc); });
        el.appendChild(b);
      })(locations[i]);
    }
  }

  function loadForecastForLocation(loc) {
    if (!loc) return;
    $w('weather-loading').classList.remove('hidden');
    $w('weather-error').classList.add('hidden');
    $w('weather-content').classList.add('hidden');

    var url = '/api/weather/forecast?lat=' + encodeURIComponent(loc.latitude) +
      '&lon=' + encodeURIComponent(loc.longitude) +
      '&timezone=' + encodeURIComponent(loc.timezone || 'auto');

    wxGet(url, function (err, data) {
      $w('weather-loading').classList.add('hidden');
      if (err || !data) {
        $w('weather-error').classList.remove('hidden');
        $w('weather-error-msg').textContent = err || 'Error loading weather data';
        return;
      }
      $w('weather-content').classList.remove('hidden');
      wx.loaded = true;
      renderWeather(data, loc);
    });
  }

  function renderWeather(data, loc) {
    var cur      = data.current  || {};
    var today    = data.today    || {};
    var tomorrow = data.tomorrow || {};
    var days     = data.days     || [];
    var isDay    = cur.is_day != null ? cur.is_day : 1;

    $w('weather-city').textContent = locLabel(loc);
    $w('weather-subtitle').textContent = 'Weather · ' + (loc.name || 'location');
    $w('weather-current-temp').textContent = temp(cur.temperature_2m);
    $w('weather-current-desc').textContent = weatherCodeLabel(cur.weather_code);
    $w('weather-current-humidity').textContent =
      (cur.relative_humidity_2m != null) ? (Math.round(cur.relative_humidity_2m) + '%') : '—';
    $w('weather-current-wind').textContent =
      (cur.wind_speed_10m != null) ? (Math.round(cur.wind_speed_10m) + ' km/h') : '—';

    /* large icon in now-card */
    var iconSlot = $w('weather-current-icon');
    if (iconSlot && window._wxIcon) iconSlot.innerHTML = window._wxIcon(cur.weather_code, isDay, 48);

    $w('weather-today-max').textContent = temp(today.tempMax);
    $w('weather-today-min').textContent = temp(today.tempMin);
    $w('weather-today-desc').textContent = weatherCodeLabel(today.weatherCode);
    var todayIcon = $w('weather-today-icon');
    if (todayIcon && window._wxIcon) todayIcon.innerHTML = window._wxIcon(today.weatherCode, 1, 26);
    var todayPrecip = $w('weather-today-precip');
    if (todayPrecip) {
      if (today.precipProb != null) {
        todayPrecip.innerHTML = (window._wxRainIcon ? window._wxRainIcon(10) : '') + ' ' + Math.round(today.precipProb) + '%';
        todayPrecip.style.display = '';
      } else { todayPrecip.style.display = 'none'; }
    }

    $w('weather-tomorrow-max').textContent = temp(tomorrow.tempMax);
    $w('weather-tomorrow-min').textContent = temp(tomorrow.tempMin);
    $w('weather-tomorrow-desc').textContent = weatherCodeLabel(tomorrow.weatherCode);
    var tomorrowIcon = $w('weather-tomorrow-icon');
    if (tomorrowIcon && window._wxIcon) tomorrowIcon.innerHTML = window._wxIcon(tomorrow.weatherCode, 1, 26);
    var tomorrowPrecip = $w('weather-tomorrow-precip');
    if (tomorrowPrecip) {
      if (tomorrow.precipProb != null) {
        tomorrowPrecip.innerHTML = (window._wxRainIcon ? window._wxRainIcon(10) : '') + ' ' + Math.round(tomorrow.precipProb) + '%';
        tomorrowPrecip.style.display = '';
      } else { tomorrowPrecip.style.display = 'none'; }
    }

    renderWeatherChart(days);
    render10Days(days);
  }

  function renderWeatherChart(days) {
    var elId = 'weather-temp-chart';
    var el = $w(elId);
    if (!el) return;
    if (!window.Chartist) { el.innerHTML = '<div class="form-hint">Grafico non disponibile</div>'; return; }

    var labels = [], maxS = [], minS = [];
    for (var i = 0; i < days.length && i < 10; i++) {
      labels.push(weekdayLabel(days[i].date));
      maxS.push(days[i].tempMax != null ? parseFloat(days[i].tempMax) : 0);
      minS.push(days[i].tempMin != null ? parseFloat(days[i].tempMin) : 0);
    }
    if (wx.chart && wx.chart.detach) { try { wx.chart.detach(); } catch (e) {} }
    wx.chart = new Chartist.Line('#' + elId, { labels: labels, series: [maxS, minS] }, {
      showPoint: false, lineSmooth: false, fullWidth: true,
      axisX: { showGrid: false }, axisY: { onlyInteger: true, offset: 26 },
      chartPadding: { top: 8, right: 8, bottom: 8, left: 0 }
    });
  }

  function render10Days(days) {
    var list = $w('weather-days-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < days.length && i < 10; i++) {
      (function (d) {
        var row = document.createElement('div');
        row.className = 'weather-day-row';

        var iconEl = document.createElement('div');
        iconEl.className = 'weather-day-icon';
        if (window._wxIcon) iconEl.innerHTML = window._wxIcon(d.weatherCode, 1, 18);
        row.appendChild(iconEl);

        var nameEl = document.createElement('div');
        nameEl.className = 'weather-day-name';
        nameEl.textContent = weekdayLabel(d.date);
        row.appendChild(nameEl);

        var summaryWrap = document.createElement('div');
        summaryWrap.style.cssText = '-webkit-box-flex:1;-webkit-flex:1;flex:1;display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;gap:4px;';
        var summaryEl = document.createElement('div');
        summaryEl.className = 'weather-day-summary';
        summaryEl.textContent = weatherCodeLabel(d.weatherCode);
        summaryWrap.appendChild(summaryEl);
        if (d.precipProb != null && d.precipProb > 0) {
          var precipEl = document.createElement('div');
          precipEl.className = 'weather-day-precip';
          precipEl.innerHTML = (window._wxRainIcon ? window._wxRainIcon(9) : '') + '<span>' + Math.round(d.precipProb) + '%</span>';
          summaryWrap.appendChild(precipEl);
        }
        row.appendChild(summaryWrap);

        var rangeEl = document.createElement('div');
        rangeEl.className = 'weather-day-range';
        rangeEl.textContent = temp(d.tempMax) + ' / ' + temp(d.tempMin);
        row.appendChild(rangeEl);

        list.appendChild(row);
      })(days[i]);
    }
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
      if (!q) { resultsEl.innerHTML = ''; return; }
      wx.settingsSearchTimer = setTimeout(function () {
        wxGet('/api/weather/search?q=' + encodeURIComponent(q), function (err, data) {
          if (err || !data) {
            resultsEl.innerHTML = '<div class="form-hint">An error occurred while searching for location</div>';
            return;
          }
          renderLocationSearchResults(resultsEl, data.locations || [], function (loc) {
            wx.selectedSettingsLocation = loc;
            refreshSelectedLabel();
            resultsEl.innerHTML = '';
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
        refreshSelectedLabel();
        wxToast('Default location saved ✓');
      });
    });
  }

  function initMeteoTransientSearch() {
    $w('weather-other-location').addEventListener('click', function () {
      $w('weather-search-panel').classList.toggle('hidden');
    });

    var input = $w('weather-search-input');
    var results = $w('weather-search-results');

    input.addEventListener('input', function () {
      clearTimeout(wx.meteoSearchTimer);
      var q = (input.value || '').trim();
      if (!q) { results.innerHTML = ''; return; }
      wx.meteoSearchTimer = setTimeout(function () {
        wxGet('/api/weather/search?q=' + encodeURIComponent(q), function (err, data) {
          if (err || !data) {
            results.innerHTML = '<div class="form-hint">An error occurred while searching for location</div>';
            return;
          }
          renderLocationSearchResults(results, data.locations || [], function (loc) {
            wx.transientLocation = loc;
            input.value = '';
            results.innerHTML = '';
            $w('weather-search-panel').classList.add('hidden');
            loadForecastForLocation(loc);
          });
        });
      }, 350);
    });
  }

  $w('weather-retry').addEventListener('click', function () {
    loadWeatherPage();
  });

  document.querySelector('[data-page="meteo"]').addEventListener('click', function () {
    setTimeout(function () { loadWeatherPage(); }, 60);
  }, true);

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

      var type     = $j('jf-type').value;
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
        var cardW = Math.round((window.innerWidth - 32) / 5);
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

  $j('jf-type').addEventListener('change', onFilterChange);
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

  /* ── settings: Jellyfin save & test ────────────────── */
  $j('btn-save-jf').addEventListener('click', function () {
    var url   = ($j('jf-url').value   || '').trim().replace(/\/$/, '');
    var token = ($j('jf-token').value || '').trim();
    if (!url)   { jfToast('Enter server URL'); return; }
    if (!token) { jfToast('Enter the API token');   return; }
    jfPost('/api/settings', { jf_url: url, jf_token: token }, function (err) {
      if (err) jfToast('Error: ' + err);
      else {
        jfToast('Jellyfin saved ✓');
        jf.userId = null; // reset cache
      }
    });
  });

  $j('btn-test-jf').addEventListener('click', function () {
    var url   = ($j('jf-url').value   || '').trim().replace(/\/$/, '');
    var token = ($j('jf-token').value || '').trim();
    var res   = $j('jf-test-result');
    res.className = 'test-result hidden';
    if (!url || !token) { jfToast('Fill in URL and token first'); return; }
    jfPost('/api/settings', { jf_url: url, jf_token: token }, function () {
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

  /* Jellyfin registers itself with the central settings loader */
  window._onSettingsLoad(function (data) {
    if (data.jf_url)   $j('jf-url').value   = data.jf_url;
    if (data.jf_token) $j('jf-token').value = data.jf_token;
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
              btn.disabled = true;
              pxPost('/nodes/' + nodeName + '/power', { command: action }, function(err) {
                btn.disabled = false;
                if (err) pxToast('Error: ' + err);
                else     pxToast('Command sent: ' + action);
              });
            }
          );
        });
      })(btns[i]);
    }
  }

  /* ── SELECT VM ──────────────────────────────────────── */
  function selectVM(nodeName, vmid, vmType, vmData) {
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
    pxPost('/nodes/' + nodeName + '/' + vmType + '/' + vmid + '/action', { action: action }, function(err) {
      if (err) { pxToast('Error: ' + err); return; }
      pxToast('Command "' + action + '" sent');
      // reload status after short delay
      setTimeout(function () {
        selectVM(nodeName, vmid, vmType, {});
      }, 2500);
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
  $p('btn-save-px').addEventListener('click', function () {
    var url     = ($p('px-url').value     || '').trim().replace(/\/$/, '');
    var tokenid = ($p('px-tokenid').value || '').trim();
    var token   = ($p('px-token').value   || '').trim();
    if (!url)     { pxToast('Enter server URL'); return; }
    if (!tokenid) { pxToast('Enter the Token ID');   return; }
    if (!token)   { pxToast('Enter the Token Secret'); return; }
    pxPostSettings({ px_url: url, px_tokenid: tokenid, px_token: token }, function(err) {
      if (err) pxToast('Error: ' + err);
      else { pxToast('Proxmox saved ✓'); px.loaded = false; }
    });
  });

  $p('btn-test-px').addEventListener('click', function () {
    var url     = ($p('px-url').value     || '').trim().replace(/\/$/, '');
    var tokenid = ($p('px-tokenid').value || '').trim();
    var token   = ($p('px-token').value   || '').trim();
    var res     = $p('px-test-result');
    res.className = 'test-result hidden';
    if (!url || !tokenid || !token) { pxToast('Fill in all fields first'); return; }
    pxPostSettings({ px_url: url, px_tokenid: tokenid, px_token: token }, function () {
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

  /* Proxmox registers itself with the central settings loader */
  window._onSettingsLoad(function (d) {
    if (d.px_url)     $p('px-url').value     = d.px_url;
    if (d.px_tokenid) $p('px-tokenid').value = d.px_tokenid;
    if (d.px_token)   $p('px-token').value   = d.px_token;
  });

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
    { key: 'server',    label: 'Server',     page: 'server',    tab: 'server',    routes: ['/api/proxmox', '/nodes'] }
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
      function friendlyName(e) {
        return (e.attributes && e.attributes.friendly_name)
          ? e.attributes.friendly_name
          : e.entity_id.split('.')[1].replace(/_/g,' ');
      }

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
   APPEARANCE MODULE — ES5, iOS 9 safe
   Manages: light/dark theme + status bar visibility.
   Persists to localStorage (supported on iOS 9+ Safari).
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_THEME  = 'gres_theme';      /* 'light' | 'dark' */
  var LS_SBAR   = 'gres_statusbar';  /* 'hidden' | 'visible' */

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

  /* ── Init from localStorage ──────────────────────── */
  var savedTheme = lsGet(LS_THEME);
  var savedSbar  = lsGet(LS_SBAR);

  /* Default: dark theme, status bar visible */
  var isLight   = (savedTheme === 'light');
  var sbarVisible = (savedSbar !== 'hidden'); /* default visible */

  applyTheme(isLight);
  applyStatusBar(sbarVisible);

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

})();
