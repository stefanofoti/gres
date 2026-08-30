'use strict';

var express = require('express');
var request = require('supertest');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

var AUTH_ROUTE = path.join(__dirname, '../../backend/routes/auth');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  /* fresh require so the in-memory `attempts` rate-limit map starts empty */
  app.use('/api/auth', wd.requireFresh(AUTH_ROUTE));
  return app;
}

var ORIGINAL_ENV;

describe('GET/POST /api/auth', function () {
  beforeEach(function () {
    wd.useTempWorkdir();
    ORIGINAL_ENV = Object.assign({}, process.env);
    delete process.env.SETTINGS_PIN;
    delete process.env.DEVICES_PIN;
  });

  afterEach(function () {
    process.env = ORIGINAL_ENV;
    wd.restoreWorkdir();
  });

  test('pin-status reports not required when the scope env var is unset', function () {
    var app = buildApp();
    return request(app).get('/api/auth/pin-status?scope=settings').expect(200).then(function (res) {
      expect(res.body).toEqual({ required: false, length: 0 });
    });
  });

  test('pin-status reports required + digit length when configured', function () {
    process.env.SETTINGS_PIN = '1234';
    var app = buildApp();
    return request(app).get('/api/auth/pin-status?scope=settings').expect(200).then(function (res) {
      expect(res.body).toEqual({ required: true, length: 4 });
    });
  });

  test('unknown scope falls back to "settings"', function () {
    process.env.SETTINGS_PIN = '77';
    var app = buildApp();
    return request(app).get('/api/auth/pin-status?scope=bogus').expect(200).then(function (res) {
      expect(res.body).toEqual({ required: true, length: 2 });
    });
  });

  test('settings and devices scopes are configured independently', function () {
    process.env.SETTINGS_PIN = '1234';
    process.env.DEVICES_PIN = '99';
    var app = buildApp();
    return request(app).get('/api/auth/pin-status?scope=devices').expect(200).then(function (res) {
      expect(res.body).toEqual({ required: true, length: 2 });
    });
  });

  test('verify-pin always ok when no PIN is configured for the scope', function () {
    var app = buildApp();
    return request(app)
      .post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: 'anything' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ ok: true });
      });
  });

  test('verify-pin returns ok:true for the correct PIN', function () {
    process.env.SETTINGS_PIN = '4321';
    var app = buildApp();
    return request(app)
      .post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: '4321' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ ok: true });
      });
  });

  test('verify-pin returns ok:false for an incorrect PIN', function () {
    process.env.SETTINGS_PIN = '4321';
    var app = buildApp();
    return request(app)
      .post('/api/auth/verify-pin')
      .send({ scope: 'settings', pin: '0000' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ ok: false });
      });
  });

  test('verify-pin locks out after 5 failed attempts for the same scope', function () {
    process.env.SETTINGS_PIN = '4321';
    var app = buildApp();
    var agent = request(app);

    function attempt() {
      return agent.post('/api/auth/verify-pin').send({ scope: 'settings', pin: '0000' });
    }

    return attempt()
      .then(attempt).then(attempt).then(attempt).then(attempt) // 5 failures
      .then(function (res) {
        expect(res.body).toEqual({ ok: false });
        return attempt(); // 6th attempt should be locked out
      })
      .then(function (res) {
        expect(res.status).toBe(429);
        expect(res.body.ok).toBe(false);
      });
  });

  test('lockout on one scope does not block a different scope for the same client', function () {
    process.env.SETTINGS_PIN = '4321';
    process.env.DEVICES_PIN = '1111';
    var app = buildApp();
    var agent = request(app);

    function failSettings() {
      return agent.post('/api/auth/verify-pin').send({ scope: 'settings', pin: '0000' });
    }

    return failSettings()
      .then(failSettings).then(failSettings).then(failSettings).then(failSettings)
      .then(function () {
        return agent.post('/api/auth/verify-pin').send({ scope: 'devices', pin: '1111' });
      })
      .then(function (res) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
      });
  });

  test('a correct PIN clears prior failure count', function () {
    process.env.SETTINGS_PIN = '4321';
    var app = buildApp();
    var agent = request(app);

    function attempt(pin) {
      return agent.post('/api/auth/verify-pin').send({ scope: 'settings', pin: pin });
    }

    return attempt('0000')
      .then(function () { return attempt('0000'); })
      .then(function () { return attempt('4321'); }) // success resets count
      .then(function (res) {
        expect(res.body).toEqual({ ok: true });
        return attempt('0000');
      })
      .then(function () { return attempt('0000'); })
      .then(function (res) {
        /* only 2 failures since the reset, well under MAX_ATTEMPTS(5) */
        expect(res.status).toBe(200);
      });
  });
});
