/* ════════════════════════════════════════════════════════
   HOME WIDGET REGISTRY + SHELL — ES5, iOS 9 safe

   Loaded BEFORE app.js. Everything here is definitions and
   builders; nothing fires a request at parse time. Widgets
   resolve window._xhr / window._toast / window._guardDeviceAction
   at the moment render() runs, which is always after app.js has
   defined them — so load order is never a race.

   A widget definition is:
     {
       type:       'meteo',          // matches home_widgets[].type
       title:      'Weather',
       icon:       '<svg …>',
       wide:       false,            // or a function(entries) -> bool
       aggregate:  false,            // true = one card for ALL entries
                                     //        of this type (Smart Home),
                                     //        false = one card per entry
       refreshSec: 900,              // how stale this may get; the HOME
                                     //   module's shared scheduler calls
                                     //   render() again on that cadence.
                                     //   Omit for push-updated widgets.
       render:     function (ctx) {} // fills ctx.body; must be safe to
                                     //   call repeatedly on the same ctx
     }

   ctx, handed to render(), carries:
     ctx.card     the shell object (setStatus / setError / …)
     ctx.body     the element to fill
     ctx.entries  the home_widgets entries this card represents
     ctx.entry    entries[0], for the non-aggregate case

   The registry is deliberately tolerant: an unknown type in a
   user's saved home_widgets is skipped, never thrown on. Two
   types (markets, server) have been addable from Settings and
   silently unrendered for a while, so saved configurations in
   the wild already contain entries the renderer must survive.
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var REG   = {};
  var ORDER = [];

  /* ── DOM helpers ─────────────────────────────────────── */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  /* ── registry ────────────────────────────────────────── */
  function register(def) {
    if (!def || !def.type) return;
    if (!REG[def.type]) ORDER.push(def.type);
    REG[def.type] = def;
  }

  function get(type) {
    return (type && REG[type]) ? REG[type] : null;
  }

  function has(type) {
    return !!(type && REG[type]);
  }

  function types() {
    return ORDER.slice();
  }

  /**
   * Group a home_widgets array into the cards that should be rendered,
   * in saved order. Aggregate types collapse into a single card placed
   * at the position of their first entry; unknown types drop out.
   *
   * @param   {Array} widgets  home_widgets, as saved in settings
   * @returns {Array} [{ def, entries }]
   */
  function plan(widgets) {
    var out = [];
    var byType = {};
    if (!widgets || !widgets.length) return out;

    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      if (!w || !w.type) continue;
      var def = get(w.type);
      if (!def) continue;              /* unknown type: skip, never throw */

      if (def.aggregate) {
        if (byType[w.type]) {
          byType[w.type].entries.push(w);
        } else {
          byType[w.type] = { def: def, entries: [w] };
          out.push(byType[w.type]);
        }
      } else {
        out.push({ def: def, entries: [w] });
      }
    }
    return out;
  }

  /* ── shell ───────────────────────────────────────────── */
  /**
   * Build the card chrome every widget shares: header (icon, title,
   * status, optional action) / body / optional footer.
   *
   * @param {Object} opts
   *   opts.title    string
   *   opts.icon     SVG markup string, or null
   *   opts.wide     boolean — claim a double cell
   *   opts.flush    boolean — body carries edge-to-edge content
   *   opts.status   initial right-hand status text
   *   opts.onTap    function — makes the whole card a tap target
   * @returns {Object} shell
   */
  function shell(opts) {
    opts = opts || {};

    var card = el('div', 'w-card' + (opts.wide ? ' w-card--wide' : '') +
                          (opts.onTap ? ' w-card--tap' : '') +
                          (opts.cardClass ? ' ' + opts.cardClass : ''));

    var head = el('div', 'w-head');
    if (opts.icon) {
      var ico = el('span', 'w-head-icon');
      ico.innerHTML = opts.icon;
      head.appendChild(ico);
    }
    head.appendChild(el('span', 'w-title', opts.title || ''));
    head.appendChild(el('span', 'w-head-spacer'));

    var statusEl = el('span', 'w-status', opts.status || '');
    head.appendChild(statusEl);

    var body = el('div', 'w-body' + (opts.flush ? ' w-body--flush' : ''));

    card.appendChild(head);
    card.appendChild(body);

    if (opts.onTap) {
      card.addEventListener('click', function (ev) {
        /* Controls inside the body handle their own taps and stop
           propagation; anything that reaches here is the card itself. */
        if (ev && ev.defaultPrevented) return;
        opts.onTap(ev);
      });
    }

    var api = {
      el:     card,
      head:   head,
      body:   body,

      setStatus: function (text) {
        statusEl.textContent = text == null ? '' : text;
        return api;
      },

      /* Header action button (refresh, all-off, …). Its click never
         reaches the card's own onTap. */
      addAction: function (label, title, onClick) {
        var btn = el('button', 'w-head-btn', label);
        btn.type = 'button';
        if (title) btn.title = title;
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
          onClick(btn);
        });
        head.appendChild(btn);
        return btn;
      },

      /* Loading / empty / error all render at the same place, so the
         card keeps its footprint and the grid does not reflow as
         calls land. */
      setMessage: function (text) {
        clear(body);
        body.appendChild(el('div', 'w-msg', text));
        return api;
      },

      setError: function (msg, onRetry) {
        clear(body);
        var wrap = el('div', 'w-msg');
        wrap.appendChild(el('div', null, msg || 'Unavailable'));
        if (onRetry) {
          var btn = el('button', 'w-msg-retry', 'Retry');
          btn.type = 'button';
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            onRetry();
          });
          wrap.appendChild(btn);
        }
        body.appendChild(wrap);
        return api;
      },

      clearBody: function () {
        clear(body);
        return api;
      }
    };

    return api;
  }

  /* ── shared icons ────────────────────────────────────── */
  /* Stroked to currentColor so .w-head-icon controls them, and sized
     in px to match the tab-bar set they are drawn from. */
  var ICONS = {
    smarthome: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',

    meteo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M5 19a4 4 0 0 1 4-4h6a3 3 0 0 1 0 6H9a4 4 0 0 1-4-4z" stroke="currentColor" stroke-width="1.6"/></svg>',

    jelly: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<rect x="2" y="3" width="20" height="18" rx="3" stroke="currentColor" stroke-width="1.8"/>' +
      '<path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="currentColor"/></svg>',

    markets: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<polyline points="3,17 8,11 13,14 21,6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17 6h4v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',

    server: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<rect x="2" y="3" width="20" height="6" rx="2" stroke="currentColor" stroke-width="1.8"/>' +
      '<rect x="2" y="13" width="20" height="6" rx="2" stroke="currentColor" stroke-width="1.8"/>' +
      '<circle cx="18" cy="6" r="1" fill="currentColor"/><circle cx="18" cy="16" r="1" fill="currentColor"/></svg>'
  };

  /* ── navigation helper ───────────────────────────────── */
  /* Widgets link into their own tab by clicking its tab button, so the
     feature-disable and PIN logic bound to that button still applies. */
  function goToTab(page) {
    var t = document.querySelector('[data-page="' + page + '"]');
    if (t) t.click();
  }

  /* ── Smart Home device tiles ─────────────────────────── */
  /* Builds the .device-card tiles for the pinned entities. Exposed so
     the HOME module can rebuild the grid in place when a poll brings
     entities in after the card has already been rendered. */
  var HA_ICONS = {
    light: '○', switch: '⌁', input_boolean: '⌁',
    media_player: '▷', climate: '◇', fan: '◎', cover: '▭'
  };
  var HA_STATES = {
    on: 'On', off: 'Off', open: 'Open', closed: 'Closed',
    playing: 'Playing', paused: 'Paused', idle: 'Idle',
    unavailable: 'N/A', unknown: '?', standby: 'Standby'
  };

  function domainOf(eid)   { return eid.split('.')[0]; }
  function isOn(e)         { var s = e.state; return s==='on'||s==='open'||s==='playing'||s==='paused'||s==='idle'; }
  function stateLabel(s)   { return HA_STATES[s] || s; }

  /* app.js owns the rich form ("on · 45% · 2700K") and its poll rewrites
     tiles with it, so build them with the same function or the text
     changes format on the first refresh. */
  function stateText(entity) {
    return window._haStateText ? window._haStateText(entity) : stateLabel(entity.state);
  }

  /* app.js also owns the canonical icon map, for the same reason — same
     fallback shape as stateText, needed because this file loads and can
     run before app.js's globals are set. */
  function iconFor(domain) {
    var icons = window._haIcons || HA_ICONS;
    return icons[domain] || '◈';
  }

  /** "3 of 8 on", counting only entities HA actually reported. */
  function haSummaryText(haWidgets, entities) {
    var map = {};
    for (var i = 0; i < entities.length; i++) map[entities[i].entity_id] = entities[i];

    var on = 0, total = 0;
    for (var k = 0; k < haWidgets.length; k++) {
      var e = map[haWidgets[k].id];
      if (!e || e.state === 'unavailable') continue;
      total++;
      if (isOn(e)) on++;
    }
    return total ? (on + ' of ' + total + ' on') : '';
  }

  /* The poll updates tiles in place, so the header count has to be
     refreshed alongside them rather than only at render time. */
  function updateHAStatus(haWidgets, entities) {
    var card = document.querySelector('#home-widgets [data-ha-card]');
    if (!card) return;
    var status = card.querySelector('.w-status');
    if (status) status.textContent = haSummaryText(haWidgets, entities || []);
  }
  function friendlyNameFallback(e) {
    return (e.attributes && e.attributes.friendly_name)
      ? e.attributes.friendly_name
      : e.entity_id.split('.')[1].replace(/_/g, ' ');
  }
  function friendlyName(e) {
    return window._haFriendlyName ? window._haFriendlyName(e) : friendlyNameFallback(e);
  }

  function buildHACards(grid, haWidgets, entities) {
    clear(grid);
    var entityMap = {};
    for (var i = 0; i < entities.length; i++) entityMap[entities[i].entity_id] = entities[i];

    for (var k = 0; k < haWidgets.length; k++) {
      (function (w) {
        var entity = entityMap[w.id];

        /* Pinned but not (yet) reported by HA: keep the slot, so the
           grid does not reflow when the entity comes back. */
        if (!entity) {
          var ghost = el('div', 'device-card unavail');
          ghost.appendChild(el('div', 'card-icon', '◈'));
          var gi = el('div', 'card-info');
          gi.appendChild(el('div', 'card-name', w.label || w.id));
          gi.appendChild(el('div', 'card-state', 'N/A'));
          ghost.appendChild(gi);
          grid.appendChild(ghost);
          return;
        }

        var on      = isOn(entity);
        var unavail = entity.state === 'unavailable';
        var domain  = domainOf(entity.entity_id);

        var card = el('div', 'device-card' + (on ? ' on' : '') + (unavail ? ' unavail' : ''));
        card.setAttribute('data-eid', entity.entity_id);

        var ico  = el('div', 'card-icon', iconFor(domain));
        var info = el('div', 'card-info');
        info.appendChild(el('div', 'card-name', friendlyName(entity)));
        var stateEl = el('div', 'card-state', stateText(entity));
        info.appendChild(stateEl);

        if (domain === 'light' && !unavail) {
          /* Lights split: tap the body to toggle, the chevron to open
             the light sheet. */
          var split = el('div', 'light-card-split');
          var lb = el('button', 'light-main-toggle'); lb.type = 'button';
          var iw = el('div', 'light-main-icon-wrap');
          iw.appendChild(ico);
          lb.appendChild(iw);
          lb.appendChild(info);
          var rb = el('button', 'light-detail-open', '›'); rb.type = 'button';

          lb.addEventListener('click', function (ev) {
            ev.stopPropagation();
            window._guardDeviceAction(entity.entity_id, function () {
              window._xhr('POST', '/api/ha/service', {
                domain: 'light',
                service: on ? 'turn_off' : 'turn_on',
                service_data: { entity_id: entity.entity_id }
              }, function (err) {
                if (err) return;
                on = !on;
                entity.state = on ? 'on' : 'off';
                card.className = 'device-card' + (on ? ' on' : '');
                stateEl.textContent = stateText(entity);
              });
            });
          });

          rb.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (window._openLightSheet) window._openLightSheet(entity);
          });

          split.appendChild(lb);
          split.appendChild(rb);
          card.appendChild(split);
        } else {
          card.appendChild(ico);
          card.appendChild(info);
          if (!unavail) {
            card.addEventListener('click', function (ev) {
              ev.stopPropagation();
              var svc = on ? (domain === 'cover' ? 'close_cover' : 'turn_off')
                           : (domain === 'cover' ? 'open_cover'  : 'turn_on');
              window._guardDeviceAction(entity.entity_id, function () {
                window._xhr('POST', '/api/ha/service', {
                  domain: domain,
                  service: svc,
                  service_data: { entity_id: entity.entity_id }
                }, function (err) {
                  if (err) return;
                  on = !on;
                  entity.state = on ? 'on' : 'off';
                  card.className = 'device-card' + (on ? ' on' : '');
                  stateEl.textContent = stateText(entity);
                });
              });
            });
          }
        }

        grid.appendChild(card);
      })(haWidgets[k]);
    }
  }

  window._WIDGETS = {
    register: register,
    get:      get,
    has:      has,
    types:    types,
    plan:     plan,
    shell:    shell,
    el:       el,
    clear:    clear,
    icons:    ICONS,
    goToTab:  goToTab,

    buildHACards:   buildHACards,
    updateHAStatus: updateHAStatus,
    isOn:           isOn
  };

  /* ══════════════════════════════════════════════════════
     WIDGET DEFINITIONS
     ══════════════════════════════════════════════════════ */

  /* ── Smart Home ──────────────────────────────────────── */
  register({
    type:      'smarthome',
    title:     'Smart Home',
    page:      'smarthome',
    aggregate: true,          /* every pinned entity shares one card */
    wide:      true,
    flush:     true,
    render: function (ctx) {
      /* Markers, not ids: the card only exists while this widget is on
         the Home screen, and the poll has to find it from outside. */
      ctx.card.el.setAttribute('data-ha-card', '1');

      var grid = el('div', 'devices-grid');
      grid.setAttribute('data-ha-grid', '1');
      ctx.body.appendChild(grid);

      var entities = ctx.entities || [];
      buildHACards(grid, ctx.entries, entities);
      ctx.card.setStatus(haSummaryText(ctx.entries, entities));

      ctx.card.addAction('⏻', 'Turn everything off', function () {
        allOff(ctx.entries, entities);
      });

      ctx.card.addAction('↻', 'Refresh devices', function (btn) {
        btn.classList.add('is-busy');
        setTimeout(function () { btn.classList.remove('is-busy'); }, 600);
        if (window._refreshHADevices) window._refreshHADevices({ silent: true });
      });

      /* Nothing cached yet: ask for a snapshot. The poll in app.js
         calls back through window._homeSyncHAEntities. */
      if (!entities.length) {
        if (window._refreshHADevices) window._refreshHADevices({ silent: true });
      }
    }
  });

  /**
   * Turn off every pinned device that is currently on.
   *
   * PIN-locked devices are handled separately and deliberately: rather
   * than firing _guardDeviceAction per entity — which would stack one
   * prompt per locked device — the locked ones are collected and gated
   * behind a single prompt. The PIN is still required; only the number
   * of prompts changes.
   */
  function allOff(haWidgets, entities) {
    var map = {};
    for (var i = 0; i < entities.length; i++) map[entities[i].entity_id] = entities[i];

    var open = [], locked = [];
    for (var k = 0; k < haWidgets.length; k++) {
      var e = map[haWidgets[k].id];
      if (!e || !isOn(e) || e.state === 'unavailable') continue;
      if (window._isDeviceLocked && window._isDeviceLocked(e.entity_id)) locked.push(e);
      else open.push(e);
    }

    if (!open.length && !locked.length) {
      if (window._toast) window._toast('Everything is already off');
      return;
    }

    function turnOff(list) {
      for (var j = 0; j < list.length; j++) {
        (function (entity) {
          var domain = domainOf(entity.entity_id);
          window._xhr('POST', '/api/ha/service', {
            domain:  domain,
            service: domain === 'cover' ? 'close_cover' : 'turn_off',
            service_data: { entity_id: entity.entity_id }
          }, function () {
            if (window._refreshHADevices) window._refreshHADevices({ silent: true });
          });
        })(list[j]);
      }
    }

    turnOff(open);

    if (locked.length) {
      window._openPinPrompt('devices', 'Locked devices',
        'Enter the PIN to turn off ' + locked.length +
        (locked.length === 1 ? ' locked device.' : ' locked devices.'),
        function () { turnOff(locked); });
    }
  }

  /* ── Weather ─────────────────────────────────────────── */
  /* Short forms of the WMO code labels: the widget's condition line has
     one line to work with, where the Weather tab has a full row. */
  function wxLabel(code) {
    if (code === 0) return 'Clear';
    if (code === 1) return 'Mostly clear';
    if (code === 2) return 'Partly cloudy';
    if (code === 3) return 'Cloudy';
    if (code === 45 || code === 48) return 'Fog';
    if (code >= 51 && code <= 57) return 'Drizzle';
    if (code >= 61 && code <= 67) return 'Rain';
    if (code >= 71 && code <= 77) return 'Snow';
    if (code >= 80 && code <= 82) return 'Showers';
    if (code === 85 || code === 86) return 'Snow showers';
    if (code >= 95) return 'Thunderstorm';
    return 'Variable';
  }

  register({
    type:      'meteo',
    title:     'Weather',
    page:      'meteo',
    refreshSec: 900,
    cardClass: 'w-card--wx',
    render: function (ctx) {
      ctx.card.setMessage('Loading…');

      window._xhr('GET', '/api/weather/home-summary', null, function (err, data) {
        if (err || !data || !data.current) {
          ctx.card.setError('Weather unavailable', function () {
            ctx.card.setMessage('Loading…');
            ctx.def.render(ctx);
          });
          return;
        }

        var cur   = data.current;
        var today = data.today    || {};
        var loc   = data.location || {};
        var code  = cur.weatherCode != null ? cur.weatherCode : 0;
        var isDay = cur.isDay      != null ? cur.isDay        : 1;

        ctx.card.setStatus(loc.name || '');
        ctx.card.clearBody();

        /* ── now: icon, temperature, today's range, conditions ── */
        var main = el('div', 'hw-wx-main');

        var iconEl = el('div', 'hw-wx-icon');
        if (window._wxIcon) iconEl.innerHTML = window._wxIcon(code, isDay, 42);
        main.appendChild(iconEl);

        main.appendChild(el('div', 'hw-wx-temp',
          cur.temp != null ? cur.temp + '°' : '--°'));

        var rangeCol = el('div', 'hw-wx-range-col');
        rangeCol.appendChild(el('div', 'hw-wx-range-max',
          today.tempMax != null ? today.tempMax + '°' : '--°'));
        rangeCol.appendChild(el('div', 'hw-wx-range-min',
          today.tempMin != null ? today.tempMin + '°' : '--°'));
        main.appendChild(rangeCol);

        main.appendChild(el('span', 'w-head-spacer'));

        var condCol = el('div', 'hw-wx-cond-col');
        condCol.appendChild(el('div', 'hw-wx-cond', wxLabel(code)));
        var bits = [];
        if (cur.wind     != null) bits.push(cur.wind + ' km/h');
        if (cur.humidity != null) bits.push(cur.humidity + '%');
        if (today.precipProb != null) bits.push(Math.round(today.precipProb) + '% rain');
        condCol.appendChild(el('div', 'hw-wx-cond-sub', bits.join(' · ')));
        main.appendChild(condCol);

        ctx.body.appendChild(main);

        /* ── next hours: label, icon, temp, precipitation bar ── */
        if (data.hourly && data.hourly.length) {
          var strip = el('div', 'hw-wx-hours');
          for (var h = 0; h < data.hourly.length; h++) {
            var hr  = data.hourly[h];
            var col = el('div', 'hw-wx-hour');
            col.appendChild(el('div', 'hw-wx-hour-label',
              (hr.hour < 10 ? '0' : '') + hr.hour));

            var hIcon = el('div', 'hw-wx-hour-icon');
            /* Hour icons follow the sun: anything outside 07-19 is drawn
               in its night form so an evening strip reads correctly. */
            if (window._wxIcon) {
              hIcon.innerHTML = window._wxIcon(hr.code, (hr.hour >= 7 && hr.hour < 20) ? 1 : 0, 18);
            }
            col.appendChild(hIcon);

            col.appendChild(el('div', 'hw-wx-hour-temp',
              hr.temp != null ? hr.temp + '°' : '--'));

            /* The bar is the precipitation probability; a flat baseline
               still shows for 0%, so the row reads as a series. */
            var track = el('div', 'hw-wx-hour-bar');
            var fill  = el('div', 'hw-wx-hour-bar-fill');
            fill.style.height = Math.max(2, hr.precipProb || 0) + '%';
            track.appendChild(fill);
            col.appendChild(track);

            strip.appendChild(col);
          }
          ctx.body.appendChild(strip);
        }

        /* ── outlook: the next three days ── */
        if (data.daily && data.daily.length) {
          var days = el('div', 'hw-wx-days w-optional');
          for (var d = 0; d < data.daily.length; d++) {
            var day = data.daily[d];
            var row = el('div', 'hw-wx-day');
            row.appendChild(el('div', 'hw-wx-day-name', day.weekday));

            var dIcon = el('div', 'hw-wx-day-icon');
            if (window._wxIcon) dIcon.innerHTML = window._wxIcon(day.code, 1, 16);
            row.appendChild(dIcon);

            row.appendChild(el('div', 'hw-wx-day-precip',
              day.precipProb ? day.precipProb + '%' : ''));
            row.appendChild(el('span', 'w-head-spacer'));
            row.appendChild(el('div', 'hw-wx-day-max',
              day.max != null ? day.max + '°' : '--'));
            row.appendChild(el('div', 'hw-wx-day-min',
              day.min != null ? day.min + '°' : '--'));

            days.appendChild(row);
          }
          ctx.body.appendChild(days);
        }
      });
    }
  });

  /* ── Jellyfin ────────────────────────────────────────── */
  var JF_FALLBACK =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none">' +
    '<rect x="2" y="3" width="20" height="18" rx="3" stroke="#3a3a5a" stroke-width="1.6"/>' +
    '<path d="M10 8.5l5 3.5-5 3.5V8.5z" fill="#3a3a5a"/></svg>';

  function jellyPoster(item) {
    var div = el('div', 'hw-jelly-poster');
    var fb  = el('div', 'hw-jelly-poster-fallback');
    fb.innerHTML = JF_FALLBACK;
    div.appendChild(fb);

    if (item && item.id) {
      /* Swap the fallback for the artwork only once it has actually
         decoded, so a slow or missing cover never leaves a blank tile.
         The fallback is an opaque, absolutely-positioned layer, so it
         must be hidden or the artwork stays hidden behind it. */
      var img = new Image();
      img.onload = function () {
        div.style.backgroundImage = 'url(' + img.src + ')';
        fb.style.display = 'none';
      };
      img.src = '/api/jf/image/' + item.id + '?type=Primary&maxH=220';
    }
    if (item) {
      div.appendChild(el('div', 'hw-jelly-poster-title',
        item.name + (item.year ? ' ' + item.year : '')));
    }
    return div;
  }

  register({
    type:  'jelly',
    title: 'Jellyfin',
    page:  'jelly',
    refreshSec: 120,
    flush: true,
    render: function (ctx) {
      ctx.card.setStatus('…');
      ctx.card.clearBody();

      var posters = el('div', 'hw-jelly-posters');
      ctx.body.appendChild(posters);
      for (var s = 0; s < 3; s++) posters.appendChild(jellyPoster(null));

      window._xhr('GET', '/api/jf/home-summary', null, function (err, data) {
        if (err || !data) {
          ctx.card.setStatus('N/A');
          return;
        }
        clear(posters);
        var recent = Array.isArray(data.recentMovies) ? data.recentMovies : [];
        for (var i = 0; i < 3; i++) posters.appendChild(jellyPoster(recent[i] || null));

        ctx.card.setStatus((data.totalMovies || 0) + ' films · ' +
                           (data.totalSeries || 0) + ' series');

        /* Counts line: episodes only appear when the server reported them
           (the lookup is optional server-side and can come back null). */
        var counts = [];
        if (data.totalMovies   != null) counts.push(data.totalMovies + ' films');
        if (data.totalSeries   != null) counts.push(data.totalSeries + ' series');
        if (data.totalEpisodes != null) counts.push(fmtCount(data.totalEpisodes) + ' episodes');

        var foot = el('div', 'hw-jelly-foot');
        foot.appendChild(el('div', 'hw-jelly-counts', counts.join(' · ')));

        /* Nothing streaming is the normal case — show the newest addition
           instead of an empty row, so the line always earns its space. */
        if (data.nowPlaying) {
          var np = data.nowPlaying;
          var label = np.series ? np.series + ' — ' + np.name : np.name;
          var playing = el('div', 'hw-jelly-now');
          playing.appendChild(el('span', 'w-dot ok'));
          playing.appendChild(el('span', 'hw-jelly-now-text',
            label + (np.device ? ' · ' + np.device : '')));
          foot.appendChild(playing);
        } else if (recent[0]) {
          foot.appendChild(el('div', 'hw-jelly-now-text hw-jelly-latest',
            'Latest: ' + recent[0].name));
        }

        ctx.body.appendChild(foot);
      });
    }
  });

  /* ── Proxmox ─────────────────────────────────────────── */
  function fmtCount(n) {
    if (n == null) return '—';
    if (n >= 1000) return (Math.round(n / 100) / 10) + 'k';
    return String(n);
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    var u = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < u.length - 1) { n = n / 1024; i++; }
    return (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) + ' ' + u[i];
  }

  function fmtUptime(sec) {
    if (sec == null) return '';
    var d = Math.floor(sec / 86400);
    if (d >= 1) return 'up ' + d + 'd';
    var h = Math.floor(sec / 3600);
    if (h >= 1) return 'up ' + h + 'h';
    return 'up ' + Math.max(1, Math.floor(sec / 60)) + 'm';
  }

  /**
   * One labelled usage bar. `pct` is 0..100; the bar changes colour at
   * the thresholds a home server actually starts to hurt at, so the row
   * reads as a condition and not just a number.
   */
  function metricRow(label, pct, valueText) {
    var row = el('div', 'w-metric');
    row.appendChild(el('div', 'w-metric-label', label));

    var bar  = el('div', 'w-bar');
    var fill = el('div', 'w-bar-fill' + (pct >= 90 ? ' crit' : pct >= 75 ? ' warn' : ''));
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);

    row.appendChild(el('div', 'w-metric-value', valueText));
    return row;
  }

  function pct(used, total) {
    if (used == null || !total) return 0;
    return (used / total) * 100;
  }

  register({
    type:  'server',
    title: 'Proxmox',
    page:  'server',
    refreshSec: 60,
    /* A single node fits a normal cell; a cluster needs the width. */
    wide: function () { return false; },
    render: function (ctx) {
      ctx.card.setMessage('Loading…');

      window._xhr('GET', '/api/px/home-summary', null, function (err, data) {
        if (err || !data || !data.nodes) {
          ctx.card.setStatus('');
          ctx.card.setError('Proxmox unavailable', function () { ctx.def.render(ctx); });
          return;
        }

        var t = data.totals || {};
        ctx.card.setStatus(t.vmsRunning + ' running · ' + t.vmsStopped + ' stopped');
        ctx.card.clearBody();

        if (!data.nodes.length) {
          ctx.card.setMessage('No nodes');
          return;
        }

        var rows = el('div', 'w-rows');

        for (var i = 0; i < data.nodes.length; i++) {
          var n = data.nodes[i];
          var block = el('div', 'px-w-node');

          var head = el('div', 'px-w-node-head');
          head.appendChild(el('span', 'w-dot ' + (n.status === 'online' ? 'ok' : 'err')));
          head.appendChild(el('span', 'px-w-node-name', n.node));
          head.appendChild(el('span', 'w-head-spacer'));
          head.appendChild(el('span', 'px-w-node-up', fmtUptime(n.uptime)));
          block.appendChild(head);

          var cpuPct = (n.cpu != null ? n.cpu * 100 : 0);
          block.appendChild(metricRow('CPU', cpuPct, Math.round(cpuPct) + '%'));
          block.appendChild(metricRow('RAM', pct(n.mem, n.maxmem), fmtBytes(n.mem)));
          block.appendChild(metricRow('DISK', pct(n.disk, n.maxdisk), fmtBytes(n.disk)));

          rows.appendChild(block);
        }

        ctx.body.appendChild(rows);
      });
    }
  });

  /* ── Markets ─────────────────────────────────────────── */
  function fmtPrice(v) {
    if (v == null || isNaN(v)) return '—';
    return (Math.round(v * 100) / 100).toFixed(2);
  }

  function changeClass(v) {
    if (v > 0) return 'up';
    if (v < 0) return 'down';
    return 'flat';
  }

  function fmtChangePct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + (Math.round(v * 100) / 100).toFixed(2) + '%';
  }

  register({
    type:      'markets',
    title:     'Markets',
    page:      'markets',
    refreshSec: 300,
    aggregate: true,   /* every pinned symbol shares one card */
    /* Past four symbols the rows want the extra width more than a second
       card would. */
    wide: function (entries) { return entries.length > 4; },
    render: function (ctx) {
      ctx.card.setMessage('Loading…');

      /* The favourites endpoint already prices every symbol in one Yahoo
         call, so the widget filters that rather than asking per symbol. */
      window._xhr('GET', '/api/markets/favorites', null, function (err, data) {
        if (err || !data || !Array.isArray(data.items)) {
          ctx.card.setError('Markets unavailable', function () { ctx.def.render(ctx); });
          return;
        }

        var wanted = {};
        for (var w = 0; w < ctx.entries.length; w++) {
          wanted[String(ctx.entries[w].id).toUpperCase()] = true;
        }

        var items = [];
        for (var i = 0; i < data.items.length; i++) {
          if (wanted[String(data.items[i].symbol).toUpperCase()]) items.push(data.items[i]);
        }

        ctx.card.clearBody();

        if (!items.length) {
          /* Pinned symbols that are no longer favourites: say so, rather
             than showing an empty card that looks broken. */
          ctx.card.setStatus('');
          ctx.card.setMessage('No pinned symbols');
          return;
        }

        var up = 0;
        for (var u = 0; u < items.length; u++) if (items[u].change > 0) up++;
        ctx.card.setStatus(up + ' of ' + items.length + ' up');

        var rows = el('div', 'w-rows');
        for (var k = 0; k < items.length; k++) {
          (function (it) {
            var row  = el('div', 'w-row');
            var main = el('div', 'w-row-main');
            main.appendChild(el('div', 'w-row-name', it.symbol));
            if (it.name) main.appendChild(el('div', 'w-row-sub', it.name));
            row.appendChild(main);

            var side = el('div', 'w-row-side');
            side.appendChild(el('div', 'w-row-value', fmtPrice(it.price)));
            side.appendChild(el('span', 'w-pill ' + changeClass(it.change),
              fmtChangePct(it.changePercent)));
            row.appendChild(side);

            rows.appendChild(row);
          })(items[k]);
        }
        ctx.body.appendChild(rows);
      });
    }
  });

})();
