'use strict';

/*
 * The settings store, which since 0.0.9 exposes three different views of one
 * file: a public read for UI state, a scoped read for configuration, and no
 * read at all for credentials. See backend/routes/settings.js for why.
 *
 * The trust-boundary assertions (nothing leaks, every mutation is gated) live
 * in boundary.test.js; this file covers the store's own read/merge/delete
 * semantics.
 */

var express = require('express');
var request = require('supertest');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

var SETTINGS_ROUTE = path.join(__dirname, '../../backend/routes/settings');
var AUTH_ROUTE     = path.join(__dirname, '../../backend/routes/auth');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/settings', wd.requireFresh(SETTINGS_ROUTE));
  app.use('/api/auth', wd.requireFresh(AUTH_ROUTE));
  return app;
}

var ORIGINAL_ENV;

describe('GET/POST/DELETE /api/settings', function () {
  beforeEach(function () {
    wd.useTempWorkdir();
    ORIGINAL_ENV = Object.assign({}, process.env);
    delete process.env.SETTINGS_PIN;
    process.env.SESSION_SECRET = 'test-secret-not-a-real-key';
  });

  afterEach(function () {
    process.env = ORIGINAL_ENV;
    wd.restoreWorkdir();
  });

  test('GET / on first run creates the data file and returns {}', function () {
    var app = buildApp();
    return request(app).get('/api/settings').expect(200).then(function (res) {
      expect(res.body).toEqual({});
    });
  });

  test('POST / merges new keys into the store', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ features_disabled: ['markets'] })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({
          success: true,
          settings: { features_disabled: ['markets'] }
        });
        return request(app).get('/api/settings').expect(200);
      })
      .then(function (res) {
        expect(res.body).toEqual({ features_disabled: ['markets'] });
      });
  });

  test('POST / overwrites existing keys but preserves untouched ones', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ features_disabled: ['markets'], home_widgets: [{ type: 'meteo', id: 'weather' }] })
      .expect(200)
      .then(function () {
        return request(app).post('/api/settings').send({ features_disabled: [] }).expect(200);
      })
      .then(function (res) {
        expect(res.body.settings.features_disabled).toEqual([]);
        expect(res.body.settings.home_widgets).toEqual([{ type: 'meteo', id: 'weather' }]);
      });
  });

  test('POST / persists non-public keys even though it does not echo them', function () {
    /* The credential round-trip: written through the public POST, never
       returned by it, and reported as configured by the admin read. */
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ ha_url: 'http://192.168.1.100:8123', ha_token: 'secret-value' })
      .expect(200)
      .then(function (res) {
        expect(res.body.settings).not.toHaveProperty('ha_token');
        return request(app).get('/api/settings/admin').expect(200);
      })
      .then(function (res) {
        expect(res.body.ha_url).toBe('http://192.168.1.100:8123');
        expect(res.body.ha_token_set).toBe(true);
        expect(res.body).not.toHaveProperty('ha_token');
      });
  });

  test('POST / silently drops keys outside the known schema', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ features_disabled: ['markets'], not_a_real_key: 'nope' })
      .expect(200)
      .then(function (res) {
        expect(res.body.settings).not.toHaveProperty('not_a_real_key');
        return request(app).get('/api/settings/admin').expect(200);
      })
      .then(function (res) {
        expect(res.body).not.toHaveProperty('not_a_real_key');
      });
  });

  test('POST / ignores a __proto__ key rather than merging it in', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send(JSON.parse('{"features_disabled":["markets"],"__proto__":{"polluted":true}}'))
      .expect(200)
      .then(function () {
        /* Neither the response object nor a fresh plain object should have
           picked up the polluted key from Object.prototype. */
        expect({}).not.toHaveProperty('polluted');
        return request(app).get('/api/settings').expect(200);
      })
      .then(function (res) {
        expect(res.body).not.toHaveProperty('polluted');
      });
  });

  test('the admin read reports an unset credential as false', function () {
    var app = buildApp();
    return request(app).get('/api/settings/admin').expect(200).then(function (res) {
      expect(res.body.ha_token_set).toBe(false);
      expect(res.body.jf_token_set).toBe(false);
      expect(res.body.px_token_set).toBe(false);
    });
  });

  test('GET /:key returns the value for an existing public key', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ weather_default_location: { name: 'Milano', latitude: 45.46, longitude: 9.19 } })
      .expect(200)
      .then(function () {
        return request(app).get('/api/settings/weather_default_location').expect(200);
      })
      .then(function (res) {
        expect(res.body.key).toBe('weather_default_location');
        expect(res.body.value.name).toBe('Milano');
      });
  });

  test('GET /:key returns 404 for a missing key', function () {
    var app = buildApp();
    return request(app).get('/api/settings/nope').expect(404).then(function (res) {
      expect(res.body).toEqual({ error: 'Key not found' });
    });
  });

  test('GET /:key reports a stored non-public key as missing', function () {
    /* Reported as 404 rather than 401 on purpose: "exists but denied" would
       confirm to an unauthenticated caller which credentials are configured. */
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ ha_url: 'http://192.168.1.100:8123' })
      .expect(200)
      .then(function () {
        return request(app).get('/api/settings/ha_url').expect(404);
      });
  });

  test('DELETE /:key removes the key and subsequent GET 404s', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ home_widgets: [{ type: 'meteo', id: 'weather' }] })
      .expect(200)
      .then(function () {
        return request(app).delete('/api/settings/home_widgets').expect(200);
      })
      .then(function (res) {
        expect(res.body).toEqual({ success: true });
        return request(app).get('/api/settings/home_widgets').expect(404);
      });
  });

  test('DELETE /:key on a non-existent key is a no-op success', function () {
    var app = buildApp();
    return request(app).delete('/api/settings/never-existed').expect(200).then(function (res) {
      expect(res.body).toEqual({ success: true });
    });
  });

  describe('with SETTINGS_PIN configured', function () {
    beforeEach(function () { process.env.SETTINGS_PIN = '1234'; });

    test('the public read stays open — the UI cannot paint without it', function () {
      var app = buildApp();
      return request(app).get('/api/settings').expect(200);
    });

    test('writing requires the settings scope', function () {
      var app = buildApp();
      return request(app)
        .post('/api/settings')
        .send({ features_disabled: ['markets'] })
        .expect(401);
    });

    test('deleting requires the settings scope', function () {
      var app = buildApp();
      return request(app).delete('/api/settings/home_widgets').expect(401);
    });

    test('a verified PIN unlocks writing for subsequent requests', function () {
      var app = buildApp();
      return request(app).post('/api/auth/verify-pin')
        .send({ scope: 'settings', pin: '1234' })
        .expect(200)
        .then(function (res) {
          return request(app).post('/api/settings')
            .set('Cookie', res.headers['set-cookie'])
            .send({ features_disabled: ['markets'] })
            .expect(200);
        })
        .then(function (res) {
          expect(res.body.settings.features_disabled).toEqual(['markets']);
        });
    });
  });
});
