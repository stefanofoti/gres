'use strict';

var express = require('express');
var request = require('supertest');
var http = require('http');
var fs = require('fs');
var path = require('path');
var wd = require('../helpers/tempWorkdir');

/*
 * proxmox.js talks to the PVE API over raw http/https (not node-fetch), so
 * rather than mocking Node core modules we spin up a real local HTTP server
 * that stands in for Proxmox and answer with its { data: ... } envelope.
 */

var PX_ROUTE = path.join(__dirname, '../../backend/routes/proxmox');

var server;
var serverPort;
var currentHandler;

beforeAll(function (done) {
  server = http.createServer(function (req, res) {
    currentHandler(req, res);
  });
  server.listen(0, '127.0.0.1', function () {
    serverPort = server.address().port;
    done();
  });
});

afterAll(function (done) { server.close(done); });

function jsonHandler(statusCode, dataBody) {
  return function (req, res) {
    var chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: dataBody }));
    });
  };
}

function buildApp() {
  var app = express();
  app.use(express.json());
  app.use(wd.attachNoopLog);
  app.use('/api/px', wd.requireFresh(PX_ROUTE));
  return app;
}

function writePXConfig(overrides) {
  var dataFile = path.join(process.cwd(), 'data/settings.json');
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  var cfg = Object.assign({
    px_url: 'http://127.0.0.1:' + serverPort,
    px_token: 'secret-token',
    px_tokenid: 'root@pam!homeapp'
  }, overrides || {});
  fs.writeFileSync(dataFile, JSON.stringify(cfg));
}

beforeEach(function () { wd.useTempWorkdir(); });
afterEach(function () { wd.restoreWorkdir(); });

describe('GET /api/px/status', function () {
  test('reports not connected when unconfigured, without contacting any server', function () {
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: false, error: 'Non configurato' });
    });
  });

  test('reports version/release on a successful ping', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, { version: '8.1', release: 'bookworm' });
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body).toEqual({ connected: true, version: '8.1', release: 'bookworm' });
    });
  });

  test('reports not connected when the PVE API errors', function () {
    writePXConfig();
    currentHandler = function (req, res) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'authentication failure' }));
    };
    var app = buildApp();
    return request(app).get('/api/px/status').expect(200).then(function (res) {
      expect(res.body.connected).toBe(false);
      expect(res.body.error).toBe('authentication failure');
    });
  });
});

describe('GET /api/px/nodes', function () {
  test('returns the unwrapped node list', function () {
    writePXConfig();
    currentHandler = jsonHandler(200, [{ node: 'pve1', status: 'online' }]);
    var app = buildApp();
    return request(app).get('/api/px/nodes').expect(200).then(function (res) {
      expect(res.body).toEqual([{ node: 'pve1', status: 'online' }]);
    });
  });
});

describe('POST /api/px/nodes/:node/power', function () {
  test('400 when command is missing', function () {
    writePXConfig();
    var app = buildApp();
    return request(app).post('/api/px/nodes/pve1/power').send({}).expect(400);
  });

  test('sends the PVE token header and command body, unwraps the response', function () {
    writePXConfig();
    var seenAuth, seenBody;
    currentHandler = function (req, res) {
      seenAuth = req.headers.authorization;
      var chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        seenBody = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: 'UPID:pve1:...' }));
      });
    };
    var app = buildApp();
    return request(app)
      .post('/api/px/nodes/pve1/power')
      .send({ command: 'reboot' })
      .expect(200)
      .then(function (res) {
        expect(res.body).toEqual({ ok: true, data: 'UPID:pve1:...' });
        expect(seenAuth).toBe('PVEAPIToken=root@pam!homeapp=secret-token');
        expect(seenBody).toEqual({ command: 'reboot' });
      });
  });

  test('500 when the request times out / errors at the transport level', function () {
    writePXConfig({ px_url: 'http://127.0.0.1:1' }); // nothing listens on port 1
    var app = buildApp();
    return request(app).post('/api/px/nodes/pve1/power').send({ command: 'reboot' }).expect(500);
  });
});
