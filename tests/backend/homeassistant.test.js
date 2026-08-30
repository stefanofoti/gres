'use strict';

var express = require('express');
var request = require('supertest');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

jest.mock('node-fetch');
var fetch; // reacquired fresh in beforeEach, after resetModules — see helpers/tempWorkdir.js

var HA_ROUTE = path.join(__dirname, '../../backend/routes/homeassistant');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/ha', wd.requireFresh(HA_ROUTE));
  return app;
}

function writeHAConfig(url, token) {
  var dataFile = path.join(process.cwd(), 'data/settings.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ ha_url: url, ha_token: token }));
}

function mockFetchOnce(resolution) {
  fetch.mockImplementationOnce(function () { return Promise.resolve(resolution); });
}

function jsonRes(body, ok) {
  return { ok: ok !== false, json: function () { return Promise.resolve(body); } };
}

beforeEach(function () { wd.useTempWorkdir(); fetch = require('node-fetch'); });
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/ha/status', function () {
  test('reports not connected when unconfigured, without hitting fetch', function () {
    var app = buildApp();
    return request(app).get('/api/ha/status').expect(200).then(function (res) {
      expect(res.body.connected).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  test('reports connected on a successful ping', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes({ message: 'API running.' }));
    var app = buildApp();
    return request(app).get('/api/ha/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: true, message: 'API running.' });
    });
  });

  test('reports not connected (still HTTP 200) when the upstream call rejects', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    fetch.mockImplementationOnce(function () { return Promise.reject(new Error('ECONNREFUSED')); });
    var app = buildApp();
    return request(app).get('/api/ha/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: false, error: 'ECONNREFUSED' });
    });
  });
});

describe('GET /api/ha/entities', function () {
  test('400 when not configured', function () {
    var app = buildApp();
    return request(app).get('/api/ha/entities').expect(400);
  });

  test('filters entities down to RELEVANT_DOMAINS', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes([
      { entity_id: 'light.kitchen', state: 'on' },
      { entity_id: 'sensor.temp', state: '21' },
      { entity_id: 'switch.fan', state: 'off' }
    ]));
    var app = buildApp();
    return request(app).get('/api/ha/entities').expect(200).then(function (res) {
      var ids = res.body.map(function (e) { return e.entity_id; });
      expect(ids).toEqual(['light.kitchen', 'switch.fan']);
    });
  });

  test('?domain= filters strictly by the requested domain', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes([
      { entity_id: 'light.kitchen', state: 'on' },
      { entity_id: 'light.hall', state: 'off' },
      { entity_id: 'switch.fan', state: 'off' }
    ]));
    var app = buildApp();
    return request(app).get('/api/ha/entities?domain=light').expect(200).then(function (res) {
      expect(res.body).toHaveLength(2);
    });
  });

  test('500 when HA returns a non-array payload', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes({ error: 'unauthorized' }));
    var app = buildApp();
    return request(app).get('/api/ha/entities').expect(500);
  });
});

describe('GET /api/ha/devices', function () {
  test('returns entities plus an active/total summary', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes([
      { entity_id: 'light.kitchen', state: 'on' },
      { entity_id: 'light.hall', state: 'off' },
      { entity_id: 'media_player.tv', state: 'playing' }
    ]));
    var app = buildApp();
    return request(app).get('/api/ha/devices').expect(200).then(function (res) {
      expect(res.body.summary).toEqual({ total: 3, active: 2 });
    });
  });
});

describe('POST /api/ha/service', function () {
  test('400 when not configured', function () {
    var app = buildApp();
    return request(app).post('/api/ha/service').send({ domain: 'light', service: 'turn_on' }).expect(400);
  });

  test('400 when domain or service missing', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    var app = buildApp();
    return request(app).post('/api/ha/service').send({ domain: 'light' }).expect(400);
  });

  test('calls the HA service and echoes the result', function () {
    writeHAConfig('http://ha.local:8123', 'tok');
    mockFetchOnce(jsonRes([{ entity_id: 'light.kitchen', state: 'on' }]));
    var app = buildApp();
    return request(app)
      .post('/api/ha/service')
      .send({ domain: 'light', service: 'turn_on', service_data: { entity_id: 'light.kitchen' } })
      .expect(200)
      .then(function (res) {
        expect(res.body.success).toBe(true);
        var call = fetch.mock.calls[0];
        expect(call[0]).toBe('http://ha.local:8123/api/services/light/turn_on');
        expect(call[1].method).toBe('POST');
      });
  });
});
