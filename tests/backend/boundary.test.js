'use strict';

/*
 * The API's trust boundary, asserted as two enumerations rather than two
 * checklists.
 *
 * Before 0.0.9 the PIN gates were drawn entirely in the frontend: the API had
 * no notion of an authenticated caller, GET /api/settings returned every
 * integration credential in plaintext, and a direct POST toggled a
 * "protected" device with no PIN at all.
 *
 * These tests are written so that they keep working as routes are added:
 *
 *   1. Walk the mounted router stacks and require every state-changing route
 *      to be scope-gated, or to appear in the allowlist below with a reason.
 *      A new unguarded POST fails the build rather than the review.
 *
 *   2. Seed the store with sentinel credentials and sweep the GET routes,
 *      asserting no sentinel appears in any response body — whatever the
 *      status code. This is the test that would have caught the original leak
 *      on the day it was written.
 */

var express = require('express');
var request = require('supertest');
var fs      = require('fs');
var path    = require('path');
var wd      = require('../helpers/tempWorkdir');

var ROUTES = path.join(__dirname, '../../backend/routes');

/**
 * Mutating routes that legitimately carry no scopeGate. Every entry needs a
 * reason and its own behavioural test below — this list is the exception
 * register, not a way to opt out.
 */
var UNGATED_ALLOWLIST = {
  'POST /verify-pin':
    'the auth endpoint itself; gating it would be circular',
  'POST /service':
    'self-guarding — requires the devices scope only when the call names a ' +
    'protected entity (see backend/routes/homeassistant.js)',
  'POST /favorites/toggle':
    'a watchlist of ticker symbols: not a credential and not a device command'
};

/** Every router mounted under /api in backend/server.js. */
var MOUNTS = [
  { prefix: '/api/ha',       file: 'homeassistant' },
  { prefix: '/api/jf',       file: 'jellyfin' },
  { prefix: '/api/px',       file: 'proxmox' },
  { prefix: '/api/weather',  file: 'weather' },
  { prefix: '/api/markets',  file: 'markets' },
  { prefix: '/api/settings', file: 'settings' },
  { prefix: '/api/config',   file: 'config' },
  { prefix: '/api/auth',     file: 'auth' }
];

/**
 * The actual secrets. These must never appear in any response body, at any
 * status code, with or without a session.
 */
var SENTINELS = {
  ha_token: 'SENTINEL-ha-token-2f8a41c9',
  jf_token: 'SENTINEL-jf-token-77b0e3d5',
  px_token: 'SENTINEL-px-token-1c4d90ab'
};

/**
 * Configuration, not credentials: px_tokenid is the token's *identity*
 * ("root@pam!name"), the half of PVEAPIToken=<id>=<secret> that authenticates
 * nothing on its own, and the Settings form has to display it. It is served
 * by the scoped admin read alongside the service URLs, and withheld from the
 * public one — asserted below rather than swept.
 */
var ADMIN_VALUES = {
  px_tokenid: 'root@pam!SENTINEL-tokenid'
};

/**
 * Collect { method, path, gated } for every route on a router.
 *
 * @param {Object} router — an express Router
 * @returns {Array<{method: string, path: string, gated: boolean}>}
 */
function routesOf(router) {
  var out = [];
  var stack = (router && router.stack) || [];

  for (var i = 0; i < stack.length; i++) {
    var layer = stack[i];
    if (!layer.route) continue;

    var handlers = layer.route.stack || [];
    var gated = false;
    for (var h = 0; h < handlers.length; h++) {
      if (handlers[h].name === 'scopeGate') { gated = true; break; }
    }

    var methods = Object.keys(layer.route.methods || {});
    for (var m = 0; m < methods.length; m++) {
      out.push({
        method: methods[m].toUpperCase(),
        path:   layer.route.path,
        gated:  gated
      });
    }
  }
  return out;
}

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  for (var i = 0; i < MOUNTS.length; i++) {
    app.use(MOUNTS[i].prefix, wd.requireFresh(path.join(ROUTES, MOUNTS[i].file)));
  }
  return app;
}

function seedSettings(extra) {
  var data = Object.assign({
    ha_url:     'http://sentinel-ha.invalid:8123',
    jf_url:     'http://sentinel-jf.invalid:8096',
    px_url:     'https://sentinel-px.invalid:8006',
    home_widgets: [{ type: 'meteo', id: 'weather', label: 'Weather widget' }],
    features_disabled: ['markets']
  }, SENTINELS, ADMIN_VALUES, extra || {});

  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'data/settings.json'),
    JSON.stringify(data, null, 2));
  return data;
}

var ORIGINAL_ENV;

beforeEach(function () {
  wd.useTempWorkdir();
  ORIGINAL_ENV = Object.assign({}, process.env);
  delete process.env.SETTINGS_PIN;
  delete process.env.DEVICES_PIN;
  delete process.env.SERVER_PIN;
  process.env.SESSION_SECRET = 'test-secret-not-a-real-key';
});

afterEach(function () {
  process.env = ORIGINAL_ENV;
  wd.restoreWorkdir();
});

/* ── 1. Every mutation is gated ─────────────────────────── */

describe('every state-changing API route is scope-gated', function () {
  test('no unguarded mutation outside the documented allowlist', function () {
    var offenders = [];

    for (var i = 0; i < MOUNTS.length; i++) {
      var mount  = MOUNTS[i];
      var router = wd.requireFresh(path.join(ROUTES, mount.file));
      var routes = routesOf(router);

      for (var r = 0; r < routes.length; r++) {
        var route = routes[r];
        if (route.method === 'GET' || route.method === 'HEAD') continue;
        if (route.gated) continue;

        var key = route.method + ' ' + route.path;
        if (Object.prototype.hasOwnProperty.call(UNGATED_ALLOWLIST, key)) continue;

        offenders.push(mount.prefix + ' -> ' + key);
      }
    }

    /* If this fails, either add session.requireScope(...) to the new route or
       add it to UNGATED_ALLOWLIST with a reason and a behavioural test. */
    expect(offenders).toEqual([]);
  });

  test('the enumeration actually sees the routes it claims to check', function () {
    /* Guards the guard: a refactor that broke routesOf() would otherwise make
       the test above pass vacuously. */
    var settings = routesOf(wd.requireFresh(path.join(ROUTES, 'settings')));
    var mutations = settings.filter(function (r) { return r.method !== 'GET'; });

    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.every(function (r) { return r.gated; })).toBe(true);
  });
});

/* ── 2. Credentials never leave the server ──────────────── */

describe('no route returns a stored credential', function () {
  var READ_PATHS = [
    '/api/settings',
    '/api/settings/home_widgets',
    '/api/settings/ha_token',
    '/api/settings/ha_url',
    '/api/settings/px_tokenid',
    '/api/settings/admin',
    '/api/config',
    '/api/auth/pin-status?scope=settings'
  ];

  test('sweeping the read surface finds no sentinel value', function () {
    seedSettings();
    var app = buildApp();

    return READ_PATHS.reduce(function (chain, p) {
      return chain.then(function () {
        return request(app).get(p).then(function (res) {
          var body = typeof res.text === 'string' ? res.text : JSON.stringify(res.body);
          Object.keys(SENTINELS).forEach(function (key) {
            if (body.indexOf(SENTINELS[key]) !== -1) {
              throw new Error(p + ' leaked ' + key + ' (status ' + res.status + ')');
            }
          });
        });
      });
    }, Promise.resolve());
  });

  test('GET /api/settings returns only the public allowlist', function () {
    seedSettings();
    return request(buildApp()).get('/api/settings').expect(200).then(function (res) {
      expect(Object.keys(res.body).sort()).toEqual(['features_disabled', 'home_widgets']);
    });
  });

  test('GET /api/settings/:key refuses a non-public key even when it exists', function () {
    seedSettings();
    return request(buildApp()).get('/api/settings/ha_token').expect(404);
  });

  test('the public read withholds admin configuration too, not only secrets', function () {
    seedSettings();
    return request(buildApp()).get('/api/settings').expect(200).then(function (res) {
      var body = JSON.stringify(res.body);
      expect(body).not.toContain(ADMIN_VALUES.px_tokenid);
      expect(body).not.toContain('sentinel-px.invalid');
    });
  });

  test('the admin read does serve configuration, so the sweep is not vacuous', function () {
    seedSettings();
    return request(buildApp()).get('/api/settings/admin').expect(200).then(function (res) {
      expect(res.body.px_tokenid).toBe(ADMIN_VALUES.px_tokenid);
    });
  });

  test('the admin read reports credentials as set without returning them', function () {
    process.env.SETTINGS_PIN = '1234';
    seedSettings();
    var app = buildApp();

    return request(app).post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: '1234' })
      .expect(200)
      .then(function (res) {
        var cookie = res.headers['set-cookie'];
        expect(cookie).toBeDefined();
        return request(app).get('/api/settings/admin').set('Cookie', cookie).expect(200);
      })
      .then(function (res) {
        expect(res.body.ha_token_set).toBe(true);
        expect(res.body.jf_token_set).toBe(true);
        expect(res.body.px_token_set).toBe(true);
        expect(res.body.ha_url).toBe('http://sentinel-ha.invalid:8123');
        expect(res.body).not.toHaveProperty('ha_token');
        expect(res.body).not.toHaveProperty('jf_token');
        expect(res.body).not.toHaveProperty('px_token');
      });
  });

  test('the admin read is refused without the settings scope', function () {
    process.env.SETTINGS_PIN = '1234';
    seedSettings();
    return request(buildApp()).get('/api/settings/admin').expect(401);
  });
});

/* ── 3. The self-guarding routes ────────────────────────── */

describe('POST /api/ha/service enforces device protection', function () {
  function appWithProtected(ids) {
    seedSettings({ ha_protected_entities: ids });
    return buildApp();
  }

  test('a protected entity is refused without the devices scope', function () {
    process.env.DEVICES_PIN = '4321';
    var app = appWithProtected(['light.bedroom']);
    return request(app).post('/api/ha/service')
      .send({ domain: 'light', service: 'turn_on', service_data: { entity_id: 'light.bedroom' } })
      .expect(401)
      .then(function (res) {
        expect(res.body.scope).toBe('devices');
      });
  });

  test('an unprotected entity passes the gate', function () {
    process.env.DEVICES_PIN = '4321';
    var app = appWithProtected(['light.bedroom']);
    /* Reaches the upstream call and fails there (the host is unroutable),
       which is what proves it got past the scope check. */
    return request(app).post('/api/ha/service')
      .send({ domain: 'light', service: 'turn_on', service_data: { entity_id: 'light.hall' } })
      .then(function (res) {
        expect(res.status).not.toBe(401);
      });
  });

  test('protection is enforced for every entity_id shape', function () {
    process.env.DEVICES_PIN = '4321';
    var app = appWithProtected(['light.bedroom']);

    var shapes = [
      { entity_id: 'light.bedroom' },
      { entity_id: ['light.hall', 'light.bedroom'] },
      { target: { entity_id: 'light.bedroom' } },
      { target: { entity_id: ['light.bedroom'] } }
    ];

    return shapes.reduce(function (chain, serviceData) {
      return chain.then(function () {
        return request(app).post('/api/ha/service')
          .send({ domain: 'light', service: 'turn_on', service_data: serviceData })
          .expect(401);
      });
    }, Promise.resolve());
  });

  test('a call naming no entity fails closed while anything is protected', function () {
    process.env.DEVICES_PIN = '4321';
    var app = appWithProtected(['light.bedroom']);
    /* Home Assistant can target by area or device. gres always sends an
       entity id, so refusing costs nothing and closes the bypass. */
    return request(app).post('/api/ha/service')
      .send({ domain: 'light', service: 'turn_on', service_data: { area_id: 'bedroom' } })
      .expect(401);
  });

  test('with no PIN configured the gate is inert', function () {
    var app = appWithProtected(['light.bedroom']);
    return request(app).post('/api/ha/service')
      .send({ domain: 'light', service: 'turn_on', service_data: { entity_id: 'light.bedroom' } })
      .then(function (res) {
        expect(res.status).not.toBe(401);
      });
  });

  test('the devices scope does not unlock the settings scope', function () {
    process.env.SETTINGS_PIN = '1111';
    process.env.DEVICES_PIN  = '2222';
    seedSettings();
    var app = buildApp();

    return request(app).post('/api/auth/verify-pin')
      .send({ scope: 'devices', pin: '2222' })
      .expect(200)
      .then(function (res) {
        return request(app).get('/api/settings/admin')
          .set('Cookie', res.headers['set-cookie'])
          .expect(401);
      });
  });
});

/* ── 4. Proxmox power operations ────────────────────────── */

describe('Proxmox power operations require the server scope', function () {
  test('node power is refused without the scope', function () {
    process.env.SERVER_PIN = '9999';
    seedSettings();
    return request(buildApp())
      .post('/api/px/nodes/pve/power')
      .send({ command: 'shutdown' })
      .expect(401);
  });

  test('VM lifecycle actions are refused without the scope', function () {
    process.env.SERVER_PIN = '9999';
    seedSettings();
    return request(buildApp())
      .post('/api/px/nodes/pve/qemu/100/action')
      .send({ action: 'stop' })
      .expect(401);
  });

  test('read-only Proxmox routes stay open so the tab still renders', function () {
    process.env.SERVER_PIN = '9999';
    seedSettings();
    return request(buildApp()).get('/api/px/nodes').then(function (res) {
      expect(res.status).not.toBe(401);
    });
  });

  test('the server PIN unlocks power operations', function () {
    process.env.SERVER_PIN = '9999';
    seedSettings();
    var app = buildApp();

    return request(app).post('/api/auth/verify-pin')
      .send({ scope: 'server', pin: '9999' })
      .expect(200)
      .then(function (res) {
        return request(app).post('/api/px/nodes/pve/power')
          .set('Cookie', res.headers['set-cookie'])
          .send({ command: 'shutdown' });
      })
      .then(function (res) {
        expect(res.status).not.toBe(401);
      });
  });
});

/* ── 5. The session cookie itself ───────────────────────── */

describe('session cookies', function () {
  var session = require('../../backend/middleware/session');

  test('the cookie is HttpOnly, SameSite=Lax and not Secure', function () {
    process.env.SETTINGS_PIN = '1234';
    seedSettings();
    return request(buildApp()).post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: '1234' })
      .then(function (res) {
        var cookie = String(res.headers['set-cookie']);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/SameSite=Lax/i);
        /* gres is normally served over plain HTTP on a LAN; Secure would stop
           the cookie being stored at all. */
        expect(cookie).not.toMatch(/Secure/i);
      });
  });

  test('a forged signature is rejected', function () {
    var good = session.sign({ scopes: ['settings'], exp: Date.now() + 60000 });
    var body = good.split('.')[0];
    expect(session.verify(body + '.' + 'not-the-real-signature')).toBeNull();
  });

  test('a tampered payload is rejected', function () {
    var token = session.sign({ scopes: ['devices'], exp: Date.now() + 60000 });
    var forged = Buffer.from(JSON.stringify({ scopes: ['settings'], exp: Date.now() + 60000 }))
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(session.verify(forged + '.' + token.split('.')[1])).toBeNull();
  });

  test('an expired token is rejected', function () {
    expect(session.verify(session.sign({ scopes: ['settings'], exp: Date.now() - 1 }))).toBeNull();
  });

  test('a valid token round-trips its scopes', function () {
    var payload = session.verify(session.sign({ scopes: ['settings', 'devices'], exp: Date.now() + 60000 }));
    expect(payload.scopes).toEqual(['settings', 'devices']);
  });

  test('verifying a PIN preserves scopes already held', function () {
    process.env.SETTINGS_PIN = '1111';
    process.env.DEVICES_PIN  = '2222';
    seedSettings();
    var app = buildApp();

    return request(app).post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: '1111' })
      .then(function (res) {
        return request(app).post('/api/auth/verify-pin')
          .set('Cookie', res.headers['set-cookie'])
          .send({ scope: 'devices', pin: '2222' });
      })
      .then(function (res) {
        var token = String(res.headers['set-cookie']).split('gres_sess=')[1].split(';')[0];
        var payload = session.verify(decodeURIComponent(token));
        expect(payload.scopes.sort()).toEqual(['devices', 'settings']);
      });
  });
});
