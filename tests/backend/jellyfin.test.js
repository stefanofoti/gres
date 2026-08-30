'use strict';

var express = require('express');
var request = require('supertest');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

jest.mock('node-fetch');
var fetch; // reacquired fresh in beforeEach, after resetModules — see helpers/tempWorkdir.js

var JF_ROUTE = path.join(__dirname, '../../backend/routes/jellyfin');

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/jf', wd.requireFresh(JF_ROUTE));
  return app;
}

function writeJFConfig(url, token) {
  var dataFile = path.join(process.cwd(), 'data/settings.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify({ jf_url: url, jf_token: token }));
}

function mockFetchOnce(body, ok) {
  fetch.mockImplementationOnce(function () {
    return Promise.resolve({ ok: ok !== false, status: ok === false ? 500 : 200, json: function () { return Promise.resolve(body); } });
  });
}

beforeEach(function () { wd.useTempWorkdir(); fetch = require('node-fetch'); });
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/jf/status', function () {
  test('reports not connected when unconfigured', function () {
    var app = buildApp();
    return request(app).get('/api/jf/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: false, error: 'Non configurato' });
    });
  });

  test('reports server name and version when reachable', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({ ServerName: 'Home Media', Version: '10.9.0' });
    var app = buildApp();
    return request(app).get('/api/jf/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: true, serverName: 'Home Media', version: '10.9.0' });
    });
  });
});

describe('GET /api/jf/userid', function () {
  test('prefers an administrator account over the first user', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce([
      { Id: 'u1', Name: 'guest', Policy: { IsAdministrator: false } },
      { Id: 'u2', Name: 'admin', Policy: { IsAdministrator: true } }
    ]);
    var app = buildApp();
    return request(app).get('/api/jf/userid').expect(200).then(function (res) {
      expect(res.body).toEqual({ userId: 'u2', userName: 'admin' });
    });
  });

  test('500 when no users are returned', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce([]);
    var app = buildApp();
    return request(app).get('/api/jf/userid').expect(500);
  });
});

describe('GET /api/jf/items', function () {
  test('400 when userId is missing', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    var app = buildApp();
    return request(app).get('/api/jf/items').expect(400);
  });

  test('paginates and shapes the library response', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({ Items: [{ Id: 'm1', Name: 'Movie One' }], TotalRecordCount: 57 });
    var app = buildApp();
    return request(app).get('/api/jf/items?userId=u2&page=2&pageSize=10').expect(200).then(function (res) {
      expect(res.body).toEqual({
        items: [{ Id: 'm1', Name: 'Movie One' }], totalCount: 57, page: 2, pageSize: 10
      });
      var calledUrl = fetch.mock.calls[0][0];
      expect(calledUrl).toContain('StartIndex=20');
      expect(calledUrl).toContain('Limit=10');
    });
  });

  test('500 when the upstream call fails', function () {
    writeJFConfig('http://jf.local:8096', 'tok');
    mockFetchOnce({}, false);
    var app = buildApp();
    return request(app).get('/api/jf/items?userId=u2').expect(500);
  });
});
