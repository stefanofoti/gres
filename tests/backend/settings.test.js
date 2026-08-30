'use strict';

var express = require('express');
var request = require('supertest');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

var SETTINGS_ROUTE = path.join(__dirname, '../../backend/routes/settings');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/settings', wd.requireFresh(SETTINGS_ROUTE));
  return app;
}

describe('GET/POST/DELETE /api/settings', function () {
  beforeEach(function () { wd.useTempWorkdir(); });
  afterEach(function () { wd.restoreWorkdir(); });

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
      .send({ foo: 'bar' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ success: true, settings: { foo: 'bar' } });
        return request(app).get('/api/settings').expect(200);
      })
      .then(function (res) {
        expect(res.body).toEqual({ foo: 'bar' });
      });
  });

  test('POST / overwrites existing keys but preserves untouched ones', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ a: 1, b: 2 })
      .expect(200)
      .then(function () {
        return request(app).post('/api/settings').send({ b: 3 }).expect(200);
      })
      .then(function (res) {
        expect(res.body.settings).toEqual({ a: 1, b: 3 });
      });
  });

  test('GET /:key returns the value for an existing key', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ ha_url: 'http://192.168.1.100:8123' })
      .expect(200)
      .then(function () {
        return request(app).get('/api/settings/ha_url').expect(200);
      })
      .then(function (res) {
        expect(res.body).toEqual({ key: 'ha_url', value: 'http://192.168.1.100:8123' });
      });
  });

  test('GET /:key returns 404 for a missing key', function () {
    var app = buildApp();
    return request(app).get('/api/settings/nope').expect(404).then(function (res) {
      expect(res.body).toEqual({ error: 'Key not found' });
    });
  });

  test('DELETE /:key removes the key and subsequent GET 404s', function () {
    var app = buildApp();
    return request(app)
      .post('/api/settings')
      .send({ temp: 'value' })
      .expect(200)
      .then(function () {
        return request(app).delete('/api/settings/temp').expect(200);
      })
      .then(function (res) {
        expect(res.body).toEqual({ success: true });
        return request(app).get('/api/settings/temp').expect(404);
      });
  });

  test('DELETE /:key on a non-existent key is a no-op success', function () {
    var app = buildApp();
    return request(app).delete('/api/settings/never-existed').expect(200).then(function (res) {
      expect(res.body).toEqual({ success: true });
    });
  });
});
