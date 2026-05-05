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

  /* ── navigation ─────────────────────────────────────── */
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
    // Load page-specific data if needed
    if (id === 'smarthome') loadSmartHome(false);
    if (id === 'settings')  loadSettings();
  }

  var tabEls = document.querySelectorAll('.tab');
  for (var _ti = 0; _ti < tabEls.length; _ti++) {
    (function (tab) {
      tab.addEventListener('click', function () { showPage(tab.getAttribute('data-page')); });
    })(tabEls[_ti]);
  }

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
    // draw hue/saturation wheel
    for (var angle = 0; angle < 360; angle++) {
      var startAngle = (angle - 1) * Math.PI / 180;
      var endAngle   = (angle + 1) * Math.PI / 180;
      for (var sat = 0; sat <= 100; sat += 2) {
        // draw small arc segments per saturation
      }
    }
    // Use imageData for performance
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
  canvas.addEventListener('mouseup',    function(){ _wheelDragging = false; });
  canvas.addEventListener('touchstart', function(e){ handleWheelEvent(e); }, false);
  canvas.addEventListener('touchmove',  function(e){ handleWheelEvent(e); }, false);

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

  function mkGet(url, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        if (req.status >= 200 && req.status < 300) cb(null, j);
        else cb((j && j.error) || ('HTTP ' + req.status), null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(null);
  }

  function mkPost(url, body, cb) {
    var req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        if (req.status >= 200 && req.status < 300) cb(null, j);
        else cb((j && j.error) || ('HTTP ' + req.status), null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(JSON.stringify(body || {}));
  }

  function marketToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.classList.add('hidden'); }, 260);
    }, 2200);
  }

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
      if (!mk.loaded) loadFavorites();
      else loadFavorites();
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

  function wxGet(url, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        if (req.status >= 200 && req.status < 300) cb(null, j);
        else cb((j && j.error) || 'HTTP ' + req.status, null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(null);
  }

  function wxPostSettings(body, cb) {
    var req = new XMLHttpRequest();
    req.open('POST', '/api/settings', true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        if (req.status >= 200 && req.status < 300) cb(null, j);
        else cb((j && j.error) || 'HTTP ' + req.status, null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(JSON.stringify(body || {}));
  }

  function wxToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.classList.add('hidden'); }, 260);
    }, 2300);
  }

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
    var cur = data.current || {};
    var today = data.today || {};
    var tomorrow = data.tomorrow || {};
    var days = data.days || [];

    $w('weather-city').textContent = locLabel(loc);
    $w('weather-subtitle').textContent = 'Weather · ' + (loc.name || 'location');
    $w('weather-current-temp').textContent = temp(cur.temperature_2m);
    $w('weather-current-desc').textContent = weatherCodeLabel(cur.weather_code);
    $w('weather-current-humidity').textContent =
      (cur.relative_humidity_2m !== undefined && cur.relative_humidity_2m !== null)
        ? (Math.round(cur.relative_humidity_2m) + '%')
        : '—';
    $w('weather-current-wind').textContent =
      (cur.wind_speed_10m !== undefined && cur.wind_speed_10m !== null)
        ? (Math.round(cur.wind_speed_10m) + ' km/h')
        : '—';

    $w('weather-today-max').textContent = temp(today.tempMax);
    $w('weather-today-min').textContent = temp(today.tempMin);
    $w('weather-today-desc').textContent = weatherCodeLabel(today.weatherCode);

    $w('weather-tomorrow-max').textContent = temp(tomorrow.tempMax);
    $w('weather-tomorrow-min').textContent = temp(tomorrow.tempMin);
    $w('weather-tomorrow-desc').textContent = weatherCodeLabel(tomorrow.weatherCode);

    renderWeatherChart(days);
    render10Days(days);
  }

  function renderWeatherChart(days) {
    var elId = 'weather-temp-chart';
    var el = $w(elId);
    if (!el) return;
    if (!window.Chartist) { el.innerHTML = '<div class="form-hint">Grafico non disponibile</div>'; return; }

    var labels = [];
    var maxS = [];
    var minS = [];
    for (var i = 0; i < days.length && i < 10; i++) {
      labels.push(weekdayLabel(days[i].date));
      maxS.push(days[i].tempMax != null ? parseFloat(days[i].tempMax) : 0);
      minS.push(days[i].tempMin != null ? parseFloat(days[i].tempMin) : 0);
    }

    if (wx.chart && wx.chart.detach) { try { wx.chart.detach(); } catch (e) {} }

    wx.chart = new Chartist.Line('#' + elId, {
      labels: labels,
      series: [maxS, minS]
    }, {
      showPoint: false,
      lineSmooth: false,
      fullWidth: true,
      axisX: { showGrid: false },
      axisY: { onlyInteger: true, offset: 26 },
      chartPadding: { top: 8, right: 8, bottom: 8, left: 0 }
    });
  }

  function render10Days(days) {
    var list = $w('weather-days-list');
    if (!list) return;
    list.innerHTML = '';
    for (var i = 0; i < days.length && i < 10; i++) {
      var d = days[i];
      var row = document.createElement('div');
      row.className = 'weather-day-row';
      row.innerHTML =
        '<div class="weather-day-name">' + weekdayLabel(d.date) + '</div>' +
        '<div class="weather-day-summary">' + weatherCodeLabel(d.weatherCode) + '</div>' +
        '<div class="weather-day-range">' + temp(d.tempMax) + ' / ' + temp(d.tempMin) + '</div>';
      list.appendChild(row);
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

  function jfXhr(url, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', url, true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        req.status >= 200 && req.status < 300 ? cb(null, j) : cb(j.error || 'HTTP ' + req.status, null);
      } catch (x) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(null);
  }

  function jfPost(url, body, cb) {
    var req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        req.status >= 200 && req.status < 300 ? cb(null, j) : cb(j.error || 'HTTP ' + req.status, null);
      } catch (x) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(body ? JSON.stringify(body) : null);
  }

  function jfToast(msg) {
    // reuse global toast
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.classList.add('hidden'); }, 260);
    }, 2400);
  }

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

  function pxGet(path, cb) {
    var req = new XMLHttpRequest();
    req.open('GET', '/api/px' + path, true);
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        req.status >= 200 && req.status < 300
          ? cb(null, j)
          : cb(j.error || 'HTTP ' + req.status, null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network unreachable', null); };
    req.send(null);
  }

  function pxPost(path, body, cb) {
    var req = new XMLHttpRequest();
    req.open('POST', '/api/px' + path, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try {
        var j = JSON.parse(req.responseText);
        req.status >= 200 && req.status < 300
          ? cb(null, j)
          : cb(j.error || 'HTTP ' + req.status, null);
      } catch (e) { cb('Invalid response', null); }
    };
    req.onerror = function () { cb('Network unreachable', null); };
    req.send(JSON.stringify(body || {}));
  }

  function pxPostSettings(body, cb) {
    var req = new XMLHttpRequest();
    req.open('POST', '/api/settings', true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.onreadystatechange = function () {
      if (req.readyState !== 4) return;
      try { var j = JSON.parse(req.responseText); cb(null, j); }
      catch(e) { cb('Error', null); }
    };
    req.onerror = function () { cb('Network error', null); };
    req.send(JSON.stringify(body));
  }

  function pxToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.classList.add('hidden'); }, 260);
    }, 2600);
  }

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
        '⬡', node.node, node.status || '—', statusClass(node.status));
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
            vm._type === 'lxc' ? '⬢' : '▣',
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
            '▪',
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

  function makeTreeItem(kind, name, meta, payload, icon, labelText, metaText, dotCls) {
    var item = document.createElement('div');
    item.className = 'px-tree-item px-' + kind;

    var ico = document.createElement('div');
    ico.className = 'px-item-icon';
    ico.textContent = icon;

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
      html += statCard('CPU', running ? cpuPct + '%' : '—', status.cpus ? status.cpus + ' vCPU' : '', running ? parseFloat(cpuPct)/100 : 0, 'cpu');
      html += statCard('RAM', fmtBytes(memUsed), fmtBytes(memTot) + ' · ' + memPct, running ? memUsed/memTot : 0, 'mem');
      html += statCard('Disk R', fmtBytes(diskRead), 'totale lettura', 0, '');
      html += statCard('Disk W', fmtBytes(diskWrite), 'totale scrittura', 0, '');
      html += statCard('Net In',  fmtBytes(netIn),  '', 0, '');
      html += statCard('Net Out', fmtBytes(netOut), '', 0, '');
      if (status.uptime)
        html += statCard('Uptime', fmtUptime(status.uptime), '', 0, '');
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
    // update stat values in place
    var cards = detail.querySelectorAll('.px-stat-card');
    if (!cards.length) return;
    // simpler: just refresh cpu bar and mem bar by ID if we can
    // For simplicity reload charts only
    loadVMCharts(
      px.selected.node,
      px.selected.type,
      px.selected.vmid
    );
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
  function statCard(label, value, sub, fillRatio, fillClass) {
    var barHtml = '';
    if (fillClass && fillRatio !== undefined && fillRatio >= 0) {
      var w = Math.min(100, Math.round(fillRatio * 100));
      barHtml = '<div class="px-bar-wrap"><div class="px-bar-fill ' + fillClass + '" style="width:' + w + '%"></div></div>';
    }
    return '<div class="px-stat-card">' +
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
